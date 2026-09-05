-- ============================================================
-- Zchema — Import (Phase 7, Increment 2)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql
--                        → attributes.sql → search.sql.
--
-- One function, one transaction. An import that half-succeeds is worse
-- than one that fails: the user cannot tell which rows landed, and
-- re-running it duplicates the ones that did.
--
-- ON DATES: values arrive already normalised to ISO by the client. That
-- is deliberate. Casting "03/04/2024" server-side would depend on the
-- session's DateStyle, which means the same file imports differently
-- depending on connection settings — and the CLIENT is the only place
-- that knows which reading the user picked when the column was
-- ambiguous.
-- ============================================================


-- ============================================================
-- 1. require_data_editor()
-- ------------------------------------------------------------
-- The item-level counterpart to require_schema_admin(). Importing rows
-- into an existing category with no new fields is a DATA operation, and
-- gating it behind SCHEMA_ADMIN would be wrong.
--
-- As with require_schema_admin, a NULL auth.uid() means there is no JWT
-- — the SQL editor or the service role — which already bypasses RLS as
-- table owner.
-- ============================================================
CREATE OR REPLACE FUNCTION public.require_data_editor()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND public.get_user_role() NOT IN ('SCHEMA_ADMIN', 'DATA_EDITOR') THEN
    RAISE EXCEPTION 'You need the DATA_EDITOR or SCHEMA_ADMIN role to add items.';
  END IF;
END;
$$;


-- ============================================================
-- 2. coerce_import_value(value, type) → JSONB
-- ------------------------------------------------------------
-- A CSV cell is always a string. This turns it into the JSONB shape the
-- field's type expects, or NULL when it cannot — and NULL is the signal
-- the caller turns into a per-row error naming the line and the value.
--
-- Reuses try_cast() from impact.sql for the scalar types so an imported
-- value and a migrated value are converted by exactly the same rule.
-- Two conversion paths that disagree would mean data imported today
-- behaves differently from the same data retyped tomorrow.
-- ============================================================
CREATE OR REPLACE FUNCTION public.coerce_import_value(p_raw TEXT, p_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  txt TEXT := btrim(COALESCE(p_raw, ''));
BEGIN
  IF txt = '' THEN RETURN NULL; END IF;

  -- multiselect splits; try_cast would wrap "S,M" as a single element.
  IF p_type = 'multiselect' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT btrim(part) AS t
        FROM unnest(string_to_array(txt, ',')) AS part
        WHERE btrim(part) <> ''
      ) parts
    );
  END IF;

  RETURN public.try_cast(to_jsonb(txt), p_type);
END;
$$;


-- ============================================================
-- 3. import_items(...)  → JSONB
-- ------------------------------------------------------------
-- Create or extend a category and insert rows, atomically.
--
--   p_category_id   existing target, or NULL to create one
--   p_new_category  { name, parent_id, icon, color } when creating
--   p_own_fields    fields to ensure exist on the target; keys already
--                   in the effective chain are IGNORED, not duplicated
--   p_rows          array of objects keyed by field key, values as text
--
-- Returns { category_id, created, fields_added, items_inserted,
--           errors: [{ row, key, value, message }] }.
--
-- A value that will not coerce becomes an ERROR AND AN EMPTY CELL — the
-- row still imports. Rejecting an entire 500-row file because row 47
-- has "n/a" in a date column is how an importer gets abandoned; the
-- errors are reported with line numbers so they can be fixed after.
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_items(
  p_category_id  UUID,
  p_new_category JSONB,
  p_own_fields   JSONB,
  p_rows         JSONB,
  p_changed_by   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target      UUID := p_category_id;
  created     BOOLEAN := false;
  existing    JSONB;
  chain_keys  TEXT[];
  to_add      JSONB := '[]'::jsonb;
  fld         JSONB;
  schema_now  JSONB;
  types       JSONB := '{}'::jsonb;
  row_in      JSONB;
  data_out    JSONB;
  coerced     JSONB;
  raw         TEXT;
  k           TEXT;
  errors      JSONB := '[]'::jsonb;
  inserted    INT := 0;
  row_no      INT := 0;
  next_pos    INT;
  version_now INT;
BEGIN
  -- ── Authorisation ─────────────────────────────────────────
  -- Creating a category or adding fields is a SCHEMA change; dropping
  -- rows into an existing one is not.
  IF target IS NULL OR jsonb_array_length(COALESCE(p_own_fields, '[]'::jsonb)) > 0 THEN
    PERFORM public.require_schema_admin();
  ELSE
    PERFORM public.require_data_editor();
  END IF;

  -- ── Target category ───────────────────────────────────────
  IF target IS NULL THEN
    IF COALESCE(btrim(p_new_category->>'name'), '') = '' THEN
      RAISE EXCEPTION 'A name is required to create a category for this import.';
    END IF;

    INSERT INTO public.categories (name, parent_id, icon, color, own_fields)
    VALUES (
      btrim(p_new_category->>'name'),
      NULLIF(p_new_category->>'parent_id', '')::uuid,
      p_new_category->>'icon',
      p_new_category->>'color',
      '[]'::jsonb
    )
    RETURNING id INTO target;

    created := true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = target) THEN
    RAISE EXCEPTION 'Category % not found.', target;
  END IF;

  -- ── Merge in the new fields ───────────────────────────────
  -- Anything the category already inherits or defines is skipped: the
  -- whole point of mapping in the wizard is that an incoming `brand`
  -- column lands on the INHERITED brand rather than shadowing it, which
  -- the uniqueness trigger would reject anyway.
  SELECT COALESCE(array_agg(e->>'key'), ARRAY[]::TEXT[]) INTO chain_keys
  FROM jsonb_array_elements(public.get_effective_schema(target)) e;

  SELECT own_fields INTO existing FROM public.categories WHERE id = target;
  next_pos := COALESCE(jsonb_array_length(existing), 0);

  FOR fld IN SELECT value FROM jsonb_array_elements(COALESCE(p_own_fields, '[]'::jsonb))
  LOOP
    CONTINUE WHEN fld->>'key' = ANY(chain_keys);
    to_add := to_add || jsonb_build_array(
      fld || jsonb_build_object('position', next_pos)
    );
    chain_keys := array_append(chain_keys, fld->>'key');
    next_pos := next_pos + 1;
  END LOOP;

  IF jsonb_array_length(to_add) > 0 THEN
    UPDATE public.categories
       SET own_fields = COALESCE(existing, '[]'::jsonb) || to_add
     WHERE id = target;
  END IF;

  -- ── Resolve the schema ONCE, not per row ──────────────────
  schema_now := public.get_effective_schema(target);
  SELECT COALESCE(jsonb_object_agg(e->>'key', e->>'type'), '{}'::jsonb) INTO types
  FROM jsonb_array_elements(schema_now) e;

  SELECT COALESCE(MAX(version), 1) INTO version_now
  FROM public.schema_versions WHERE category_id = target;

  -- ── Rows ──────────────────────────────────────────────────
  FOR row_in IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    row_no   := row_no + 1;
    data_out := '{}'::jsonb;

    FOR k IN SELECT key FROM jsonb_each_text(row_in)
    LOOP
      -- A column the schema does not have is silently ignored: the
      -- wizard's Skip action lands here, and so does any stray
      -- `_extra_N` the parser rescued from a ragged row.
      CONTINUE WHEN NOT (types ? k);

      raw := row_in->>k;
      CONTINUE WHEN COALESCE(btrim(raw), '') = '';

      coerced := public.coerce_import_value(raw, types->>k);

      IF coerced IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'row',     row_no,
          'key',     k,
          'value',   raw,
          'message', format('value "%s" is not a %s — imported as empty', raw, types->>k)
        ));
        CONTINUE;
      END IF;

      data_out := data_out || jsonb_build_object(k, coerced);
    END LOOP;

    INSERT INTO public.items (category_id, data, schema_version)
    VALUES (target, data_out, version_now);

    inserted := inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'category_id',    target,
    'created',        created,
    'fields_added',   jsonb_array_length(to_add),
    'items_inserted', inserted,
    -- Capped: an import of 5,000 rows with a bad column would otherwise
    -- return 5,000 identical messages and help nobody.
    'errors',         (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                       FROM (SELECT e FROM jsonb_array_elements(errors) e LIMIT 100) x),
    'error_count',    jsonb_array_length(errors)
  );
END;
$$;

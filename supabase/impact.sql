-- ============================================================
-- SchemaShift — Schema Change Impact Analysis (Phase 5)
-- Source AFTER schema.sql → functions.sql → triggers.sql.
--
-- Changing a data model against live records is the scariest routine
-- operation in software. These functions measure the blast radius
-- BEFORE anything is written.
--
-- analyze_schema_change() is STRICTLY READ-ONLY. It is called on every
-- keystroke (debounced) by the impact dialog, so it must never write
-- and must stay cheap enough to run repeatedly.
-- ============================================================


-- ============================================================
-- 1. try_cast(value, target_type)  → JSONB or NULL
-- ------------------------------------------------------------
-- Probe whether a stored value survives a type change. Returns the
-- converted value, or NULL when the cast fails.
--
-- This has to happen in SQL: round-tripping every item value to the
-- client to test castability would defeat the point of the feature.
--
-- NOTE ON PRIVILEGE: the plan specified SECURITY DEFINER. This reads
-- no tables and needs no elevation, so it is INVOKER — DEFINER would
-- grant nothing here while widening the blast radius if the function
-- were ever extended. Change it if you disagree; nothing depends on it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_cast(p_value JSONB, p_target TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  txt TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;

  -- Unwrap a JSON string; render anything else as text.
  txt := CASE WHEN jsonb_typeof(p_value) = 'string'
              THEN p_value #>> '{}'
              ELSE p_value::text END;

  IF btrim(COALESCE(txt, '')) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    CASE p_target
      WHEN 'number'  THEN RETURN to_jsonb(txt::numeric);
      WHEN 'boolean' THEN RETURN to_jsonb(txt::boolean);
      WHEN 'date'    THEN RETURN to_jsonb((txt::date)::text);
      WHEN 'multiselect' THEN
        IF jsonb_typeof(p_value) = 'array' THEN RETURN p_value; END IF;
        RETURN jsonb_build_array(txt);
      ELSE
        -- string / text / url / select all hold text.
        RETURN to_jsonb(txt);
    END CASE;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;


-- ============================================================
-- 2. resolve_schema_preview(category, own_fields, overrides)
-- ------------------------------------------------------------
-- get_effective_schema(), but with the target category's own_fields
-- and overrides SUBSTITUTED for proposed ones that are not saved.
--
-- This is what lets the impact dialog answer "what would happen if I
-- saved this?" without writing anything first.
--
-- Keep the algorithm identical to get_effective_schema — if that one
-- changes, change this in the same commit.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_schema_preview(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anc       RECORD;
  fld       JSONB;
  acc       JSONB := '[]'::jsonb;
  seen      TEXT[] := ARRAY[]::TEXT[];
  k         TEXT;
  o_key     TEXT;
  o_patch   JSONB;
  p_key     TEXT;
  p_val     JSONB;
  idx       INT;
  cur       JSONB;
  patched   JSONB;
  eff_own   JSONB;
  eff_over  JSONB;
  allowed   TEXT[] := ARRAY['label','required','options','default','help_text','position'];
BEGIN
  -- Pass 1: fold own_fields, root → target, substituting at the target.
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    eff_own := CASE WHEN anc.id = p_category_id
                    THEN COALESCE(p_new_own_fields, anc.own_fields)
                    ELSE anc.own_fields END;

    IF jsonb_typeof(COALESCE(eff_own, '[]'::jsonb)) <> 'array' THEN CONTINUE; END IF;

    FOR fld IN SELECT value FROM jsonb_array_elements(eff_own)
    LOOP
      k := fld->>'key';
      IF k IS NULL THEN CONTINUE; END IF;
      IF k = ANY(seen) THEN CONTINUE; END IF;
      seen := array_append(seen, k);
      acc := acc || jsonb_build_array(
        fld || jsonb_build_object(
          'source_category_id',   anc.id,
          'source_category_name', anc.name,
          'depth',                anc.depth,
          'inherited',            anc.depth > 0,
          'overridden_by',        '[]'::jsonb
        )
      );
    END LOOP;
  END LOOP;

  -- Pass 2: apply overrides, root → target, substituting at the target.
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    eff_over := CASE WHEN anc.id = p_category_id
                     THEN COALESCE(p_new_overrides, anc.overrides)
                     ELSE anc.overrides END;

    IF jsonb_typeof(COALESCE(eff_over, '{}'::jsonb)) <> 'object' THEN CONTINUE; END IF;

    FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(eff_over)
    LOOP
      CONTINUE WHEN jsonb_typeof(o_patch) <> 'object';
      FOR idx IN 0 .. jsonb_array_length(acc) - 1
      LOOP
        cur := acc->idx;
        IF cur->>'key' = o_key THEN
          patched := cur;
          FOR p_key, p_val IN SELECT key, value FROM jsonb_each(o_patch)
          LOOP
            IF p_key = ANY(allowed) THEN
              patched := patched || jsonb_build_object(p_key, p_val);
            END IF;
          END LOOP;
          patched := jsonb_set(
            patched, '{overridden_by}',
            COALESCE(patched->'overridden_by', '[]'::jsonb) || to_jsonb(anc.id)
          );
          acc := jsonb_set(acc, ARRAY[idx::text], patched);
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Pass 3: sort (depth DESC, position ASC, label ASC).
  SELECT COALESCE(
           jsonb_agg(e ORDER BY (e->>'depth')::int DESC,
                                COALESCE((e->>'position')::numeric, 0) ASC,
                                COALESCE(e->>'label', '') ASC),
           '[]'::jsonb)
    INTO acc
  FROM jsonb_array_elements(acc) e;

  RETURN acc;
END;
$$;


-- ============================================================
-- 3. analyze_schema_change(category, own_fields, overrides)
-- ------------------------------------------------------------
-- READ-ONLY. Returns the blast radius of a proposed schema change:
--
--   { category_id, current_version, next_version,
--     affected_categories: [{id,name,depth,item_count}],
--     total_affected_items, changes: SchemaChange[],
--     max_severity, blocked, blocked_reason }
--
-- Severity follows the Phase 5 table: adding an optional field is
-- safe, making a field required is a warning, and anything that can
-- lose a stored value is destructive.
-- ============================================================
CREATE OR REPLACE FUNCTION public.analyze_schema_change(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  key_re      CONSTANT TEXT := '^[a-z][a-z0-9_]*$';
  allowed_types TEXT[] := ARRAY['string','text','number','boolean','date','select','multiselect','url'];

  cur_schema JSONB;
  next_schema    JSONB;
  subtree_ids    UUID[];
  affected       JSONB := '[]'::jsonb;
  changes        JSONB := '[]'::jsonb;

  cur_ver     INT;
  total_items INT := 0;
  max_sev     TEXT := 'safe';
  blocked     BOOLEAN := false;
  reason      TEXT := NULL;

  fld         JSONB;
  k           TEXT;
  t           TEXT;
  before_f    JSONB;
  after_f     JSONB;
  anc_keys    TEXT[];
  desc_keys   TEXT[];
  o_key       TEXT;

  n_affected   INT;
  n_lossy      INT;
  samples      JSONB;
  removed_opts TEXT[];
BEGIN
  -- ── Validate the proposal before measuring it ─────────────
  IF jsonb_typeof(COALESCE(p_new_own_fields, '[]'::jsonb)) <> 'array' THEN
    blocked := true; reason := 'own_fields must be a JSON array.';
  END IF;

  IF NOT blocked THEN
    SELECT COALESCE(array_agg(DISTINCT af.elem->>'key'), ARRAY[]::TEXT[]) INTO anc_keys
    FROM public.get_category_ancestors(
           (SELECT parent_id FROM public.categories WHERE id = p_category_id)
         ) a
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.own_fields, '[]'::jsonb)) AS af(elem);

    SELECT COALESCE(array_agg(DISTINCT df.elem->>'key'), ARRAY[]::TEXT[]) INTO desc_keys
    FROM public.get_category_subtree(p_category_id) s
    JOIN public.categories c ON c.id = s.id AND c.id <> p_category_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.own_fields, '[]'::jsonb)) AS df(elem);

    FOR fld IN SELECT value FROM jsonb_array_elements(COALESCE(p_new_own_fields, '[]'::jsonb))
    LOOP
      k := fld->>'key';
      t := fld->>'type';

      IF k IS NULL OR k !~ key_re THEN
        blocked := true;
        reason := format('Invalid field key "%s": use snake_case.', COALESCE(k, '(missing)'));
        EXIT;
      END IF;
      IF t IS NULL OR NOT (t = ANY(allowed_types)) THEN
        blocked := true;
        reason := format('Field "%s" has an unsupported type "%s".', k, COALESCE(t, '(missing)'));
        EXIT;
      END IF;
      IF k = ANY(anc_keys) THEN
        blocked := true;
        reason := format('"%s" is already defined by an ancestor category. Override it instead of redefining it.', k);
        EXIT;
      END IF;
      IF k = ANY(desc_keys) THEN
        blocked := true;
        reason := format('"%s" is already defined by a descendant category.', k);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF NOT blocked AND jsonb_typeof(COALESCE(p_new_overrides, '{}'::jsonb)) = 'object' THEN
    FOR o_key IN SELECT key FROM jsonb_each(COALESCE(p_new_overrides, '{}'::jsonb))
    LOOP
      IF NOT (o_key = ANY(anc_keys)) THEN
        blocked := true;
        reason := format('Override targets "%s", which this category does not inherit.', o_key);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- ── Resolve before / after ────────────────────────────────
  cur_schema := public.get_effective_schema(p_category_id);
  next_schema    := CASE WHEN blocked
                         THEN cur_schema
                         ELSE public.resolve_schema_preview(
                                p_category_id, p_new_own_fields, p_new_overrides)
                    END;

  -- ── Affected set: this category plus every descendant ─────
  -- Inherited fields propagate down, so a change here reaches all of
  -- them. (A descendant shadowing the key would be excluded, but the
  -- Phase 1 uniqueness trigger makes that unreachable today.)
  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'depth', s.depth,
           'item_count', (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id)
         ) ORDER BY s.depth, c.name), '[]'::jsonb),
         COALESCE(sum((SELECT count(*) FROM public.items i WHERE i.category_id = c.id)), 0)::int
    INTO affected, total_items
  FROM public.get_category_subtree(p_category_id) s
  JOIN public.categories c ON c.id = s.id;

  SELECT COALESCE(MAX(version), 0) INTO cur_ver
  FROM public.schema_versions WHERE category_id = p_category_id;

  -- ── Diff and measure ──────────────────────────────────────
  -- ADDED
  FOR after_f IN SELECT value FROM jsonb_array_elements(next_schema)
  LOOP
    k := after_f->>'key';
    SELECT e INTO before_f FROM jsonb_array_elements(cur_schema) e WHERE e->>'key' = k;
    CONTINUE WHEN before_f IS NOT NULL;

    IF (after_f->>'required')::boolean THEN
      -- Every existing item lacks it, by definition.
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'add_field', 'field_key', k, 'severity', 'warning',
        'to', after_f, 'affected_item_count', total_items,
        'sample_values', '[]'::jsonb
      ));
      IF max_sev = 'safe' THEN max_sev := 'warning'; END IF;
    ELSE
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'add_field', 'field_key', k, 'severity', 'safe',
        'to', after_f, 'affected_item_count', 0
      ));
    END IF;
  END LOOP;

  -- REMOVED
  FOR before_f IN SELECT value FROM jsonb_array_elements(cur_schema)
  LOOP
    k := before_f->>'key';
    SELECT e INTO after_f FROM jsonb_array_elements(next_schema) e WHERE e->>'key' = k;
    CONTINUE WHEN after_f IS NOT NULL;

    SELECT count(*)::int INTO n_affected
    FROM public.items i
    WHERE i.category_id = ANY(subtree_ids)
      AND i.data ? k AND i.data->>k IS NOT NULL AND btrim(i.data->>k) <> '';

    SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) INTO samples
    FROM (
      SELECT DISTINCT i.data->k AS v
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND i.data ? k AND i.data->>k IS NOT NULL AND btrim(i.data->>k) <> ''
      LIMIT 5
    ) s;

    changes := changes || jsonb_build_array(jsonb_build_object(
      'kind', 'remove_field', 'field_key', k, 'severity', 'destructive',
      'from', before_f, 'affected_item_count', n_affected, 'sample_values', samples
    ));
    max_sev := 'destructive';
  END LOOP;

  -- MODIFIED
  FOR after_f IN SELECT value FROM jsonb_array_elements(next_schema)
  LOOP
    k := after_f->>'key';
    SELECT e INTO before_f FROM jsonb_array_elements(cur_schema) e WHERE e->>'key' = k;
    CONTINUE WHEN before_f IS NULL;

    -- Type change: probe every stored value for castability.
    IF before_f->>'type' IS DISTINCT FROM after_f->>'type' THEN
      SELECT count(*)::int INTO n_affected
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids) AND i.data ? k;

      SELECT count(*)::int INTO n_lossy
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND i.data ? k
        AND i.data->>k IS NOT NULL
        AND btrim(i.data->>k) <> ''
        AND public.try_cast(i.data->k, after_f->>'type') IS NULL;

      SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) INTO samples
      FROM (
        SELECT DISTINCT i.data->k AS v
        FROM public.items i
        WHERE i.category_id = ANY(subtree_ids)
          AND i.data ? k
          AND i.data->>k IS NOT NULL
          AND btrim(i.data->>k) <> ''
          AND public.try_cast(i.data->k, after_f->>'type') IS NULL
        LIMIT 5
      ) s;

      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'retype_field', 'field_key', k, 'severity', 'destructive',
        'from', before_f->>'type', 'to', after_f->>'type',
        'affected_item_count', n_affected, 'lossy_item_count', n_lossy,
        'sample_values', samples
      ));
      max_sev := 'destructive';
    END IF;

    -- Optional → required.
    IF NOT COALESCE((before_f->>'required')::boolean, false)
       AND COALESCE((after_f->>'required')::boolean, false) THEN
      SELECT count(*)::int INTO n_affected
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND (NOT (i.data ? k) OR i.data->>k IS NULL OR btrim(i.data->>k) = '');

      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'require_field', 'field_key', k, 'severity', 'warning',
        'from', false, 'to', true, 'affected_item_count', n_affected
      ));
      IF max_sev = 'safe' THEN max_sev := 'warning'; END IF;
    END IF;

    -- Required → optional: nothing can break.
    IF COALESCE((before_f->>'required')::boolean, false)
       AND NOT COALESCE((after_f->>'required')::boolean, false) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'unrequire_field', 'field_key', k, 'severity', 'safe',
        'from', true, 'to', false, 'affected_item_count', 0
      ));
    END IF;

    -- Label change: cosmetic.
    IF before_f->>'label' IS DISTINCT FROM after_f->>'label' THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'rename_label', 'field_key', k, 'severity', 'safe',
        'from', before_f->>'label', 'to', after_f->>'label',
        'affected_item_count', 0
      ));
    END IF;

    -- Options: only REMOVING one can strand data.
    IF COALESCE(before_f->'options', '[]'::jsonb) IS DISTINCT FROM
       COALESCE(after_f->'options', '[]'::jsonb) THEN

      -- Set-returning functions live in FROM, not the SELECT list, so
      -- the EXCEPT has plain columns to work on.
      SELECT COALESCE(array_agg(x.o), ARRAY[]::TEXT[]) INTO removed_opts
      FROM (
        SELECT b.o
        FROM jsonb_array_elements_text(COALESCE(before_f->'options', '[]'::jsonb)) AS b(o)
        EXCEPT
        SELECT a.o
        FROM jsonb_array_elements_text(COALESCE(after_f->'options', '[]'::jsonb)) AS a(o)
      ) x;

      IF array_length(removed_opts, 1) IS NULL THEN
        -- Options only added.
        changes := changes || jsonb_build_array(jsonb_build_object(
          'kind', 'change_options', 'field_key', k, 'severity', 'safe',
          'from', before_f->'options', 'to', after_f->'options',
          'affected_item_count', 0
        ));
      ELSE
        SELECT count(*)::int INTO n_affected
        FROM public.items i
        WHERE i.category_id = ANY(subtree_ids)
          AND i.data ? k
          AND i.data->>k = ANY(removed_opts);

        SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO samples
        FROM unnest(removed_opts) o;

        changes := changes || jsonb_build_array(jsonb_build_object(
          'kind', 'change_options', 'field_key', k,
          'severity', CASE WHEN n_affected > 0 THEN 'destructive' ELSE 'warning' END,
          'from', before_f->'options', 'to', after_f->'options',
          'affected_item_count', n_affected, 'sample_values', samples
        ));
        IF n_affected > 0 THEN max_sev := 'destructive';
        ELSIF max_sev = 'safe' THEN max_sev := 'warning';
        END IF;
      END IF;
    END IF;

    -- Override added / removed HERE. Severity follows whether it
    -- changed `required`; a label-only override cannot break data.
    IF NOT (COALESCE(before_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id))
       AND COALESCE(after_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'add_override', 'field_key', k,
        'severity', CASE WHEN COALESCE((before_f->>'required')::boolean, false)
                          IS DISTINCT FROM COALESCE((after_f->>'required')::boolean, false)
                         THEN 'warning' ELSE 'safe' END,
        'to', p_category_id, 'affected_item_count', 0
      ));
    END IF;

    IF COALESCE(before_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id)
       AND NOT (COALESCE(after_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id)) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'remove_override', 'field_key', k,
        'severity', CASE WHEN COALESCE((before_f->>'required')::boolean, false)
                          IS DISTINCT FROM COALESCE((after_f->>'required')::boolean, false)
                         THEN 'warning' ELSE 'safe' END,
        'from', p_category_id, 'affected_item_count', 0
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'category_id',          p_category_id,
    'current_version',      cur_ver,
    'next_version',         cur_ver + 1,
    'affected_categories',  affected,
    'total_affected_items', total_items,
    'changes',              changes,
    'max_severity',         CASE WHEN jsonb_array_length(changes) = 0 THEN 'safe' ELSE max_sev END,
    'blocked',              blocked,
    'blocked_reason',       reason
  );
END;
$$;


-- ============================================================
-- 4. schema_versions.authored  (Phase 5, Increment 2)
-- ------------------------------------------------------------
-- Idempotent for databases created before this column existed.
-- Fresh projects get it from schema.sql §5, which carries the same
-- definition and the rationale.
--
-- Short version: `snapshot` records the EFFECTIVE schema, which is
-- enough to DIFF a version but not enough to RESTORE one. A field's
-- resolved `required: true` does not say whether this category's
-- override set it or its parent did. Rollback that guesses at that is
-- rollback that quietly rewrites the model, so the authored state is
-- stored verbatim alongside the snapshot.
-- ============================================================
ALTER TABLE public.schema_versions
  ADD COLUMN IF NOT EXISTS authored JSONB NOT NULL DEFAULT '{}'::jsonb;


-- ============================================================
-- 5. apply_schema_change(...)  → JSONB
-- ------------------------------------------------------------
-- Execute a schema change with an explicit remediation for every
-- destructive consequence. ONE transaction: a plpgsql function body
-- is atomic, so any RAISE below leaves the database exactly as it
-- was found. A half-applied schema migration is the worst possible
-- outcome; this function is structured so it cannot happen.
--
-- p_remediations: { "<field_key>": { "strategy": …, "value": …, "confirm": … } }
--   A field with two changes at once (say retype + require) can be
--   addressed separately with the key "<field_key>:<kind>", which is
--   tried first and falls back to the plain field key.
--
-- Strategies
--   backfill  write `value` into every affected item missing the key
--   cast      convert to the new type; values that fail go to __orphaned
--   orphan    move values to data.__orphaned.<key>, preserving them
--   discard   hard-delete the key. Requires "confirm": true. Never a default.
--   leave     do nothing; affected items simply read as incomplete
--
-- Returns { version, items_updated, items_orphaned, items_incomplete }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_schema_change(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB,
  p_remediations   JSONB DEFAULT '{}'::jsonb,
  p_changed_by     UUID  DEFAULT NULL,
  -- Prepended to change_summary when the caller is not a plain edit.
  -- rollback_schema_version() uses it to mark its forward version.
  p_origin         JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  rems         JSONB := COALESCE(p_remediations, '{}'::jsonb);
  analysis     JSONB;
  ch           JSONB;
  ch_kind      TEXT;
  ch_key       TEXT;
  ch_sev       TEXT;
  rem          JSONB;
  strat        TEXT;
  rem_value    JSONB;
  new_type     TEXT;
  removed_opts TEXT[];
  applied      JSONB := '[]'::jsonb;    -- change_summary, strategies recorded
  subtree_ids  UUID[];
  batch        UUID[];
  touched      UUID[] := ARRAY[]::UUID[];
  orphaned     UUID[] := ARRAY[]::UUID[];
  cat_id       UUID;
  new_ver      INT;
  target_ver   INT;
  n_updated    INT := 0;
  n_orphaned   INT := 0;
  n_incomplete INT := 0;
BEGIN
  -- ── 0. Authorisation ──────────────────────────────────────
  -- RLS already blocks a non-admin from writing categories, but a
  -- policy that filters rows produces a silent no-op UPDATE, not an
  -- error. Fail loudly instead.
  --
  -- A NULL auth.uid() means there is no JWT: the SQL editor, a
  -- migration, or the service role. Those already bypass RLS by being
  -- the table owner, so gating them here would only break the test
  -- suite without adding protection.
  IF auth.uid() IS NOT NULL
     AND public.get_user_role() IS DISTINCT FROM 'SCHEMA_ADMIN' THEN
    RAISE EXCEPTION 'Only a SCHEMA_ADMIN may change the schema.';
  END IF;

  -- ── 1. Re-analyse INSIDE the transaction ──────────────────
  -- The dialog's analysis may be seconds or minutes old, and the tree
  -- can have moved underneath it. This one is authoritative.
  analysis := public.analyze_schema_change(p_category_id, p_new_own_fields, p_new_overrides);

  IF (analysis->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Change rejected: %', COALESCE(analysis->>'blocked_reason', 'unknown reason');
  END IF;

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  -- ── 2. Validate every remediation BEFORE writing anything ─
  -- A request missing one remediation must never apply the other nine,
  -- so the whole plan is checked up front.
  FOR ch IN SELECT value FROM jsonb_array_elements(analysis->'changes')
  LOOP
    ch_key  := ch->>'field_key';
    ch_kind := ch->>'kind';
    ch_sev  := ch->>'severity';
    rem     := COALESCE(rems -> (ch_key || ':' || ch_kind), rems -> ch_key);
    strat   := rem->>'strategy';

    -- (a) Destructive changes demand an explicit choice.
    IF ch_sev = 'destructive' AND strat IS NULL THEN
      RAISE EXCEPTION
        'Destructive change to "%" (%) has no remediation. Refusing to guess what should happen to % item value(s).',
        ch_key, ch_kind, ch->>'affected_item_count';
    END IF;

    -- Anything else defaults to "leave", which is a no-op.
    CONTINUE WHEN strat IS NULL;

    -- (b) The strategy must make sense for this kind of change.
    IF NOT (strat = ANY (
      CASE ch_kind
        WHEN 'add_field'      THEN ARRAY['backfill','leave']
        WHEN 'require_field'  THEN ARRAY['backfill','leave']
        WHEN 'remove_field'   THEN ARRAY['orphan','discard']
        WHEN 'retype_field'   THEN ARRAY['cast','orphan','discard']
        WHEN 'change_options' THEN ARRAY['orphan','backfill','discard','leave']
        ELSE ARRAY['leave']
      END)) THEN
      RAISE EXCEPTION 'Strategy "%" is not valid for % on "%".', strat, ch_kind, ch_key;
    END IF;

    -- (c) discard is the only strategy that destroys data outright.
    -- It is never a default and never silent.
    IF strat = 'discard' AND NOT COALESCE((rem->>'confirm')::boolean, false) THEN
      RAISE EXCEPTION
        'Strategy "discard" on "%" permanently deletes item values and requires an explicit "confirm": true.',
        ch_key;
    END IF;

    IF strat = 'backfill' AND NOT (rem ? 'value') THEN
      RAISE EXCEPTION 'Strategy "backfill" on "%" needs a "value" to write.', ch_key;
    END IF;
  END LOOP;

  -- ── 3. Write the new schema ───────────────────────────────
  -- The Phase 1 integrity triggers fire here and are the last line of
  -- defence: anything analyze_schema_change failed to catch aborts the
  -- whole transaction rather than landing.
  UPDATE public.categories
     SET own_fields = COALESCE(p_new_own_fields, own_fields),
         overrides  = COALESCE(p_new_overrides,  overrides)
   WHERE id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % not found, or not writable by this user.', p_category_id;
  END IF;

  -- ── 4. Remediate item data across the affected subtree ────
  FOR ch IN SELECT value FROM jsonb_array_elements(analysis->'changes')
  LOOP
    ch_key  := ch->>'field_key';
    ch_kind := ch->>'kind';
    ch_sev  := ch->>'severity';
    rem     := COALESCE(rems -> (ch_key || ':' || ch_kind), rems -> ch_key);
    strat   := COALESCE(rem->>'strategy', 'leave');
    rem_value := rem->'value';
    batch   := ARRAY[]::UUID[];

    IF strat = 'backfill' THEN
      -- change_options backfill rewrites the stranded values; every
      -- other backfill fills the blanks.
      IF ch_kind = 'change_options' THEN
        SELECT COALESCE(array_agg(o), ARRAY[]::TEXT[]) INTO removed_opts
        FROM jsonb_array_elements_text(COALESCE(ch->'sample_values', '[]'::jsonb)) AS t(o);

        WITH upd AS (
          UPDATE public.items i
             SET data = i.data || jsonb_build_object(ch_key, rem_value)
           WHERE i.category_id = ANY(subtree_ids)
             AND i.data ? ch_key
             AND i.data->>ch_key = ANY(removed_opts)
          RETURNING i.id
        ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      ELSE
        WITH upd AS (
          UPDATE public.items i
             SET data = i.data || jsonb_build_object(ch_key, rem_value)
           WHERE i.category_id = ANY(subtree_ids)
             AND (NOT (i.data ? ch_key)
                  OR i.data->>ch_key IS NULL
                  OR btrim(i.data->>ch_key) = '')
          RETURNING i.id
        ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      END IF;
      touched := touched || batch;

    ELSIF strat = 'cast' THEN
      new_type := ch->>'to';

      -- 4a. values that survive the cast are converted in place
      WITH upd AS (
        UPDATE public.items i
           SET data = i.data || jsonb_build_object(ch_key, public.try_cast(i.data->ch_key, new_type))
         WHERE i.category_id = ANY(subtree_ids)
           AND i.data ? ch_key
           AND btrim(COALESCE(i.data->>ch_key, '')) <> ''
           AND public.try_cast(i.data->ch_key, new_type) IS NOT NULL
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched := touched || batch;

      -- 4b. values that do NOT survive are preserved, not dropped
      WITH upd AS (
        UPDATE public.items i
           SET data = (i.data - ch_key)
                   || jsonb_build_object('__orphaned',
                        COALESCE(i.data->'__orphaned', '{}'::jsonb)
                        || jsonb_build_object(ch_key, i.data->ch_key))
         WHERE i.category_id = ANY(subtree_ids)
           AND i.data ? ch_key
           AND btrim(COALESCE(i.data->>ch_key, '')) <> ''
           AND public.try_cast(i.data->ch_key, new_type) IS NULL
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched  := touched  || batch;
      orphaned := orphaned || batch;

    ELSIF strat = 'orphan' THEN
      -- change_options orphans only the stranded values; everything
      -- else orphans the whole column.
      IF ch_kind = 'change_options' THEN
        SELECT COALESCE(array_agg(o), ARRAY[]::TEXT[]) INTO removed_opts
        FROM jsonb_array_elements_text(COALESCE(ch->'sample_values', '[]'::jsonb)) AS t(o);
      ELSE
        removed_opts := NULL;
      END IF;

      WITH upd AS (
        UPDATE public.items i
           SET data = (i.data - ch_key)
                   || jsonb_build_object('__orphaned',
                        COALESCE(i.data->'__orphaned', '{}'::jsonb)
                        || jsonb_build_object(ch_key, i.data->ch_key))
         WHERE i.category_id = ANY(subtree_ids)
           AND i.data ? ch_key
           AND btrim(COALESCE(i.data->>ch_key, '')) <> ''
           AND (removed_opts IS NULL OR i.data->>ch_key = ANY(removed_opts))
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched  := touched  || batch;
      orphaned := orphaned || batch;

      -- A blank value carries no information worth preserving; drop
      -- the empty key so it does not clutter __orphaned.
      IF removed_opts IS NULL THEN
        WITH upd AS (
          UPDATE public.items i
             SET data = i.data - ch_key
           WHERE i.category_id = ANY(subtree_ids)
             AND i.data ? ch_key
             AND btrim(COALESCE(i.data->>ch_key, '')) = ''
          RETURNING i.id
        ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
        touched := touched || batch;
      END IF;

    ELSIF strat = 'discard' THEN
      -- Removing a select OPTION strands only the items holding that
      -- option; discarding the whole column there would delete values
      -- the change never touched.
      IF ch_kind = 'change_options' THEN
        SELECT COALESCE(array_agg(o), ARRAY[]::TEXT[]) INTO removed_opts
        FROM jsonb_array_elements_text(COALESCE(ch->'sample_values', '[]'::jsonb)) AS t(o);
      ELSE
        removed_opts := NULL;
      END IF;

      WITH upd AS (
        UPDATE public.items i
           SET data = i.data - ch_key
         WHERE i.category_id = ANY(subtree_ids)
           AND i.data ? ch_key
           AND (removed_opts IS NULL OR i.data->>ch_key = ANY(removed_opts))
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched := touched || batch;
    END IF;

    -- Record what was actually done, not what was requested.
    applied := applied || jsonb_build_array(
      ch || jsonb_build_object(
        'strategy', strat,
        'remediated_item_count', COALESCE(array_length(batch, 1), 0)
      )
    );
  END LOOP;

  IF p_origin IS NOT NULL THEN
    applied := jsonb_build_array(p_origin) || applied;
  END IF;

  -- ── 5. Version the category AND every descendant ──────────
  -- A descendant's effective schema changed too, so its history has to
  -- record it or the timeline lies by omission.
  FOR cat_id IN SELECT s.id FROM public.get_category_subtree(p_category_id) s
  LOOP
    SELECT COALESCE(MAX(sv.version), 0) + 1 INTO new_ver
    FROM public.schema_versions sv WHERE sv.category_id = cat_id;

    INSERT INTO public.schema_versions
      (category_id, version, snapshot, authored, change_summary, changed_by)
    SELECT cat_id,
           new_ver,
           public.get_effective_schema(c.id),
           jsonb_build_object('own_fields', c.own_fields, 'overrides', c.overrides),
           applied,
           p_changed_by
    FROM public.categories c WHERE c.id = cat_id;

    IF cat_id = p_category_id THEN
      target_ver := new_ver;
    END IF;
  END LOOP;

  -- ── 6. Stamp the items this migration actually touched ────
  -- Untouched items keep their old schema_version on purpose: that is
  -- what makes "12 items were written against v3 and older" meaningful.
  SELECT COALESCE(array_agg(DISTINCT u.x), ARRAY[]::UUID[]) INTO touched
  FROM unnest(touched) AS u(x);
  SELECT COALESCE(array_agg(DISTINCT u.x), ARRAY[]::UUID[]) INTO orphaned
  FROM unnest(orphaned) AS u(x);

  n_updated  := COALESCE(array_length(touched, 1), 0);
  n_orphaned := COALESCE(array_length(orphaned, 1), 0);

  IF n_updated > 0 THEN
    UPDATE public.items i
       SET schema_version = v.max_ver
      FROM (
        SELECT sv.category_id, MAX(sv.version) AS max_ver
        FROM public.schema_versions sv
        WHERE sv.category_id = ANY(subtree_ids)
        GROUP BY sv.category_id
      ) v
     WHERE i.category_id = v.category_id
       AND i.id = ANY(touched);
  END IF;

  -- ── 7. Report ─────────────────────────────────────────────
  n_incomplete := COALESCE(
    (public.get_item_health_counts(p_category_id, true)->>'incomplete')::int, 0);

  RETURN jsonb_build_object(
    'category_id',      p_category_id,
    'version',          target_ver,
    'items_updated',    n_updated,
    'items_orphaned',   n_orphaned,
    'items_incomplete', n_incomplete,
    'change_summary',   applied
  );
END;
$$;


-- ============================================================
-- 6. rollback_schema_version(category, target_version)  → JSONB
-- ------------------------------------------------------------
-- Restore a category's authored schema from a recorded version and
-- write a NEW FORWARD version describing the restore.
--
-- History is never rewritten. An audit trail that can be edited is not
-- an audit trail — rolling back v5 to v3 produces v6, and v4 and v5
-- remain readable forever.
--
-- ITEM DATA IS NOT REVERTED. Restoring the shape of the schema cannot
-- resurrect values a migration converted or orphaned; those live in
-- data.__orphaned and are restored from the Items tab. The confirm
-- dialog must say this plainly.
--
-- Remediations are chosen automatically and always preserve data:
-- retypes cast (failures orphan), everything else orphans. `discard`
-- is unreachable from here by design.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rollback_schema_version(
  p_category_id    UUID,
  p_target_version INT,
  p_changed_by     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  src        RECORD;
  cur_ver    INT;
  restore_own  JSONB;
  restore_over JSONB;
  analysis   JSONB;
  ch         JSONB;
  rems       JSONB := '{}'::jsonb;
  result     JSONB;
BEGIN
  SELECT sv.version, sv.authored INTO src
  FROM public.schema_versions sv
  WHERE sv.category_id = p_category_id AND sv.version = p_target_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No version % recorded for this category.', p_target_version;
  END IF;

  IF NOT (COALESCE(src.authored, '{}'::jsonb) ? 'own_fields') THEN
    RAISE EXCEPTION
      'Version % predates authored-state recording and cannot be restored automatically. Its snapshot is still readable in the history tab.',
      p_target_version;
  END IF;

  SELECT COALESCE(MAX(sv.version), 0) INTO cur_ver
  FROM public.schema_versions sv WHERE sv.category_id = p_category_id;

  IF p_target_version = cur_ver THEN
    RAISE EXCEPTION 'Version % is already the current schema.', p_target_version;
  END IF;

  restore_own  := COALESCE(src.authored->'own_fields', '[]'::jsonb);
  restore_over := COALESCE(src.authored->'overrides',  '{}'::jsonb);

  -- Auto-remediate: never lose a value on the way back.
  analysis := public.analyze_schema_change(p_category_id, restore_own, restore_over);
  IF (analysis->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Cannot restore version %: %',
      p_target_version, COALESCE(analysis->>'blocked_reason', 'unknown reason');
  END IF;

  FOR ch IN SELECT value FROM jsonb_array_elements(analysis->'changes')
  LOOP
    CONTINUE WHEN ch->>'severity' <> 'destructive';
    rems := rems || jsonb_build_object(
      (ch->>'field_key') || ':' || (ch->>'kind'),
      CASE WHEN ch->>'kind' = 'retype_field'
           THEN '{"strategy":"cast"}'::jsonb
           ELSE '{"strategy":"orphan"}'::jsonb END
    );
  END LOOP;

  result := public.apply_schema_change(
    p_category_id, restore_own, restore_over, rems, p_changed_by,
    jsonb_build_object(
      'kind',                'rollback',
      'field_key',           '__schema',
      'severity',            'warning',
      'from',                cur_ver,
      'to',                  p_target_version,
      'affected_item_count', 0
    )
  );

  RETURN result || jsonb_build_object('restored_from', p_target_version);
END;
$$;

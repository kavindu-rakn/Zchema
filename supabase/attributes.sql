-- ============================================================
-- Zchema — Attribute Registry (Phase 6, Increment 1)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql.
--
-- WHY THIS EXISTS
-- Today `brand` is defined independently on Electronics, Clothing and
-- Home & Kitchen: three unrelated strings that happen to spell the same
-- word. So "show me everything by Sony, anywhere in the catalog" is
-- unanswerable — not because the query is hard, but because the data
-- model never asserted those three fields were the same thing.
--
-- The attribute registry makes that assertion. A category's own_fields
-- entry carries `attribute_id`, and that back-link is what turns three
-- coincidences into one queryable concept.
--
-- ── SYNC SEMANTICS (settled once, here) ─────────────────────
-- Editing an attribute's label / options / unit / description
--   → PROPAGATES to every linked field, immediately, by trigger.
--     These are presentation. No stored item value can be invalidated
--     by them, so there is no blast radius worth showing.
--
-- Editing an attribute's `key` or `type`
--   → REJECTED outright.
--     A global retype could touch thousands of items across unrelated
--     categories at once, and there is no single blast radius to
--     render for that — "this affects 9 categories and 1,400 items,
--     good luck" is not a decision anyone can make. Type changes go
--     through Phase 5's per-category impact flow instead, one category
--     at a time, each with its own remediation. The key is immutable
--     for the same reason item data is keyed on it.
-- ============================================================


-- ============================================================
-- 1. Registry columns
-- ------------------------------------------------------------
-- `group_name` is presentational only ("Physical", "Commercial") —
-- deliberately not a table, because a lookup table for four strings
-- buys nothing and costs a join everywhere.
--
-- `is_system` marks attributes the app itself relies on, so the UI can
-- refuse to delete them without hard-coding a list of keys.
-- ============================================================
ALTER TABLE public.attributes
  ADD COLUMN IF NOT EXISTS group_name TEXT,
  ADD COLUMN IF NOT EXISTS is_system  BOOLEAN NOT NULL DEFAULT false;

-- The same eight types own_fields accepts. Kept as a CHECK rather than
-- a trigger so a bad type cannot be written by any path at all.
ALTER TABLE public.attributes DROP CONSTRAINT IF EXISTS attributes_type_valid;
ALTER TABLE public.attributes ADD CONSTRAINT attributes_type_valid
  CHECK (type IN ('string','text','number','boolean','date','select','multiselect','url'));

ALTER TABLE public.attributes DROP CONSTRAINT IF EXISTS attributes_key_grammar;
ALTER TABLE public.attributes ADD CONSTRAINT attributes_key_grammar
  CHECK (key ~ '^[a-z][a-z0-9_]*$');

CREATE INDEX IF NOT EXISTS idx_attributes_group ON public.attributes (group_name, label);


-- ============================================================
-- 2. get_attribute_usage(p_attribute_id)  → JSONB[]
-- ------------------------------------------------------------
-- Every category whose own_fields links to this attribute, with the
-- field key it uses and its item counts.
--
-- INDEX NOTE: the predicate is written as a jsonb `@>` containment
-- against own_fields specifically so the existing
-- idx_categories_own_fields (GIN, jsonb_ops) can serve it. Writing the
-- obvious `EXISTS (SELECT 1 FROM jsonb_array_elements(...) WHERE
-- elem->>'attribute_id' = ...)` is equivalent and unindexable — it
-- forces a seq scan plus an unnest of every category's field array.
-- Verify with:
--
--   SET enable_seqscan = off;
--   EXPLAIN ANALYZE SELECT * FROM public.categories
--    WHERE own_fields @> '[{"attribute_id":"<uuid>"}]'::jsonb;
--
-- and confirm a Bitmap Index Scan on idx_categories_own_fields. At
-- current row counts the planner will often choose a seq scan anyway
-- because it is genuinely cheaper; that is correct behaviour, and the
-- point is that the index REMAINS available as the catalog grows.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attribute_usage(p_attribute_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.category_name), '[]'::jsonb)
  FROM (
    SELECT c.id                AS category_id,
           c.name              AS category_name,
           c.icon              AS category_icon,
           c.color             AS category_color,
           f.elem->>'key'      AS field_key,
           (f.elem->>'required')::boolean AS required,
           (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id) AS item_count,
           public.count_subtree_items(c.id) AS subtree_item_count
    FROM public.categories c
    CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
    WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', p_attribute_id))
      AND f.elem->>'attribute_id' = p_attribute_id::text
  ) x;
$$;


-- ============================================================
-- 3. get_attributes_with_usage()  → JSONB[]
-- ------------------------------------------------------------
-- The whole library plus a usage count per attribute, in one call, so
-- the list rail does not N+1 across the registry.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attributes_with_usage()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.group_name NULLS LAST, x.label), '[]'::jsonb)
  FROM (
    SELECT a.id, a.key, a.label, a.type, a.options, a.unit, a.description,
           a.group_name, a.is_system, a.created_at, a.updated_at,
           (SELECT count(*)::int
              FROM public.categories c
             WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', a.id))
           ) AS category_count,
           (SELECT COALESCE(sum(sub.n), 0)::int FROM (
              SELECT (SELECT count(*) FROM public.items i WHERE i.category_id = c.id) AS n
                FROM public.categories c
               WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', a.id))
            ) sub) AS item_count
    FROM public.attributes a
  ) x;
$$;


-- ============================================================
-- 4. find_duplicate_field_definitions()  → JSONB[]
-- ------------------------------------------------------------
-- Field keys authored on 2+ categories that are NOT yet linked to an
-- attribute — the candidates for promotion.
--
-- This is how the library gets populated. Asking someone to sit down
-- and model their attributes before they have any data is how you get
-- an empty registry; showing them "you have written `brand` three
-- times, want to make it one thing?" is how you get a full one.
--
-- `types_agree` matters: promoting a key defined as `string` on one
-- category and `number` on another would have to coerce one of them,
-- and coercing silently is exactly what this project refuses to do.
-- Each entry reports the disagreement so the UI can say so.
--
-- Each entry:
--   { key, label, type, types_agree, types, category_count,
--     item_count, categories: [{ id, name, type, item_count }] }
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_duplicate_field_definitions()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH authored AS (
    SELECT c.id                       AS category_id,
           c.name                     AS category_name,
           f.elem->>'key'             AS field_key,
           f.elem->>'label'           AS field_label,
           f.elem->>'type'            AS field_type,
           f.elem->>'attribute_id'    AS attribute_id,
           (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id) AS item_count
    FROM public.categories c
    CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
  ),
  -- A key is a candidate only if NO definition of it is linked yet.
  -- Once one is promoted the rest are back-linked by
  -- promote_field_to_attribute, so a partially-linked key means someone
  -- is mid-migration and does not need nagging about it.
  unlinked AS (
    SELECT field_key
    FROM authored
    GROUP BY field_key
    HAVING count(*) > 1 AND count(attribute_id) = 0
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.category_count DESC, x.key), '[]'::jsonb)
  FROM (
    SELECT a.field_key                              AS key,
           min(a.field_label)                       AS label,
           mode() WITHIN GROUP (ORDER BY a.field_type) AS type,
           count(DISTINCT a.field_type) = 1         AS types_agree,
           to_jsonb(array_agg(DISTINCT a.field_type)) AS types,
           count(*)::int                            AS category_count,
           sum(a.item_count)::int                   AS item_count,
           jsonb_agg(jsonb_build_object(
             'id',         a.category_id,
             'name',       a.category_name,
             'type',       a.field_type,
             'item_count', a.item_count
           ) ORDER BY a.category_name)              AS categories
    FROM authored a
    JOIN unlinked u ON u.field_key = a.field_key
    GROUP BY a.field_key
  ) x;
$$;


-- ============================================================
-- 5. promote_field_to_attribute(category, field_key, group_name)
-- ------------------------------------------------------------
-- Create an attribute from an existing field and back-link every
-- matching field across the catalog WHOSE TYPE MATCHES.
--
-- Type mismatches are reported, never coerced. Rewriting a category's
-- `number` field to `string` because a different category happened to
-- spell the key the same way would be a schema change with real item
-- consequences, smuggled in under the word "promote".
--
-- Returns { attribute_id, key, linked, skipped: [{ id, name, type }] }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_field_to_attribute(
  p_category_id UUID,
  p_field_key   TEXT,
  p_group_name  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  src        JSONB;
  v_attr_id  UUID;
  v_type     TEXT;
  linked     INT := 0;
  skipped    JSONB := '[]'::jsonb;
  targets    JSONB;
  cat        JSONB;
BEGIN
  PERFORM public.require_schema_admin();

  -- The field being promoted, as authored on the source category.
  SELECT f.elem INTO src
  FROM public.categories c
  CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
  WHERE c.id = p_category_id AND f.elem->>'key' = p_field_key;

  IF src IS NULL THEN
    RAISE EXCEPTION 'Category % does not define a field called "%".', p_category_id, p_field_key;
  END IF;

  v_type := src->>'type';

  IF EXISTS (SELECT 1 FROM public.attributes a WHERE a.key = p_field_key) THEN
    RAISE EXCEPTION
      'An attribute called "%" already exists. Link the field to it instead of promoting again.',
      p_field_key;
  END IF;

  INSERT INTO public.attributes (key, label, type, options, unit, description, group_name)
  VALUES (
    p_field_key,
    COALESCE(src->>'label', p_field_key),
    v_type,
    COALESCE(src->'options', '[]'::jsonb),
    src->>'unit',
    src->>'help_text',
    p_group_name
  )
  RETURNING id INTO v_attr_id;

  -- Collect the targets BEFORE writing any of them. Iterating a cursor
  -- over the same table the loop body updates is the kind of thing that
  -- works until it doesn't; materialising the list first makes the set
  -- unambiguous.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'type', f.elem->>'type')), '[]'::jsonb)
    INTO targets
  FROM public.categories c
  CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
  WHERE f.elem->>'key' = p_field_key;

  -- One statement per category rather than one big rewrite, because
  -- each write has to pass validate_category_fields on its own.
  FOR cat IN SELECT value FROM jsonb_array_elements(targets)
  LOOP
    IF cat->>'type' IS DISTINCT FROM v_type THEN
      skipped := skipped || jsonb_build_array(cat);
      CONTINUE;
    END IF;

    UPDATE public.categories c
       SET own_fields = (
             SELECT jsonb_agg(
                      CASE WHEN e->>'key' = p_field_key
                           THEN e || jsonb_build_object('attribute_id', v_attr_id)
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(c.own_fields) WITH ORDINALITY AS t(e, ord)
           )
     WHERE c.id = (cat->>'id')::uuid;

    linked := linked + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'attribute_id', v_attr_id,
    'key',          p_field_key,
    'type',         v_type,
    'linked',       linked,
    'skipped',      skipped
  );
END;
$$;


-- ============================================================
-- 6. Sync: propagate presentation, refuse structure
-- ------------------------------------------------------------
-- See the header for the reasoning. In short: label/options/unit/
-- description are presentation and propagate; key/type are structure
-- and are rejected, because a global retype has no single blast radius
-- to show and Phase 5's per-category flow does.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_attribute_to_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  patch   JSONB := '{}'::jsonb;
  targets UUID[];
  cat_id  UUID;
BEGIN
  -- ── Structure is immutable ────────────────────────────────
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION
      'An attribute key cannot change: item data is stored against "%". Create a new attribute and migrate the categories that use it.',
      OLD.key;
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION
      'An attribute type cannot change globally (% → %). It is used by % categor(y/ies), and a single retype gives no blast radius anyone can assess. Change the type on each category''s Schema tab instead, where the impact is measured against that category''s own items.',
      OLD.type, NEW.type,
      (SELECT count(*) FROM public.categories c
        WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', OLD.id)));
  END IF;

  -- ── Presentation propagates ───────────────────────────────
  IF NEW.label IS DISTINCT FROM OLD.label THEN
    patch := patch || jsonb_build_object('label', NEW.label);
  END IF;
  IF NEW.options IS DISTINCT FROM OLD.options THEN
    patch := patch || jsonb_build_object('options', NEW.options);
  END IF;
  IF NEW.unit IS DISTINCT FROM OLD.unit THEN
    patch := patch || jsonb_build_object('unit', NEW.unit);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    patch := patch || jsonb_build_object('help_text', NEW.description);
  END IF;

  IF patch = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- Per-category updates so each one passes validate_category_fields
  -- on its own terms. Removing a select option here can strand item
  -- values, which is why the UI states the propagation count before
  -- saving — the trigger itself cannot ask.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::UUID[]) INTO targets
  FROM public.categories c
  WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', NEW.id));

  FOREACH cat_id IN ARRAY targets LOOP
    UPDATE public.categories c
       SET own_fields = (
             SELECT jsonb_agg(
                      CASE WHEN e->>'attribute_id' = NEW.id::text
                           THEN e || patch
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(c.own_fields) WITH ORDINALITY AS t(e, ord)
           )
     WHERE c.id = cat_id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attributes_sync_fields ON public.attributes;
CREATE TRIGGER attributes_sync_fields
  BEFORE UPDATE ON public.attributes
  FOR EACH ROW EXECUTE FUNCTION public.sync_attribute_to_fields();


-- ============================================================
-- 7. Unlink on delete
-- ------------------------------------------------------------
-- Deleting an attribute must NOT delete the fields that referenced it.
-- Those fields hold live item data; the link is provenance, exactly as
-- blueprints are. Strip `attribute_id` and leave the field standing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.unlink_attribute_from_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  targets UUID[];
  cat_id  UUID;
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION
      'The "%" attribute is a system attribute and cannot be deleted.', OLD.key;
  END IF;

  -- Materialise first: this loop's UPDATE strips the very key its
  -- predicate matches on, so a cursor over the live table would be
  -- deleting the ground it is standing on.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::UUID[]) INTO targets
  FROM public.categories c
  WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', OLD.id));

  FOREACH cat_id IN ARRAY targets LOOP
    UPDATE public.categories c
       SET own_fields = (
             SELECT jsonb_agg(
                      CASE WHEN e->>'attribute_id' = OLD.id::text
                           THEN e - 'attribute_id'
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(c.own_fields) WITH ORDINALITY AS t(e, ord)
           )
     WHERE c.id = cat_id;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS attributes_unlink_fields ON public.attributes;
CREATE TRIGGER attributes_unlink_fields
  BEFORE DELETE ON public.attributes
  FOR EACH ROW EXECUTE FUNCTION public.unlink_attribute_from_fields();

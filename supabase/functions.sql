-- ============================================================
-- SchemaShift — Schema Resolver Functions (Phase 1, Increment 2)
-- Source this AFTER schema.sql.
--
-- These functions are the CONTRACT every later phase reads from.
-- The client-side mirror in src/lib/schema.ts (Increment 5) must
-- reproduce get_effective_schema()'s algorithm exactly.
-- ============================================================


-- ============================================================
-- 1. get_category_ancestors(p_category_id)
-- ------------------------------------------------------------
-- Recursive CTE walking UPWARD from the target category.
--   depth = 0  → the target itself
--   depth = 1  → its parent, and so on toward the root
-- Result is ordered ROOT-FIRST (depth DESC) so callers can fold
-- fields in inheritance order.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_ancestors(p_category_id UUID)
RETURNS TABLE(id UUID, name TEXT, own_fields JSONB, overrides JSONB, depth INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.name, c.own_fields, c.overrides, c.parent_id, 0 AS depth
    FROM public.categories c
    WHERE c.id = p_category_id
    UNION ALL
    SELECT c.id, c.name, c.own_fields, c.overrides, c.parent_id, ch.depth + 1
    FROM public.categories c
    JOIN chain ch ON c.id = ch.parent_id
  )
  SELECT chain.id, chain.name, chain.own_fields, chain.overrides, chain.depth
  FROM chain
  ORDER BY chain.depth DESC;
$$;


-- ============================================================
-- 2. get_effective_schema(p_category_id)  → JSONB[]  (EffectiveField[])
-- ------------------------------------------------------------
-- Folds own_fields down the ancestor chain and applies overrides.
-- MUST agree, key-for-key, with resolveEffectiveSchema() in
-- src/lib/schema.ts. Keep the algorithm comments identical.
--
-- Algorithm:
--   1. Empty ordered accumulator.
--   2. Root → target: append every own_field, stamped with source
--      + depth + inherited + overridden_by=[]. Skip a key already
--      accumulated (duplicates are trigger-prevented, but never throw).
--   3. Root → target again: apply each ancestor's overrides to the
--      matching accumulated field. Only label/required/options/
--      default/help_text/position are patchable; append the patching
--      category id to overridden_by.
--   4. Sort by (depth DESC, position ASC, label ASC).
--   5. Return a JSONB array of EffectiveField.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_schema(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anc      RECORD;
  fld      JSONB;
  acc      JSONB := '[]'::jsonb;               -- ordered accumulator
  seen     TEXT[] := ARRAY[]::TEXT[];          -- keys already accumulated
  k        TEXT;
  o_key    TEXT;                               -- override target key
  o_patch  JSONB;                              -- override patch object
  p_key    TEXT;                               -- patch property key
  p_val    JSONB;                              -- patch property value
  idx      INT;
  cur      JSONB;
  patched  JSONB;
  allowed  TEXT[] := ARRAY['label','required','options','default','help_text','position'];
BEGIN
  -- ── Pass 1: fold own_fields, root → target ─────────────────
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    IF jsonb_typeof(COALESCE(anc.own_fields, '[]'::jsonb)) <> 'array' THEN
      CONTINUE;
    END IF;
    FOR fld IN SELECT value FROM jsonb_array_elements(anc.own_fields)
    LOOP
      k := fld->>'key';
      IF k IS NULL THEN CONTINUE; END IF;
      IF k = ANY(seen) THEN CONTINUE; END IF;   -- duplicate: skip, never throw
      seen := array_append(seen, k);
      acc := acc || jsonb_build_array(
        fld
        || jsonb_build_object(
             'source_category_id',   anc.id,
             'source_category_name', anc.name,
             'depth',                anc.depth,
             'inherited',            anc.depth > 0,
             'overridden_by',        '[]'::jsonb
           )
      );
    END LOOP;
  END LOOP;

  -- ── Pass 2: apply overrides, root → target ─────────────────
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    IF jsonb_typeof(COALESCE(anc.overrides, '{}'::jsonb)) <> 'object' THEN
      CONTINUE;
    END IF;
    FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(anc.overrides)
    LOOP
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
          EXIT;  -- one field per key; stop scanning
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ── Pass 3: sort (depth DESC, position ASC, label ASC) ─────
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
-- 3. get_category_subtree(p_category_id)
-- ------------------------------------------------------------
-- Recursive CTE walking DOWNWARD, INCLUDING the target (depth 0).
-- Used everywhere "and all its descendants" is needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_subtree(p_category_id UUID)
RETURNS TABLE(id UUID, depth INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE sub AS (
    SELECT c.id, 0 AS depth
    FROM public.categories c
    WHERE c.id = p_category_id
    UNION ALL
    SELECT c.id, s.depth + 1
    FROM public.categories c
    JOIN sub s ON c.parent_id = s.id
  )
  SELECT sub.id, sub.depth FROM sub;
$$;


-- ============================================================
-- 4. count_subtree_items(p_category_id)
-- ------------------------------------------------------------
-- Count of items on the category and every descendant.
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_subtree_items(p_category_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM public.items
  WHERE category_id IN (SELECT s.id FROM public.get_category_subtree(p_category_id) s);
$$;


-- ============================================================
-- 5. get_category_tree()  → JSONB[]  (flat CategoryNode-ish list)
-- ------------------------------------------------------------
-- One call returning the whole tree with counts, so the UI never
-- N+1s. Returned FLAT; nesting is assembled client-side.
-- Each node carries the full category row PLUS the four counts, so the
-- payload satisfies the canonical CategoryNode type in src/lib/types.ts
-- without any partial-object casting, and Phase 3's schema editor gets
-- own_fields/overrides from the same single call.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_tree()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                    c.id,
        'name',                  c.name,
        'slug',                  c.slug,
        'description',           c.description,
        'parent_id',             c.parent_id,
        'blueprint_id',          c.blueprint_id,
        'own_fields',            c.own_fields,
        'overrides',             c.overrides,
        'icon',                  c.icon,
        'color',                 c.color,
        'position',              c.position,
        'created_at',            c.created_at,
        'updated_at',            c.updated_at,
        'own_field_count',       jsonb_array_length(COALESCE(c.own_fields, '[]'::jsonb)),
        'inherited_field_count', (
          SELECT count(*)::int
          FROM jsonb_array_elements(public.get_effective_schema(c.id)) e
          WHERE (e->>'inherited')::boolean
        ),
        'item_count',            (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id),
        'subtree_item_count',    public.count_subtree_items(c.id)
      )
      ORDER BY c.position ASC, c.name ASC
    ),
    '[]'::jsonb)
  FROM public.categories c;
$$;


-- ============================================================
-- 6. get_items_missing_required()  → JSONB[]
-- ------------------------------------------------------------
-- Categories holding items that are blank for a field the EFFECTIVE
-- schema marks required — including fields that only became required
-- through an inherited override.
--
-- Resolves the schema once PER CATEGORY (not per item): doing this in
-- the client would mean one round trip per category, and doing it
-- naively in SQL would call the resolver once per row.
--
-- Each node: category_id, category_name, missing_count.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_items_missing_required()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH required_by_category AS (
    SELECT c.id                        AS category_id,
           c.name                      AS category_name,
           array_agg(f.elem->>'key')   AS required_keys
    FROM public.categories c
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem)
    WHERE (f.elem->>'required')::boolean
    GROUP BY c.id, c.name
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.missing_count DESC), '[]'::jsonb)
  FROM (
    SELECT r.category_id,
           r.category_name,
           count(*)::int AS missing_count
    FROM required_by_category r
    JOIN public.items i ON i.category_id = r.category_id
    WHERE EXISTS (
      SELECT 1
      FROM unnest(r.required_keys) AS k
      WHERE NOT (i.data ? k)
         OR i.data->>k IS NULL
         OR btrim(i.data->>k) = ''
    )
    GROUP BY r.category_id, r.category_name
  ) x;
$$;

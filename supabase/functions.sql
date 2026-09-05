-- ============================================================
-- Zchema — Schema Resolver Functions (Phase 1, Increment 2)
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


-- ============================================================
-- 7. query_items(...)  → JSONB { total, rows }
-- ------------------------------------------------------------
-- Server-side sort, filter and pagination for the items table.
--
-- WHY THIS IS SQL AND NOT A POSTGREST QUERY
-- Sorting `data->>'ram_gb'` as text puts 8 after 16. Correct ordering
-- needs a cast chosen by the field's type, which PostgREST cannot
-- express — and sorting only the current page is wrong anyway.
--
-- SAFETY: p_sort_key and every filter key are validated against the
-- field-key grammar before being interpolated, and all values go
-- through %L. A key that does not match is ignored rather than run.
--
-- p_filters is a JSONB array of:
--   { key, type, op, value, value2 }
--     op: contains | eq | in | range | bool | is_empty | not_empty
--
-- p_stale_before (Phase 5) filters on items.schema_version, a real
-- COLUMN rather than a key inside `data`, so it cannot be expressed as
-- one of the p_filters entries. It backs the History tab's
-- "12 items were written against v3 and older" link.
-- ============================================================

-- Adding a parameter to an existing function creates an OVERLOAD rather
-- than replacing it, and two candidates would make every PostgREST call
-- ambiguous. Drop the previous signature first.
DROP FUNCTION IF EXISTS public.query_items(UUID, BOOLEAN, TEXT, TEXT, TEXT, JSONB, INT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.query_items(
  p_category_id     UUID,
  p_include_subtree BOOLEAN DEFAULT false,
  p_sort_key        TEXT    DEFAULT NULL,
  p_sort_type       TEXT    DEFAULT 'string',
  p_sort_dir        TEXT    DEFAULT 'asc',
  p_filters         JSONB   DEFAULT '[]'::jsonb,
  p_limit           INT     DEFAULT 50,
  p_offset          INT     DEFAULT 0,
  -- 'incomplete' | 'orphaned' | NULL. Drives the one-click health
  -- filters in the Items tab header strip.
  p_health          TEXT    DEFAULT NULL,
  -- Items written against a schema_version STRICTLY BELOW this.
  p_stale_before    INT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  key_re     CONSTANT TEXT := '^[a-z][a-z0-9_]*$';
  where_sql  TEXT := 'TRUE';
  order_sql  TEXT;
  dir        TEXT;
  flt        JSONB;
  fkey       TEXT;
  fop        TEXT;
  ftype      TEXT;
  fval       TEXT;
  fval2      TEXT;
  cast_expr    TEXT;
  scope_sql    TEXT;
  health_cte   TEXT := '';
  health_join  TEXT := '';
  health_where TEXT := '';
  total        INT;
  rows_json    JSONB;
BEGIN
  dir := CASE WHEN lower(COALESCE(p_sort_dir, 'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;

  -- ── Scope: this category, or the whole subtree ────────────
  IF p_include_subtree THEN
    scope_sql := format(
      'i.category_id IN (SELECT s.id FROM public.get_category_subtree(%L::uuid) s)',
      p_category_id
    );
  ELSE
    scope_sql := format('i.category_id = %L::uuid', p_category_id);
  END IF;

  -- ── Filters ───────────────────────────────────────────────
  FOR flt IN SELECT value FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
  LOOP
    fkey  := flt->>'key';
    fop   := COALESCE(flt->>'op', 'contains');
    ftype := COALESCE(flt->>'type', 'string');
    fval  := flt->>'value';
    fval2 := flt->>'value2';

    CONTINUE WHEN fkey IS NULL OR fkey !~ key_re;

    IF fop = 'is_empty' THEN
      where_sql := where_sql || format(
        ' AND (NOT (i.data ? %L) OR i.data->>%L IS NULL OR btrim(i.data->>%L) = %L)',
        fkey, fkey, fkey, ''
      );

    ELSIF fop = 'not_empty' THEN
      where_sql := where_sql || format(
        ' AND (i.data ? %L AND i.data->>%L IS NOT NULL AND btrim(i.data->>%L) <> %L)',
        fkey, fkey, fkey, ''
      );

    ELSIF fval IS NULL OR fval = '' THEN
      CONTINUE;

    ELSIF fop = 'contains' THEN
      where_sql := where_sql || format(
        ' AND i.data->>%L ILIKE %L', fkey, '%' || fval || '%'
      );

    ELSIF fop = 'eq' THEN
      where_sql := where_sql || format(' AND i.data->>%L = %L', fkey, fval);

    ELSIF fop = 'bool' THEN
      where_sql := where_sql || format(
        ' AND (i.data->>%L)::boolean = %L::boolean', fkey, fval
      );

    ELSIF fop = 'in' THEN
      -- `value` is a comma-separated list of allowed values.
      where_sql := where_sql || format(
        ' AND i.data->>%L = ANY (string_to_array(%L, %L))', fkey, fval, ','
      );

    ELSIF fop = 'range' THEN
      -- Guard the cast: a non-numeric stray value would abort the query.
      where_sql := where_sql || format(
        ' AND (i.data->>%L) ~ %L', fkey, '^-?[0-9]+(\.[0-9]+)?$'
      );
      IF fval IS NOT NULL AND fval <> '' THEN
        where_sql := where_sql || format(
          ' AND (i.data->>%L)::numeric >= %L::numeric', fkey, fval
        );
      END IF;
      IF fval2 IS NOT NULL AND fval2 <> '' THEN
        where_sql := where_sql || format(
          ' AND (i.data->>%L)::numeric <= %L::numeric', fkey, fval2
        );
      END IF;
    END IF;
  END LOOP;

  -- ── Health filter ─────────────────────────────────────────
  -- "Incomplete" means missing a value for a REQUIRED field of the
  -- item's own effective schema. Required keys are resolved once per
  -- category in a CTE, not once per row.
  IF p_health = 'incomplete' THEN
    health_cte := format(
      'WITH req AS ('
      || 'SELECT c.id AS category_id, '
      || 'COALESCE(array_agg(f.elem->>%L) FILTER (WHERE (f.elem->>%L)::boolean), ARRAY[]::text[]) AS required_keys '
      || 'FROM public.categories c '
      || 'CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem) '
      || 'WHERE c.id IN (SELECT DISTINCT i2.category_id FROM public.items i2 WHERE %s) '
      || 'GROUP BY c.id) ',
      'key', 'required',
      replace(scope_sql, 'i.', 'i2.')
    );
    health_join  := 'LEFT JOIN req r ON r.category_id = i.category_id';
    health_where := format(
      ' AND EXISTS (SELECT 1 FROM unnest(COALESCE(r.required_keys, ARRAY[]::text[])) AS k'
      || ' WHERE NOT (i.data ? k) OR i.data->>k IS NULL OR btrim(i.data->>k) = %L)',
      ''
    );
  ELSIF p_health = 'orphaned' THEN
    health_where := format(
      ' AND (i.data ? %L) AND i.data->%L <> %L::jsonb',
      '__orphaned', '__orphaned', '{}'
    );
  END IF;

  -- ── Stale-schema filter ───────────────────────────────────
  IF p_stale_before IS NOT NULL THEN
    where_sql := where_sql || format(' AND i.schema_version < %L::int', p_stale_before);
  END IF;

  -- ── Sort ──────────────────────────────────────────────────
  IF p_sort_key IS NULL OR p_sort_key = '' THEN
    order_sql := 'i.created_at DESC';
  ELSIF p_sort_key = 'created_at' OR p_sort_key = 'updated_at' THEN
    order_sql := format('i.%I %s', p_sort_key, dir);
  ELSIF p_sort_key !~ key_re THEN
    order_sql := 'i.created_at DESC';
  ELSE
    -- The cast is what makes 8 sort before 16, and 2024-02 before
    -- 2024-10. NULLIF+regex keeps a stray non-numeric value from
    -- aborting the whole query.
    cast_expr := CASE p_sort_type
      WHEN 'number' THEN format(
        '(CASE WHEN i.data->>%L ~ %L THEN (i.data->>%L)::numeric END)',
        p_sort_key, '^-?[0-9]+(\.[0-9]+)?$', p_sort_key
      )
      WHEN 'date' THEN format(
        '(CASE WHEN i.data->>%L ~ %L THEN (i.data->>%L)::date END)',
        p_sort_key, '^\d{4}-\d{2}-\d{2}', p_sort_key
      )
      WHEN 'boolean' THEN format(
        '(CASE WHEN i.data->>%L IN (%L,%L) THEN (i.data->>%L)::boolean END)',
        p_sort_key, 'true', 'false', p_sort_key
      )
      ELSE format('lower(i.data->>%L)', p_sort_key)
    END;
    order_sql := format('%s %s NULLS LAST, i.created_at DESC', cast_expr, dir);
  END IF;

  -- ── Count, then page ──────────────────────────────────────
  EXECUTE format(
    '%s SELECT count(*)::int FROM public.items i %s WHERE %s AND %s %s',
    health_cte, health_join, scope_sql, where_sql, health_where
  ) INTO total;

  EXECUTE format(
    '%s SELECT COALESCE(jsonb_agg(rw ORDER BY rw.ord), %L::jsonb) FROM ('
    || 'SELECT row_number() OVER (ORDER BY %s) AS ord, i.id, i.category_id, i.data, '
    || 'i.schema_version, i.created_at, i.updated_at, c.name AS category_name '
    || 'FROM public.items i JOIN public.categories c ON c.id = i.category_id %s '
    || 'WHERE %s AND %s %s ORDER BY %s LIMIT %s OFFSET %s'
    || ') rw',
    health_cte, '[]', order_sql, health_join, scope_sql, where_sql, health_where, order_sql,
    GREATEST(COALESCE(p_limit, 50), 1), GREATEST(COALESCE(p_offset, 0), 0)
  ) INTO rows_json;

  RETURN jsonb_build_object('total', COALESCE(total, 0), 'rows', COALESCE(rows_json, '[]'::jsonb));
END;
$$;


-- ============================================================
-- 8. move_items(p_item_ids, p_target_category_id)  → JSONB
-- ------------------------------------------------------------
-- Move items between categories, reconciling their data with the
-- target's schema in ONE transaction.
--
-- An item's data was written against its old category's effective
-- schema. Moving it means three things happen to each value:
--   * key in BOTH schemas      → carried across untouched
--   * key only in the SOURCE   → moved to data.__orphaned (never
--                                deleted — Phase 5 surfaces it)
--   * key only in the TARGET   → left empty; the item simply reads as
--                                incomplete afterwards
--
-- Returns the counts so the caller can report what happened.
-- ============================================================
CREATE OR REPLACE FUNCTION public.move_items(
  p_item_ids           UUID[],
  p_target_category_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_keys    TEXT[];
  src_keys       TEXT[];
  it             RECORD;
  k              TEXT;
  new_data       JSONB;
  orphan_obj     JSONB;
  target_version INT;
  moved          INT := 0;
  carried        INT := 0;
  orphaned       INT := 0;
BEGIN
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('moved', 0, 'carried', 0, 'orphaned', 0);
  END IF;

  SELECT COALESCE(array_agg(e->>'key'), ARRAY[]::TEXT[]) INTO target_keys
  FROM jsonb_array_elements(public.get_effective_schema(p_target_category_id)) e;

  SELECT COALESCE(MAX(version), 1) INTO target_version
  FROM public.schema_versions WHERE category_id = p_target_category_id;

  FOR it IN
    SELECT i.id, i.category_id, i.data FROM public.items i WHERE i.id = ANY(p_item_ids)
  LOOP
    -- Skip items already in the target: nothing to reconcile.
    CONTINUE WHEN it.category_id = p_target_category_id;

    SELECT COALESCE(array_agg(e->>'key'), ARRAY[]::TEXT[]) INTO src_keys
    FROM jsonb_array_elements(public.get_effective_schema(it.category_id)) e;

    new_data   := '{}'::jsonb;
    orphan_obj := COALESCE(it.data->'__orphaned', '{}'::jsonb);

    FOREACH k IN ARRAY src_keys LOOP
      CONTINUE WHEN NOT (it.data ? k);
      IF k = ANY(target_keys) THEN
        new_data := new_data || jsonb_build_object(k, it.data->k);
        carried  := carried + 1;
      ELSE
        orphan_obj := orphan_obj || jsonb_build_object(k, it.data->k);
        orphaned   := orphaned + 1;
      END IF;
    END LOOP;

    IF orphan_obj <> '{}'::jsonb THEN
      new_data := new_data || jsonb_build_object('__orphaned', orphan_obj);
    END IF;

    UPDATE public.items
       SET category_id    = p_target_category_id,
           data           = new_data,
           schema_version = target_version
     WHERE id = it.id;

    moved := moved + 1;
  END LOOP;

  RETURN jsonb_build_object('moved', moved, 'carried', carried, 'orphaned', orphaned);
END;
$$;


-- ============================================================
-- 9. get_incomplete_items(p_category_id, p_include_subtree)
-- ------------------------------------------------------------
-- Items missing a value for a field their effective schema marks
-- required. In SQL so the dashboard can ask this across the tree
-- cheaply, resolving each schema once per category rather than once
-- per item.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_incomplete_items(
  p_category_id     UUID,
  p_include_subtree BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT CASE
      WHEN p_include_subtree
        THEN (SELECT array_agg(s.id) FROM public.get_category_subtree(p_category_id) s)
      ELSE ARRAY[p_category_id]
    END AS ids
  ),
  required_by_category AS (
    SELECT c.id AS category_id,
           COALESCE(array_agg(f.elem->>'key') FILTER (
             WHERE (f.elem->>'required')::boolean
           ), ARRAY[]::TEXT[]) AS required_keys
    FROM public.categories c
    CROSS JOIN scope
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem)
    WHERE c.id = ANY(scope.ids)
    GROUP BY c.id
  )
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
  FROM (
    SELECT i.id,
           i.category_id,
           COALESCE(array_to_json(ARRAY(
             SELECT k FROM unnest(r.required_keys) AS k
             WHERE NOT (i.data ? k)
                OR i.data->>k IS NULL
                OR btrim(i.data->>k) = ''
           ))::jsonb, '[]'::jsonb) AS missing_required
    FROM public.items i
    JOIN required_by_category r ON r.category_id = i.category_id
    WHERE EXISTS (
      SELECT 1 FROM unnest(r.required_keys) AS k
      WHERE NOT (i.data ? k)
         OR i.data->>k IS NULL
         OR btrim(i.data->>k) = ''
    )
  ) x;
$$;


-- ============================================================
-- 10. get_item_health_counts(p_category_id, p_include_subtree)
-- ------------------------------------------------------------
-- Totals for the Items tab header strip:
--   "48 items · 5 incomplete · 2 with orphaned data"
--
-- Required keys are resolved ONCE PER CATEGORY via a CTE rather than
-- once per item — the same reason get_items_missing_required exists.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_item_health_counts(
  p_category_id     UUID,
  p_include_subtree BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT CASE
      WHEN p_include_subtree
        THEN (SELECT array_agg(s.id) FROM public.get_category_subtree(p_category_id) s)
      ELSE ARRAY[p_category_id]
    END AS ids
  ),
  req AS (
    SELECT c.id AS category_id,
           COALESCE(array_agg(f.elem->>'key') FILTER (
             WHERE (f.elem->>'required')::boolean
           ), ARRAY[]::TEXT[]) AS required_keys
    FROM public.categories c
    CROSS JOIN scope
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem)
    WHERE c.id = ANY(scope.ids)
    GROUP BY c.id
  ),
  scoped AS (
    SELECT i.id, i.data, r.required_keys
    FROM public.items i
    CROSS JOIN scope
    LEFT JOIN req r ON r.category_id = i.category_id
    WHERE i.category_id = ANY(scope.ids)
  )
  SELECT jsonb_build_object(
    'total', count(*)::int,
    'incomplete', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM unnest(COALESCE(s.required_keys, ARRAY[]::TEXT[])) AS k
      WHERE NOT (s.data ? k) OR s.data->>k IS NULL OR btrim(s.data->>k) = ''
    ))::int,
    'orphaned', count(*) FILTER (
      WHERE s.data ? '__orphaned' AND s.data->'__orphaned' <> '{}'::jsonb
    )::int
  )
  FROM scoped s;
$$;


-- ============================================================
-- 11. count_categories_with_orphans()  → JSONB[]
-- ------------------------------------------------------------
-- Categories holding items with orphaned values, for the dashboard's
-- attention panel.
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_categories_with_orphans()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.orphan_count DESC), '[]'::jsonb)
  FROM (
    SELECT i.category_id,
           c.name AS category_name,
           count(*)::int AS orphan_count
    FROM public.items i
    JOIN public.categories c ON c.id = i.category_id
    WHERE i.data ? '__orphaned' AND i.data->'__orphaned' <> '{}'::jsonb
    GROUP BY i.category_id, c.name
  ) x;
$$;

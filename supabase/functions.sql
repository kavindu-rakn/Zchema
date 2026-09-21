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
-- 1b. try_numeric(text) → NUMERIC or NULL
-- ------------------------------------------------------------
-- THE CLASSIC JSONB FOOTGUN.
--
-- `WHERE (data->>'price')::numeric > 500` does not fail on the rows it
-- rejects — it fails on the rows it never meant to touch. One item in
-- one unrelated category holding "call for pricing" in a key that
-- happens to be spelled `price` aborts the entire query with
-- "invalid input syntax for type numeric". Across a catalog-wide
-- search that is not an edge case, it is Tuesday.
--
-- Every numeric read of JSONB goes through this — the one guarding
-- strategy in the codebase. (Moved here from search.sql so that every
-- file loaded after this one can rely on it.)
--
-- Guarding with a regex rather than a BEGIN/EXCEPTION block keeps the
-- function inlinable and parallel-safe; an exception block would force
-- a subtransaction per row.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_numeric(p_value TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value ~ '^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$'
    THEN btrim(p_value)::numeric
  END;
$$;


-- ============================================================
-- 1c. try_boolean(text) / try_date(text) → value or NULL
-- ------------------------------------------------------------
-- The same footgun for the other two types item data is filtered and
-- sorted by. `(data->>'in_stock')::boolean` aborts on one "maybe";
-- `::date` aborts on "2024-02-30", which a digits-and-dashes regex
-- happily lets through. Both return NULL instead of raising.
--
-- try_boolean accepts the unambiguous spellings Postgres itself does
-- (true/false, t/f, yes/no, y/n, on/off, 1/0, any case).
--
-- try_date reads the leading YYYY-MM-DD and checks the day against the
-- month's real length. The nested CASE is load-bearing: CASE evaluates
-- its branches in order, so make_date() never sees a month that is out
-- of range — no exception handler, and so no subtransaction per row.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_boolean(p_value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE lower(btrim(p_value))
    WHEN 'true'  THEN true  WHEN 't' THEN true  WHEN 'yes' THEN true
    WHEN 'y'     THEN true  WHEN 'on' THEN true WHEN '1'   THEN true
    WHEN 'false' THEN false WHEN 'f' THEN false WHEN 'no'  THEN false
    WHEN 'n'     THEN false WHEN 'off' THEN false WHEN '0' THEN false
  END;
$$;

CREATE OR REPLACE FUNCTION public.try_date(p_value TEXT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN d.parts IS NULL THEN NULL
    WHEN d.parts[1]::int = 0 OR d.parts[2]::int NOT BETWEEN 1 AND 12 THEN NULL
    WHEN d.parts[3]::int BETWEEN 1 AND extract(
           day FROM make_date(d.parts[1]::int, d.parts[2]::int, 1)
                    + interval '1 month' - interval '1 day')::int
      THEN make_date(d.parts[1]::int, d.parts[2]::int, d.parts[3]::int)
  END
  FROM (SELECT regexp_match(p_value, '^\s*(\d{4})-(\d{2})-(\d{2})') AS parts) d;
$$;


-- ============================================================
-- 2. get_effective_schema(p_category_id)  → JSONB[]  (EffectiveField[])
-- ------------------------------------------------------------
-- Folds own_fields down the ancestor chain and applies overrides.
-- One of THREE implementations that must agree: this one,
-- resolve_schema_preview() in impact.sql, and resolveEffectiveSchema()
-- in src/lib/schema.ts. Keep the algorithm comments identical — a test
-- checks that they are — and prove behaviour against the shared
-- fixture, supabase/tests/fixtures/resolver-cases.json.
--
-- Algorithm:
--   1. Empty ordered accumulator.
--   2. Root → target: append every own_field, stamped with source
--      + depth + inherited + overridden_by=[]. Skip a field whose key is
--      missing, empty or not a string, and a key already accumulated
--      (duplicates are trigger-prevented, but never throw).
--   3. Root → target again: apply each ancestor's overrides to the
--      matching accumulated field, skipping any patch that is not an
--      object. Only label/required/options/default/help_text/position
--      are patchable; append the patching category id to overridden_by.
--   4. Sort by depth DESC, position ASC, label ASC, key ASC. A position
--      is a number or a numeric string (try_numeric's rule); anything
--      else counts as 0. Labels and keys compare by code point, so every
--      implementation orders ties identically.
--   5. Return the fields as an array of EffectiveField.
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
      IF jsonb_typeof(fld->'key') IS DISTINCT FROM 'string' OR k = '' THEN CONTINUE; END IF;
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
      -- jsonb_each() below raises on anything but an object, which used to
      -- take the whole resolver down over one malformed patch.
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
          EXIT;  -- one field per key; stop scanning
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ── Pass 3: sort (depth, position, label, key) ─────────────
  -- try_numeric, not ::numeric: a stray non-numeric position must sort
  -- as 0, not abort the most-called function in the system. COLLATE "C"
  -- orders by code point, matching the TypeScript mirror exactly, and the
  -- key breaks any remaining tie so the order is total.
  SELECT COALESCE(
           jsonb_agg(e ORDER BY (e->>'depth')::int DESC,
                                COALESCE(public.try_numeric(e->>'position'), 0) ASC,
                                COALESCE(e->>'label', '') COLLATE "C" ASC,
                                (e->>'key') COLLATE "C" ASC),
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

    -- A range may carry only an upper bound (value2); every other operator
    -- needs `value`. Range used to fall into this CONTINUE too, so "at most
    -- 15" with no minimum filtered nothing at all.
    ELSIF fop <> 'range' AND (fval IS NULL OR fval = '') THEN
      CONTINUE;

    ELSIF fop = 'contains' THEN
      -- LIKE metacharacters escaped, as search_items does: filtering for
      -- "50%" means that string, not "anything containing 50".
      where_sql := where_sql || format(
        ' AND i.data->>%L ILIKE %L ESCAPE %L',
        fkey,
        '%' || replace(replace(replace(fval, '\', '\\'), '%', '\%'), '_', '\_') || '%',
        '\'
      );

    ELSIF fop = 'eq' THEN
      where_sql := where_sql || format(' AND i.data->>%L = %L', fkey, fval);

    ELSIF fop = 'bool' THEN
      -- An unreadable filter value is ignored, like an unrecognised key; an
      -- unreadable stored value simply does not match. The bare ::boolean
      -- this replaces aborted the whole Items tab on one "maybe".
      CONTINUE WHEN public.try_boolean(fval) IS NULL;
      where_sql := where_sql || format(
        ' AND public.try_boolean(i.data->>%L) = %L::boolean',
        fkey, public.try_boolean(fval)::text
      );

    ELSIF fop = 'in' THEN
      -- `value` is a comma-separated list of allowed values.
      where_sql := where_sql || format(
        ' AND i.data->>%L = ANY (string_to_array(%L, %L))', fkey, fval, ','
      );

    ELSIF fop = 'range' THEN
      -- try_numeric on both sides. It used to be a regex check followed by
      -- a ::numeric cast in the same AND chain — not a guard at all, since
      -- Postgres may evaluate the cast first. A bound that is not a number
      -- is ignored; a range with no usable bound is ignored entirely.
      CONTINUE WHEN public.try_numeric(fval) IS NULL AND public.try_numeric(fval2) IS NULL;
      IF public.try_numeric(fval) IS NOT NULL THEN
        where_sql := where_sql || format(
          ' AND public.try_numeric(i.data->>%L) >= %L::numeric',
          fkey, public.try_numeric(fval)::text
        );
      END IF;
      IF public.try_numeric(fval2) IS NOT NULL THEN
        where_sql := where_sql || format(
          ' AND public.try_numeric(i.data->>%L) <= %L::numeric',
          fkey, public.try_numeric(fval2)::text
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
  -- Every order ends in i.id. Paging with LIMIT/OFFSET is only correct
  -- over a TOTAL order, and ties are common: an import or a seed writes
  -- all its rows in one statement, so they share one created_at. Among
  -- ties Postgres promises no order, so without the tiebreaker a page
  -- may repeat a row from the last one and skip another. The default
  -- order matches idx_items_category_created exactly.
  IF p_sort_key IS NULL OR p_sort_key = '' THEN
    order_sql := 'i.created_at DESC, i.id';
  ELSIF p_sort_key = 'created_at' OR p_sort_key = 'updated_at' THEN
    order_sql := format('i.%I %s, i.id', p_sort_key, dir);
  ELSIF p_sort_key !~ key_re THEN
    order_sql := 'i.created_at DESC, i.id';
  ELSE
    -- The typed read is what makes 8 sort before 16, and 2024-02 before
    -- 2024-10. The try_* helpers turn a stray unreadable value into a
    -- NULL, which sorts last, instead of aborting the whole query. (The
    -- date sort used to admit "2024-02-30" through its regex and then
    -- fail on the cast.)
    cast_expr := CASE p_sort_type
      WHEN 'number'  THEN format('public.try_numeric(i.data->>%L)', p_sort_key)
      WHEN 'date'    THEN format('public.try_date(i.data->>%L)', p_sort_key)
      WHEN 'boolean' THEN format('public.try_boolean(i.data->>%L)', p_sort_key)
      ELSE format('lower(i.data->>%L)', p_sort_key)
    END;
    order_sql := format('%s %s NULLS LAST, i.created_at DESC, i.id', cast_expr, dir);
  END IF;

  -- ── Count, then page ──────────────────────────────────────
  EXECUTE format(
    '%s SELECT count(*)::int FROM public.items i %s WHERE %s AND %s %s',
    health_cte, health_join, scope_sql, where_sql, health_where
  ) INTO total;

  EXECUTE format(
    '%s SELECT COALESCE(jsonb_agg(rw ORDER BY rw.ord), %L::jsonb) FROM ('
    || 'SELECT row_number() OVER (ORDER BY %s) AS ord, i.id, i.category_id, i.data, '
    || 'i.schema_version, i.created_at, i.updated_at, c.name AS category_name, '
    || 'public.member_email(i.created_by) AS created_by_email, '
    || 'public.member_email(i.updated_by) AS updated_by_email '
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


-- ============================================================
-- 12. set_item_field(p_items, p_key, p_value, p_force)  → JSONB
-- ------------------------------------------------------------
-- Set one field to one value across many items, in ONE statement.
--
-- Was a read followed by an UPDATE per row: 200 selected items meant
-- 201 round trips, and the reads were stale by the time the writes
-- landed, so a bulk edit silently overwrote whatever anyone else had
-- saved in between.
--
-- `p_items` carries the `updated_at` each row had when the user
-- selected it — the same optimistic token an item save sends. A row
-- that has moved on since is left alone and reported back, so the
-- caller can name what it skipped and offer to apply to those too
-- (p_force, which is the deliberate overwrite, never the default).
--
-- Each row is stamped with ITS OWN category's current schema version.
-- Selecting across a subtree means several categories, and stamping
-- them all with the one the page happens to be showing would record a
-- version those items were never written against.
--
-- A JSON `null` value clears the key rather than storing null — the
-- convention `data` already follows, where absent means empty.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_item_field(
  p_items JSONB,
  p_key   TEXT,
  p_value JSONB,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated    INT;
  v_conflicted UUID[];
BEGIN
  -- RLS would refuse the writes anyway, but silently: a VIEWER would
  -- hear "0 updated, 12 conflicted" and go looking for a colleague who
  -- never touched anything.
  PERFORM public.require_data_editor();

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'conflicted', '[]'::jsonb);
  END IF;

  -- The key is written as JSONB data and never as SQL, so this is not
  -- an injection guard — it keeps a key that no schema could define
  -- out of `data`, where it would read as orphaned forever.
  IF p_key !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Not a valid field key: %', p_key USING ERRCODE = 'PT400';
  END IF;

  WITH wanted AS (
    SELECT (e->>'id')::UUID          AS id,
           (e->>'updated_at')::TIMESTAMPTZ AS seen
    FROM jsonb_array_elements(p_items) e
  ),
  -- One lookup per category involved, not per item.
  versions AS (
    SELECT sv.category_id, MAX(sv.version) AS version
    FROM public.schema_versions sv
    WHERE sv.category_id IN (
      SELECT i.category_id FROM public.items i JOIN wanted w ON w.id = i.id
    )
    GROUP BY sv.category_id
  ),
  changed AS (
    UPDATE public.items i
       SET data = CASE
                    WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null'
                      THEN i.data - p_key
                    ELSE jsonb_set(i.data, ARRAY[p_key], p_value, true)
                  END,
           schema_version = COALESCE(
             (SELECT v.version FROM versions v WHERE v.category_id = i.category_id),
             i.schema_version
           )
      FROM wanted w
     WHERE i.id = w.id
       AND (p_force OR w.seen IS NULL OR i.updated_at = w.seen)
    RETURNING i.id
  )
  SELECT (SELECT count(*) FROM changed)::INT,
         COALESCE(
           (SELECT array_agg(w.id) FROM wanted w
             WHERE w.id NOT IN (SELECT c.id FROM changed c)),
           ARRAY[]::UUID[]
         )
    INTO v_updated, v_conflicted;

  RETURN jsonb_build_object(
    'updated',    v_updated,
    'conflicted', to_jsonb(v_conflicted)
  );
END;
$$;


-- ============================================================
-- 13. get_stale_items(p_category_id)  → JSONB
-- ------------------------------------------------------------
-- How far a category's item data has drifted behind its schema.
--
-- `items.schema_version` is only bumped on items a migration actually
-- TOUCHED, which is what makes this meaningful: an item still on v3
-- was written against v3 and no remediation has needed to visit it
-- since.
--
-- Counted here rather than in the application, which read every item's
-- version into memory to count them — unbounded in the one place a
-- large category is most likely.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_stale_items(p_category_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH current AS (
    SELECT COALESCE(MAX(sv.version), 0) AS version
    FROM public.schema_versions sv
    WHERE sv.category_id = p_category_id
  )
  SELECT jsonb_build_object(
    'current_version', c.version,
    'stale_count',     count(i.id)::int,
    'oldest_version',  min(i.schema_version)
  )
  FROM current c
  LEFT JOIN public.items i
    ON i.category_id = p_category_id
   AND i.schema_version < c.version
  GROUP BY c.version;
$$;

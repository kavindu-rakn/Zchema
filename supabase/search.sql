-- ============================================================
-- SchemaShift — Cross-category item search (Phase 6, Increment 3)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql
--                        → attributes.sql.
--
-- The attribute registry asserted that `brand` on Electronics and
-- `brand` on Clothing are the same thing. This is what that assertion
-- buys: one query that spans the whole catalog.
-- ============================================================


-- ============================================================
-- 1. items.search_vector — generated, stored, indexed
-- ------------------------------------------------------------
-- TWO NON-OBVIOUS CHOICES, both load-bearing:
--
-- (a) 'english'::regconfig, explicitly.
--     A generated column requires an IMMUTABLE expression.
--     jsonb_to_tsvector(jsonb, jsonb) — the two-argument form — reads
--     default_text_search_config and is only STABLE, so it is rejected
--     outright. Only the form taking an explicit regconfig is
--     IMMUTABLE. This is not stylistic; the ALTER fails without it.
--
-- (b) `data - '__orphaned'`, not `data`.
--     jsonb_to_tsvector recurses into nested objects, so orphaned
--     values would otherwise be searchable — and finding an item by a
--     value whose field was deleted months ago, with nothing in the
--     result to explain the match, is a bug that looks like magic.
--     Search reflects the LIVE schema. Orphaned values have their own
--     dedicated filter on the Items tab. `jsonb - text` is immutable,
--     so this costs nothing.
--
-- The filter array '["string","numeric"]' selects which jsonb value
-- types are indexed. VERIFY IT rather than trusting this comment —
-- supabase/tests/search_test.sql assertion 1 prints the actual vector
-- for a known row.
-- ============================================================
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    jsonb_to_tsvector(
      'english'::regconfig,
      data - '__orphaned',
      '["string","numeric"]'::jsonb
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_items_search
  ON public.items USING gin (search_vector);


-- ============================================================
-- 2. try_numeric(text) → NUMERIC or NULL
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
-- 3. get_category_path(category) → TEXT
-- ------------------------------------------------------------
-- "Electronics / Laptops / Gaming Laptops". A search result from an
-- unfamiliar corner of the tree is meaningless without it — the whole
-- point of cross-category search is that you did not know where the
-- item lived.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_path(p_category_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT string_agg(a.name, ' / ' ORDER BY a.depth DESC)
  FROM public.get_category_ancestors(p_category_id) a;
$$;


-- ============================================================
-- 4. search_items(query, filters, category, limit, offset)
-- ------------------------------------------------------------
-- Free text plus structured filters, across the whole catalog or one
-- subtree.
--
-- p_filters is a JSONB array of { key, op, value }:
--   eq | neq | gt | gte | lte | lt | contains | starts_with
--   | in | is_null | not_null
--
-- SAFETY: every filter key is validated against the field-key grammar
-- before it is interpolated, and every value goes through %L. A key
-- that does not match is ignored rather than run — a malformed filter
-- should narrow nothing, not execute something.
--
-- `total_count` rides along as a window function so pagination has a
-- total without a second round trip counting the same predicate twice.
-- ============================================================
-- Adding a parameter creates an OVERLOAD rather than replacing, and two
-- candidates make every PostgREST call ambiguous. Drop the old shape.
DROP FUNCTION IF EXISTS public.search_items(TEXT, JSONB, UUID, INT, INT);

CREATE OR REPLACE FUNCTION public.search_items(
  p_query       TEXT  DEFAULT NULL,
  p_filters     JSONB DEFAULT '[]'::jsonb,
  p_category_id UUID  DEFAULT NULL,
  p_limit       INT   DEFAULT 50,
  p_offset      INT   DEFAULT 0,
  -- FALSE restricts to the category itself rather than its descendants.
  -- The Items tab needs this: it can show one category's own rows, and
  -- an export that quietly included the whole subtree would hand back
  -- more than the screen showed.
  p_include_subtree BOOLEAN DEFAULT true
)
RETURNS TABLE (
  id            UUID,
  category_id   UUID,
  category_name TEXT,
  category_path TEXT,
  data          JSONB,
  rank          REAL,
  total_count   BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  key_re    CONSTANT TEXT := '^[a-z][a-z0-9_]*$';
  where_sql TEXT := 'TRUE';
  rank_sql  TEXT := '0::real';
  order_sql TEXT := 'i.updated_at DESC';
  needle    TEXT := btrim(COALESCE(p_query, ''));
  flt       JSONB;
  fkey      TEXT;
  fop       TEXT;
  fval      TEXT;
  esc       TEXT;
BEGIN
  -- ── Free text ─────────────────────────────────────────────
  -- websearch_to_tsquery is the forgiving parser: it accepts quoted
  -- phrases, OR, and a leading -, and it never throws on junk input.
  -- to_tsquery would raise a syntax error on a stray colon, which in a
  -- search box means the user typing normally gets an error page.
  IF needle <> '' THEN
    where_sql := where_sql || format(
      ' AND i.search_vector @@ websearch_to_tsquery(%L::regconfig, %L)', 'english', needle
    );
    rank_sql := format(
      'ts_rank_cd(i.search_vector, websearch_to_tsquery(%L::regconfig, %L))::real',
      'english', needle
    );
    order_sql := 'rank DESC, i.updated_at DESC';
  END IF;

  -- ── Scope ─────────────────────────────────────────────────
  IF p_category_id IS NOT NULL THEN
    IF p_include_subtree THEN
      where_sql := where_sql || format(
        ' AND i.category_id IN (SELECT s.id FROM public.get_category_subtree(%L::uuid) s)',
        p_category_id
      );
    ELSE
      where_sql := where_sql || format(' AND i.category_id = %L::uuid', p_category_id);
    END IF;
  END IF;

  -- ── Structured filters, ANDed ─────────────────────────────
  FOR flt IN SELECT value FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
  LOOP
    fkey := flt->>'key';
    fop  := COALESCE(flt->>'op', 'eq');
    fval := flt->>'value';

    CONTINUE WHEN fkey IS NULL OR fkey !~ key_re;

    IF fop = 'is_null' THEN
      where_sql := where_sql || format(
        ' AND (NOT (i.data ? %L) OR i.data->>%L IS NULL OR btrim(i.data->>%L) = %L)',
        fkey, fkey, fkey, ''
      );
      CONTINUE;
    END IF;

    IF fop = 'not_null' THEN
      where_sql := where_sql || format(
        ' AND (i.data ? %L AND i.data->>%L IS NOT NULL AND btrim(i.data->>%L) <> %L)',
        fkey, fkey, fkey, ''
      );
      CONTINUE;
    END IF;

    CONTINUE WHEN fval IS NULL OR fval = '';

    CASE fop
      WHEN 'eq' THEN
        where_sql := where_sql || format(' AND i.data->>%L = %L', fkey, fval);

      WHEN 'neq' THEN
        -- IS DISTINCT FROM so an item MISSING the key counts as "not
        -- that value", which is what anyone typing -brand:Sony means.
        where_sql := where_sql || format(
          ' AND i.data->>%L IS DISTINCT FROM %L', fkey, fval
        );

      WHEN 'gt', 'gte', 'lt', 'lte' THEN
        -- try_numeric yields NULL for anything unparseable, and NULL
        -- fails the comparison rather than aborting the statement.
        where_sql := where_sql || format(
          ' AND public.try_numeric(i.data->>%L) %s %L::numeric',
          fkey,
          CASE fop WHEN 'gt' THEN '>' WHEN 'gte' THEN '>='
                   WHEN 'lt' THEN '<' ELSE '<=' END,
          fval
        );

      WHEN 'contains', 'starts_with' THEN
        -- Escape LIKE metacharacters: a user searching for "50%" means
        -- the string, not "anything starting 50".
        esc := replace(replace(replace(fval, '\', '\\'), '%', '\%'), '_', '\_');
        where_sql := where_sql || format(
          ' AND i.data->>%L ILIKE %L ESCAPE %L',
          fkey,
          CASE WHEN fop = 'contains' THEN '%' || esc || '%' ELSE esc || '%' END,
          '\'
        );

      WHEN 'in' THEN
        where_sql := where_sql || format(
          ' AND i.data->>%L = ANY (string_to_array(%L, %L))', fkey, fval, ','
        );

      ELSE
        -- Unknown operator: ignore it rather than guess.
        NULL;
    END CASE;
  END LOOP;

  RETURN QUERY EXECUTE format(
    'SELECT i.id, i.category_id, c.name, public.get_category_path(i.category_id), '
    || 'i.data, %s AS rank, count(*) OVER () AS total_count '
    || 'FROM public.items i '
    || 'JOIN public.categories c ON c.id = i.category_id '
    || 'WHERE %s ORDER BY %s LIMIT %s OFFSET %s',
    rank_sql, where_sql, order_sql,
    GREATEST(COALESCE(p_limit, 50), 1),
    GREATEST(COALESCE(p_offset, 0), 0)
  );
END;
$$;


-- ============================================================
-- 5. get_searchable_fields(category)  → JSONB[]
-- ------------------------------------------------------------
-- Every field key in scope, its type, and how many categories define
-- it. Drives the query bar's autocomplete: suggesting `brand` and
-- noting that 3 categories define it tells the user their filter will
-- span the catalog, which is the feature.
--
-- `attribute_id` rides along so the UI can mark the keys that are
-- genuinely one shared concept rather than a spelling coincidence.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_searchable_fields(
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT c.id
    FROM public.categories c
    WHERE p_category_id IS NULL
       OR c.id IN (SELECT s.id FROM public.get_category_subtree(p_category_id) s)
  ),
  fields AS (
    SELECT e->>'key'                 AS key,
           e->>'label'               AS label,
           e->>'type'                AS type,
           e->>'attribute_id'        AS attribute_id,
           e->'options'              AS options,
           s.id                      AS category_id
    FROM scope s
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(s.id)) e
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.category_count DESC, x.key), '[]'::jsonb)
  FROM (
    SELECT f.key,
           min(f.label)                              AS label,
           mode() WITHIN GROUP (ORDER BY f.type)     AS type,
           count(DISTINCT f.category_id)::int        AS category_count,
           bool_or(f.attribute_id IS NOT NULL)       AS is_shared_attribute,
           -- The union of every option any category offers for this
           -- key, so value autocomplete works across the catalog.
           COALESCE(
             (SELECT jsonb_agg(DISTINCT o)
              FROM fields f2
              CROSS JOIN LATERAL jsonb_array_elements_text(
                     COALESCE(f2.options, '[]'::jsonb)) AS t(o)
              WHERE f2.key = f.key),
             '[]'::jsonb)                            AS options
    FROM fields f
    GROUP BY f.key
  ) x;
$$;


-- ============================================================
-- 6. search_facets(query, filters, category)  → JSONB
-- ------------------------------------------------------------
-- Added in Increment 4, when the search page needed it: facet counts
-- must be computed over the WHOLE match set, not the 50 rows one page
-- happens to show. Counting client-side from the current page would
-- produce numbers that change as you paginate, which is worse than no
-- numbers at all.
--
-- Returns { categories: [...], values: [{ key, label, values: [...] }] }.
--
-- Value facets are offered only for low-cardinality keys (<= 25
-- distinct values in the match set). A facet list with 400 entries is
-- not a filter, it is a second search problem.
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_facets(
  p_query       TEXT  DEFAULT NULL,
  p_filters     JSONB DEFAULT '[]'::jsonb,
  p_category_id UUID  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  matched     JSONB;
  categories  JSONB;
  values_out  JSONB;
BEGIN
  -- Reuse search_items so the facets can never disagree with the
  -- results. A second copy of the predicate is a second thing to keep
  -- in sync, and it would be wrong the first time either changed.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category_id', s.category_id,
           'data',        s.data)), '[]'::jsonb)
    INTO matched
  FROM public.search_items(p_query, p_filters, p_category_id, 100000, 0) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.count DESC, x.name), '[]'::jsonb)
    INTO categories
  FROM (
    SELECT (m->>'category_id')::uuid          AS id,
           c.name                             AS name,
           -- The real slug, not one re-derived from the name: a
           -- de-duplicated slug ("laptops-2") would never round-trip
           -- through `in:` if the facet guessed at it.
           c.slug                             AS slug,
           public.get_category_path((m->>'category_id')::uuid) AS path,
           count(*)::int                      AS count
    FROM jsonb_array_elements(matched) m
    JOIN public.categories c ON c.id = (m->>'category_id')::uuid
    GROUP BY 1, 2, 3, 4
  ) x;

  SELECT COALESCE(jsonb_agg(y ORDER BY y.total DESC, y.key), '[]'::jsonb)
    INTO values_out
  FROM (
    SELECT kv.key,
           count(*)::int AS total,
           jsonb_agg(jsonb_build_object('value', kv.value, 'count', kv.n)
                     ORDER BY kv.n DESC, kv.value) AS values
    FROM (
      SELECT e.key, e.value, count(*)::int AS n
      FROM jsonb_array_elements(matched) m
      CROSS JOIN LATERAL jsonb_each_text(m->'data') e
      WHERE e.key <> '__orphaned'
        AND btrim(e.value) <> ''
      GROUP BY e.key, e.value
    ) kv
    GROUP BY kv.key
    -- Low-cardinality only: a 400-entry facet is a second search
    -- problem, not a filter.
    HAVING count(*) BETWEEN 1 AND 25
  ) y;

  RETURN jsonb_build_object(
    'total',      jsonb_array_length(matched),
    'categories', categories,
    'values',     values_out
  );
END;
$$;

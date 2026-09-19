-- ============================================================
-- Stable paging for the Items tab and search, and an index for its
-- default page
-- ------------------------------------------------------------
-- * query_items() and search_items() end every ORDER BY in i.id. Paging
--   with LIMIT/OFFSET is only correct over a total order, and ties are
--   the norm: a seed or an import writes all its rows in one statement,
--   so they share one created_at (all 265 seeded items do). Among ties
--   Postgres promises no order, so a page could repeat a row and skip
--   another — and the export pages through search_items().
-- * idx_items_category_created (category_id, created_at DESC, id)
--   replaces idx_items_category. It serves the default Items page
--   directly, without sorting the category: 29 ms → 6 ms per page on a
--   20,000-item category, in a rolled-back probe on this database. Every
--   lookup by category_id alone uses its leading column.
-- * query_items() "contains" escapes LIKE metacharacters, as
--   search_items() already did: "50%" means that string.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_items_category_created
  ON public.items (category_id, created_at DESC, id);
DROP INDEX IF EXISTS public.idx_items_category;

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
  -- i.id last: a total order, or LIMIT/OFFSET paging (the export pages
  -- through this up to 200 times) can repeat and skip rows among ties.
  order_sql TEXT := 'i.updated_at DESC, i.id';
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
    order_sql := 'rank DESC, i.updated_at DESC, i.id';
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


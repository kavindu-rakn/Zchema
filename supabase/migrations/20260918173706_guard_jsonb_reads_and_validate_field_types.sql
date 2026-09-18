-- ============================================================
-- Guard every read of JSONB item data, and validate field types on write
-- ------------------------------------------------------------
-- * try_boolean() and try_date() join try_numeric(): an unreadable value
--   becomes NULL instead of aborting the statement.
-- * query_items(): the boolean filter cast raw (one "maybe" aborted the
--   Items tab); the range filter's regex was not a guard, since Postgres
--   may evaluate the cast first; the date sort let "2024-02-30" through
--   to a failing ::date. All three now go through the try_* helpers.
-- * query_items(): a range with only an upper bound was silently
--   ignored — "at most 15" returned every item. It now filters.
-- * validate_category_fields(): `required` must be a boolean and
--   `position` an integer in own_fields AND in override patches, and a
--   patch's `options` must be an array — so the many ::boolean reads of
--   `required` can never meet anything else. Existing rows were checked
--   and already comply.
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
      where_sql := where_sql || format(
        ' AND i.data->>%L ILIKE %L', fkey, '%' || fval || '%'
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
  IF p_sort_key IS NULL OR p_sort_key = '' THEN
    order_sql := 'i.created_at DESC';
  ELSIF p_sort_key = 'created_at' OR p_sort_key = 'updated_at' THEN
    order_sql := format('i.%I %s', p_sort_key, dir);
  ELSIF p_sort_key !~ key_re THEN
    order_sql := 'i.created_at DESC';
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

CREATE OR REPLACE FUNCTION public.validate_category_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  fld           JSONB;
  k             TEXT;
  t             TEXT;
  dup           TEXT;
  anc_keys      TEXT[];
  desc_keys     TEXT[];
  o_key         TEXT;
  o_patch       JSONB;
  allowed_types TEXT[] := ARRAY['string','text','number','boolean','date','select','multiselect','url'];
BEGIN
  -- ── A. shape of every own_field ───────────────────────────
  IF jsonb_typeof(COALESCE(NEW.own_fields, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'own_fields must be a JSON array';
  END IF;

  FOR fld IN SELECT value FROM jsonb_array_elements(NEW.own_fields) LOOP
    k := fld->>'key';
    t := fld->>'type';

    IF k IS NULL OR k !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid field key "%": use snake_case matching ^[a-z][a-z0-9_]*$', COALESCE(k, '(missing)');
    END IF;

    IF t IS NULL OR NOT (t = ANY(allowed_types)) THEN
      RAISE EXCEPTION 'Field "%" has invalid type "%": must be one of string, text, number, boolean, date, select, multiselect, url',
        k, COALESCE(t, '(missing)');
    END IF;

    IF t IN ('select', 'multiselect') THEN
      IF jsonb_typeof(fld->'options') <> 'array'
         OR jsonb_array_length(COALESCE(fld->'options', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Field "%" of type % requires a non-empty "options" array', k, t;
      END IF;
    END IF;

    -- position is optional at the storage layer (the resolver defaults it
    -- to 0); when present it must be an integer. try_numeric, because an
    -- OR does not promise to test the type first — a bare ::numeric here
    -- could raise a cast error instead of this message.
    IF fld ? 'position'
       AND (jsonb_typeof(fld->'position') <> 'number'
            OR public.try_numeric(fld->>'position')
               <> floor(public.try_numeric(fld->>'position'))) THEN
      RAISE EXCEPTION 'Field "%" position must be an integer', k;
    END IF;

    -- required is read with ::boolean all over the read path — the
    -- dashboard's missing-required count, the Items tab's health filter,
    -- impact analysis. Guaranteeing its type here, once, is what keeps
    -- every one of those reads safe.
    IF fld ? 'required' AND jsonb_typeof(fld->'required') <> 'boolean' THEN
      RAISE EXCEPTION 'Field "%" required must be true or false', k;
    END IF;
  END LOOP;

  -- ── B. duplicate key within own_fields ────────────────────
  SELECT f->>'key' INTO dup
  FROM jsonb_array_elements(NEW.own_fields) f
  GROUP BY f->>'key' HAVING count(*) > 1
  LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate field key "%" within this category', dup;
  END IF;

  -- ── collect ancestor keys (strict ancestors: walk from parent)
  SELECT array_agg(DISTINCT af.elem->>'key') INTO anc_keys
  FROM public.get_category_ancestors(NEW.parent_id) a
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.own_fields, '[]'::jsonb)) AS af(elem);

  -- ── collect descendant keys (strict descendants of NEW.id) ─
  SELECT array_agg(DISTINCT df.elem->>'key') INTO desc_keys
  FROM public.get_category_subtree(NEW.id) sub
  JOIN public.categories c ON c.id = sub.id AND c.id <> NEW.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.own_fields, '[]'::jsonb)) AS df(elem);

  -- ── C + D. own keys must not collide up or down the chain ──
  FOR fld IN SELECT value FROM jsonb_array_elements(NEW.own_fields) LOOP
    k := fld->>'key';
    IF anc_keys IS NOT NULL AND k = ANY(anc_keys) THEN
      RAISE EXCEPTION 'Field key "%" is already defined by an ancestor category; inherited fields cannot be redefined — use an override instead', k;
    END IF;
    IF desc_keys IS NOT NULL AND k = ANY(desc_keys) THEN
      RAISE EXCEPTION 'Field key "%" is already defined by a descendant category', k;
    END IF;
  END LOOP;

  -- ── C2. ancestor keys and descendant keys must stay disjoint ──
  -- Catches a re-parent (or any change) that would make an EXISTING
  -- descendant redefine a field it now inherits from the new chain —
  -- the descendant's own trigger does not fire on a move of this node.
  IF anc_keys IS NOT NULL AND desc_keys IS NOT NULL AND (anc_keys && desc_keys) THEN
    RAISE EXCEPTION 'This change would make a descendant category redefine an inherited field (key %)',
      (SELECT string_agg(x, ', ') FROM unnest(anc_keys) x WHERE x = ANY(desc_keys));
  END IF;

  -- ── E. override guard ─────────────────────────────────────
  IF jsonb_typeof(COALESCE(NEW.overrides, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'overrides must be a JSON object';
  END IF;

  FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(NEW.overrides) LOOP
    IF jsonb_typeof(o_patch) <> 'object' THEN
      RAISE EXCEPTION 'Override for "%" must be a JSON object', o_key;
    END IF;
    IF anc_keys IS NULL OR NOT (o_key = ANY(anc_keys)) THEN
      RAISE EXCEPTION 'Override targets "%", which is not an inherited field of this category', o_key;
    END IF;
    IF o_patch ? 'type' OR o_patch ? 'key' THEN
      RAISE EXCEPTION 'Override for "%" may not change "type" or "key"', o_key;
    END IF;
    -- An override lands in the effective schema, so it must meet the same
    -- type rules as the field it patches (§A) — the reads cannot tell the
    -- two apart.
    IF o_patch ? 'required' AND jsonb_typeof(o_patch->'required') <> 'boolean' THEN
      RAISE EXCEPTION 'Override for "%": required must be true or false', o_key;
    END IF;
    IF o_patch ? 'position'
       AND (jsonb_typeof(o_patch->'position') <> 'number'
            OR public.try_numeric(o_patch->>'position')
               <> floor(public.try_numeric(o_patch->>'position'))) THEN
      RAISE EXCEPTION 'Override for "%": position must be an integer', o_key;
    END IF;
    IF o_patch ? 'options' AND jsonb_typeof(o_patch->'options') <> 'array' THEN
      RAISE EXCEPTION 'Override for "%": options must be an array', o_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

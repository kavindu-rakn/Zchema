-- ============================================================
-- SchemaShift — Query timings (Phase 7, Increment 5)
--
-- Run AFTER seedStress.sql. Times the five hottest queries and returns
-- one row each with the real duration and the plan, so the numbers can
-- be pasted rather than described.
--
-- The plan's bar is 300ms. Anything above it needs an index or a
-- rewrite — and the plan text is included so the decision is made from
-- evidence rather than a guess about what "should" be slow.
--
-- ⚠️  These are TIMINGS, not assertions. A slow machine is not a bug.
-- Compare the shape of the plan (Seq Scan vs Index Scan, and the
-- rows-vs-actual estimate) before reaching for an index.
-- ============================================================

DROP TABLE IF EXISTS _perf;
CREATE TEMP TABLE _perf (
  n         int PRIMARY KEY,
  query     text,
  ms        numeric,
  verdict   text,
  plan      text
);

DO $$
DECLARE
  started   TIMESTAMPTZ;
  elapsed   NUMERIC;
  plan_text TEXT;
  target    UUID;
  deepest   UUID;
  sink      JSONB;
  n_rows    BIGINT;

  bar CONSTANT NUMERIC := 300;
BEGIN
  -- A mid-tree category, and the deepest one — the worst case for any
  -- recursive walk.
  SELECT id INTO target FROM public.categories WHERE parent_id IS NULL LIMIT 1;

  SELECT c.id INTO deepest
  FROM public.categories c
  ORDER BY (SELECT max(a.depth) FROM public.get_category_ancestors(c.id) a) DESC
  LIMIT 1;

  -- ── 1. Tree fetch ─────────────────────────────────────────
  started := clock_timestamp();
  sink := public.get_category_tree();
  elapsed := EXTRACT(EPOCH FROM clock_timestamp() - started) * 1000;
  INSERT INTO _perf VALUES (1, 'get_category_tree()', round(elapsed, 1),
    CASE WHEN elapsed <= bar THEN 'OK' ELSE 'SLOW' END,
    format('%s nodes returned', jsonb_array_length(sink)));

  -- ── 2. Effective schema, at the DEEPEST node ──────────────
  started := clock_timestamp();
  sink := public.get_effective_schema(deepest);
  elapsed := EXTRACT(EPOCH FROM clock_timestamp() - started) * 1000;
  INSERT INTO _perf VALUES (2, 'get_effective_schema() at max depth', round(elapsed, 1),
    CASE WHEN elapsed <= bar THEN 'OK' ELSE 'SLOW' END,
    format('%s fields resolved', jsonb_array_length(sink)));

  -- ── 3. Item list, subtree-scoped, sorted ──────────────────
  started := clock_timestamp();
  sink := public.query_items(target, true, 'sa_price', 'number', 'desc', '[]'::jsonb, 50, 0, NULL);
  elapsed := EXTRACT(EPOCH FROM clock_timestamp() - started) * 1000;
  INSERT INTO _perf VALUES (3, 'query_items() subtree + numeric sort', round(elapsed, 1),
    CASE WHEN elapsed <= bar THEN 'OK' ELSE 'SLOW' END,
    format('%s matched', sink->>'total'));

  -- ── 4. Search: free text + a numeric filter ───────────────
  started := clock_timestamp();
  SELECT count(*) INTO n_rows
  FROM public.search_items('Acme',
    '[{"key":"sa_price","op":"gt","value":"500"}]'::jsonb, NULL, 50, 0);
  elapsed := EXTRACT(EPOCH FROM clock_timestamp() - started) * 1000;

  EXECUTE
    'EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT id FROM public.items '
    || 'WHERE search_vector @@ websearch_to_tsquery(''english''::regconfig, ''Acme'')'
    INTO plan_text;

  INSERT INTO _perf VALUES (4, 'search_items() text + numeric filter', round(elapsed, 1),
    CASE WHEN elapsed <= bar THEN 'OK' ELSE 'SLOW' END,
    format('%s rows · underlying FTS plan: %s', n_rows, plan_text));

  -- ── 5. Impact analysis — the heaviest read in the app ─────
  started := clock_timestamp();
  sink := public.analyze_schema_change(
    target,
    (SELECT own_fields FROM public.categories WHERE id = target)
      || '[{"key":"perf_probe","label":"Probe","type":"string","required":true,"position":9}]'::jsonb,
    '{}'::jsonb);
  elapsed := EXTRACT(EPOCH FROM clock_timestamp() - started) * 1000;
  INSERT INTO _perf VALUES (5, 'analyze_schema_change() add required field', round(elapsed, 1),
    CASE WHEN elapsed <= bar THEN 'OK' ELSE 'SLOW' END,
    format('%s categories · %s items in the blast radius',
      jsonb_array_length(sink->'affected_categories'), sink->>'total_affected_items'));

  -- ── 6. The index question, asked properly ─────────────────
  -- items are filtered by category constantly; confirm the plan uses
  -- idx_items_category rather than assuming it does.
  EXECUTE
    'EXPLAIN (ANALYZE, FORMAT TEXT) SELECT count(*) FROM public.items i '
    || 'WHERE i.category_id IN (SELECT s.id FROM public.get_category_subtree('
    || quote_literal(target) || '::uuid) s)'
    INTO plan_text;
  INSERT INTO _perf VALUES (6, 'subtree item scan — plan check', NULL, 'INFO', plan_text);
END $$;

SELECT n,
       query,
       COALESCE(ms::text || ' ms', '—') AS duration,
       verdict,
       plan
FROM _perf
ORDER BY n;

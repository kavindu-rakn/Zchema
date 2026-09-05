-- ============================================================
-- Zchema — cross-category search (Phase 6, Increment 3)
--
-- Run AFTER search.sql is applied.
--
-- Assertion 1 exists because the plan said not to trust
-- jsonb_to_tsvector's filter-array argument without looking: it PRINTS
-- the generated vector for a known row and checks that both a string
-- and a numeric value actually made it in. If the filter array behaves
-- differently on this Postgres version, this is where you find out.
--
-- Assertion 6 is the one that matters most: a numeric comparison must
-- not blow up on a row holding "call for pricing" in the same key.
-- That is the failure the whole try_numeric() helper exists to prevent,
-- and across a catalog-wide search it is not an edge case.
--
-- SEED INDEPENDENCE: search is the one feature whose scope is the WHOLE
-- catalog, so a sandbox does not isolate it the way it does elsewhere.
-- Two consequences, both deliberate:
--   * free-text assertions use a token ("Zorvix") no real catalog
--     contains, rather than a plausible brand the seed might also hold;
--   * assertions about keys most items lack (neq, is_null) AND in a
--     sandbox-only key, because otherwise they correctly match the
--     entire catalog and the assertion measures the seed, not the code.
--
-- Expected: 16 rows, all PASS — on any seed, or none.
-- ============================================================

DROP TABLE IF EXISTS _search_results;
CREATE TEMP TABLE _search_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DO $$
DECLARE
  ca UUID := 'ee000000-0000-0000-0000-00000000a001';
  cb UUID := 'ee000000-0000-0000-0000-00000000a002';
  i1 UUID := 'ee000000-0000-0000-0000-00000000b001';

  vec       TEXT;
  plan_text TEXT;
  n         INT;
  cats      INT;
  total     BIGINT;
  ok        BOOLEAN;
  msg       TEXT;
  fields    JSONB;
BEGIN
  -- ── Sandbox ───────────────────────────────────────────────
  DELETE FROM public.categories
   WHERE id IN (ca, cb) OR (parent_id IS NULL AND slug LIKE 'zz-search-%');

  -- zs_price is a NUMBER on A and a STRING on B. That is the whole
  -- point: catalog-wide search meets both, in one query.
  INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
  (ca, 'ZZ Search A', 'zz-search-a', NULL, '[
     {"key":"zs_brand","label":"Brand","type":"string","required":false,"position":0},
     {"key":"zs_price","label":"Price","type":"number","required":false,"position":1},
     {"key":"zs_tag","label":"Tag","type":"select","required":false,"position":2,
      "options":["new","used"]}
   ]'::jsonb),
  (cb, 'ZZ Search B', 'zz-search-b', NULL, '[
     {"key":"zs_brand","label":"Brand","type":"string","required":false,"position":0},
     {"key":"zs_price","label":"Price","type":"string","required":false,"position":1}
   ]'::jsonb);

  INSERT INTO public.items (id, category_id, data) VALUES
  (i1, ca, '{"zs_brand":"Zorvix","zs_price":500,"zs_tag":"new"}'::jsonb),
  ('ee000000-0000-0000-0000-00000000b002', ca,
       '{"zs_brand":"Zorvix","zs_price":1500,"zs_tag":"used"}'::jsonb),
  ('ee000000-0000-0000-0000-00000000b003', ca,
       '{"zs_brand":"Anker","zs_price":80,"zs_tag":"new"}'::jsonb),
  -- The landmine: a non-numeric value under a key compared numerically.
  ('ee000000-0000-0000-0000-00000000b004', cb,
       '{"zs_brand":"Zorvix","zs_price":"call for pricing"}'::jsonb),
  ('ee000000-0000-0000-0000-00000000b005', cb,
       '{"zs_brand":"Bose","zs_price":"250"}'::jsonb),
  -- A literal % , to prove LIKE metacharacters are escaped.
  ('ee000000-0000-0000-0000-00000000b006', cb,
       '{"zs_brand":"50% Off Co","zs_price":"10"}'::jsonb);

  -- ── 1. VERIFY the generated vector, do not assume ─────────
  SELECT i.search_vector::text INTO vec FROM public.items i WHERE i.id = i1;

  INSERT INTO _search_results VALUES (1,
    'search_vector indexes BOTH string and numeric values (filter array behaves as documented)',
    (SELECT search_vector @@ websearch_to_tsquery('english'::regconfig, 'Zorvix')
       FROM public.items WHERE id = i1)
    AND (SELECT search_vector @@ websearch_to_tsquery('english'::regconfig, '500')
           FROM public.items WHERE id = i1),
    format('actual vector = %s', vec));

  -- ── 2. Orphaned values are NOT searchable ─────────────────
  UPDATE public.items
     SET data = (data - 'zs_tag')
             || '{"__orphaned":{"zs_legacy":"Zebracorn"}}'::jsonb
   WHERE id = 'ee000000-0000-0000-0000-00000000b003';

  INSERT INTO _search_results VALUES (2,
    'A value under __orphaned is excluded from the index — search reflects the LIVE schema',
    NOT (SELECT search_vector @@ websearch_to_tsquery('english'::regconfig, 'Zebracorn')
           FROM public.items WHERE id = 'ee000000-0000-0000-0000-00000000b003'),
    (SELECT search_vector::text FROM public.items
      WHERE id = 'ee000000-0000-0000-0000-00000000b003'));

  -- ── 3. Free text spans categories ─────────────────────────
  SELECT count(*), count(DISTINCT s.category_id)
    INTO n, cats
  FROM public.search_items('Zorvix', '[]'::jsonb, NULL, 100, 0) s;

  INSERT INTO _search_results VALUES (3,
    'Free-text finds 3 items across 2 different categories',
    n = 3 AND cats = 2,
    format('items=%s categories=%s', n, cats));

  -- ── 4. Results carry the breadcrumb ───────────────────────
  INSERT INTO _search_results VALUES (4,
    'Every result carries its category path, so an unfamiliar hit is placeable',
    (SELECT bool_and(s.category_path IS NOT NULL AND s.category_path <> '')
       FROM public.search_items('Zorvix', '[]'::jsonb, NULL, 100, 0) s),
    (SELECT string_agg(DISTINCT s.category_path, ' | ')
       FROM public.search_items('Zorvix', '[]'::jsonb, NULL, 100, 0) s));

  -- ── 5. eq / neq ───────────────────────────────────────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL, '[{"key":"zs_brand","op":"eq","value":"Zorvix"}]'::jsonb,
                           NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (5,
    'eq: zs_brand = "Zorvix" returns 3',
    n = 3, format('rows=%s', n));

  -- ── 6. THE FOOTGUN: numeric comparison over mixed values ──
  BEGIN
    SELECT count(*) INTO n
    FROM public.search_items(NULL, '[{"key":"zs_price","op":"gt","value":"400"}]'::jsonb,
                             NULL, 100, 0) s;
    ok := true; msg := format('rows=%s', n);
  EXCEPTION WHEN others THEN
    ok := false; n := -1; msg := SQLERRM;
  END;

  INSERT INTO _search_results VALUES (6,
    'gt: comparing numerically does NOT error on the row holding "call for pricing"',
    ok AND n = 2,
    format('%s (expected 2: the 500 and the 1500; "250" is below, the text row is skipped)', msg));

  -- ── 7. Numeric ops parse numbers stored as strings ────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL, '[{"key":"zs_price","op":"lte","value":"250"}]'::jsonb,
                           NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (7,
    'lte: "250" and "10" stored as strings still compare as numbers, alongside the real 80',
    n = 3, format('rows=%s (expected 80, "250", "10")', n));

  -- ── 8. neq includes items missing the key ─────────────────
  -- The second filter is not decoration. `neq` on a key most of the
  -- catalog does not have matches most of the catalog — correctly, and
  -- that is the behaviour being asserted. ANDing a sandbox-only key
  -- confines the row set without weakening the claim.
  SELECT count(*) INTO n
  FROM public.search_items(NULL,
    '[{"key":"zs_tag","op":"neq","value":"new"},
      {"key":"zs_brand","op":"not_null"}]'::jsonb, NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (8,
    'neq: within the sandbox, items LACKING the key count as "not that value"',
    n = 5, format('rows=%s (expected: 1 used + 4 without the key)', n));

  -- ── 9. contains / starts_with ─────────────────────────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL, '[{"key":"zs_brand","op":"starts_with","value":"Zo"}]'::jsonb,
                           NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (9,
    'starts_with: "Zo" matches the 3 Zorvix rows',
    n = 3, format('rows=%s', n));

  -- ── 10. LIKE metacharacters are escaped ───────────────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL, '[{"key":"zs_brand","op":"contains","value":"%"}]'::jsonb,
                           NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (10,
    'contains "%" matches the ONE literal percent sign, not every row',
    n = 1, format('rows=%s (unescaped, this would return all 6)', n));

  -- ── 11. in ────────────────────────────────────────────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL, '[{"key":"zs_brand","op":"in","value":"Zorvix,Bose"}]'::jsonb,
                           NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (11,
    'in: "Zorvix,Bose" returns 4',
    n = 4, format('rows=%s', n));

  -- ── 12. is_null / not_null ────────────────────────────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL,
    '[{"key":"zs_tag","op":"is_null"},
      {"key":"zs_brand","op":"not_null"}]'::jsonb, NULL, 100, 0) s;
  INSERT INTO _search_results VALUES (12,
    'is_null: within the sandbox, 4 items have no zs_tag (3 in B, plus the one orphaned in A)',
    n = 4, format('rows=%s', n));

  -- ── 13. Scope to a subtree ────────────────────────────────
  SELECT count(*) INTO n
  FROM public.search_items(NULL, '[]'::jsonb, ca, 100, 0) s;
  INSERT INTO _search_results VALUES (13,
    'Scoping to a category returns only its subtree',
    n = 3, format('rows=%s', n));

  -- ── 14. total_count survives pagination ───────────────────
  SELECT count(*), max(s.total_count) INTO n, total
  FROM public.search_items('Zorvix', '[]'::jsonb, NULL, 2, 0) s;
  INSERT INTO _search_results VALUES (14,
    'LIMIT 2 returns 2 rows but still reports total_count = 3',
    n = 2 AND total = 3, format('rows=%s total_count=%s', n, total));

  -- ── 15. get_searchable_fields ─────────────────────────────
  fields := public.get_searchable_fields(NULL);
  INSERT INTO _search_results VALUES (15,
    'get_searchable_fields reports zs_brand as defined by 2 categories',
    (SELECT (f->>'category_count')::int = 2
       FROM jsonb_array_elements(fields) f WHERE f->>'key' = 'zs_brand'),
    (SELECT (f)::text FROM jsonb_array_elements(fields) f WHERE f->>'key' = 'zs_brand'));

  -- ── 16. The GIN index is USABLE ───────────────────────────
  -- With six rows the planner will choose a seq scan because it is
  -- genuinely cheaper, and that is correct. Disabling seqscan asks the
  -- honest question instead: CAN the index serve this predicate?
  SET LOCAL enable_seqscan = off;
  EXECUTE
    'EXPLAIN (FORMAT JSON) SELECT id FROM public.items '
    || 'WHERE search_vector @@ websearch_to_tsquery(''english''::regconfig, ''sony'')'
    INTO plan_text;

  INSERT INTO _search_results VALUES (16,
    'The full-text predicate can be served by idx_items_search (GIN)',
    plan_text ILIKE '%idx_items_search%',
    plan_text);

  -- ── Tear down ─────────────────────────────────────────────
  DELETE FROM public.categories WHERE id IN (ca, cb);
END $$;

-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _search_results
ORDER BY n;

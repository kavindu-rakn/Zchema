-- ============================================================
-- SchemaShift — apply_schema_change / rollback round-trip test
-- (Phase 5, Increment 2)
--
-- Run AFTER impact.sql is applied. Order does not matter relative to
-- the seeds: this test builds its OWN sandbox category tree, asserts
-- against it, and deletes it again. Seed data is never touched, so the
-- test is safe to re-run and its counts are exact rather than
-- "whatever the seed happens to hold today".
--
-- Covers Increment 2's must-haves:
--   * each remediation strategy lands the promised item data
--   * a destructive change with no remediation is REFUSED
--   * `discard` is refused without an explicit confirm
--   * a schema_versions row is written for the category AND every
--     descendant, with the authored state recorded
--   * items.schema_version is bumped on touched items only
--   * rollback restores the schema and writes a NEW FORWARD version
--   * an injected mid-transaction failure leaves ZERO partial state
--
-- Expected: 19 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _apply_results;
CREATE TEMP TABLE _apply_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);


-- ============================================================
-- Block 1 — build the sandbox, exercise every strategy
-- ============================================================
DO $$
DECLARE
  root  UUID := 'aa000000-0000-0000-0000-0000000000a1';
  child UUID := 'aa000000-0000-0000-0000-0000000000a2';
  r1    UUID := 'aa000000-0000-0000-0000-0000000000b1';
  r2    UUID := 'aa000000-0000-0000-0000-0000000000b2';
  r3    UUID := 'aa000000-0000-0000-0000-0000000000b3';
  c1    UUID := 'aa000000-0000-0000-0000-0000000000c1';
  c2    UUID := 'aa000000-0000-0000-0000-0000000000c2';

  root_own JSONB;
  res      JSONB;
  ok       BOOLEAN;
  msg      TEXT;
  d        JSONB;
BEGIN
  -- ── Sandbox ───────────────────────────────────────────────
  -- By id and by slug: a run that died half-way would otherwise leave
  -- a differently-identified row squatting the unique root slug.
  DELETE FROM public.categories
   WHERE id = root
      OR (parent_id IS NULL AND slug = 'zz-impact-root');

  INSERT INTO public.categories (id, name, slug, parent_id, own_fields, overrides) VALUES
  (root, 'ZZ Impact Root', 'zz-impact-root', NULL, '[
     {"key":"zz_brand","label":"Brand","type":"string","required":false,"position":0},
     {"key":"zz_size","label":"Size","type":"number","required":false,"position":1},
     {"key":"zz_color","label":"Colour","type":"select","required":false,"position":2,
      "options":["red","blue"]}
   ]'::jsonb, '{}'::jsonb),
  (child, 'ZZ Impact Child', 'zz-impact-child', root, '[
     {"key":"zz_note","label":"Note","type":"string","required":false,"position":0}
   ]'::jsonb, '{}'::jsonb);

  INSERT INTO public.items (id, category_id, data) VALUES
  (r1, root,  '{"zz_brand":"Acme","zz_size":10,"zz_color":"red"}'::jsonb),
  (r2, root,  '{"zz_brand":"Beta","zz_size":20,"zz_color":"blue"}'::jsonb),
  (r3, root,  '{"zz_brand":"Cee","zz_size":30,"zz_color":"red"}'::jsonb),
  (c1, child, '{"zz_brand":"Dee","zz_size":40,"zz_color":"blue","zz_note":"hello"}'::jsonb),
  (c2, child, '{"zz_brand":"Eff","zz_color":"red","zz_note":"world"}'::jsonb);

  SELECT own_fields INTO root_own FROM public.categories WHERE id = root;

  -- ── 1. Destructive change with NO remediation is refused ──
  BEGIN
    PERFORM public.apply_schema_change(
      root,
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(root_own) e WHERE e->>'key' <> 'zz_color'),
      '{}'::jsonb, '{}'::jsonb, NULL);
    ok := false; msg := '(no exception raised)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;
  INSERT INTO _apply_results VALUES (1,
    'Removing a field with NO remediation is REFUSED', ok, msg);

  -- ── 2. `discard` without an explicit confirm is refused ───
  BEGIN
    PERFORM public.apply_schema_change(
      root,
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(root_own) e WHERE e->>'key' <> 'zz_color'),
      '{}'::jsonb,
      '{"zz_color":{"strategy":"discard"}}'::jsonb, NULL);
    ok := false; msg := '(no exception raised)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;
  INSERT INTO _apply_results VALUES (2,
    'Strategy "discard" is REFUSED without "confirm": true', ok, msg);

  -- Nothing above may have landed.
  INSERT INTO _apply_results VALUES (3,
    'Both refusals left the schema untouched (still 3 own_fields, no versions)',
    (SELECT jsonb_array_length(own_fields) FROM public.categories WHERE id = root) = 3
      AND NOT EXISTS (SELECT 1 FROM public.schema_versions WHERE category_id = root),
    format('own_fields=%s versions=%s',
      (SELECT jsonb_array_length(own_fields) FROM public.categories WHERE id = root),
      (SELECT count(*) FROM public.schema_versions WHERE category_id = root)));

  -- ── STEP A (v1): add a REQUIRED field, strategy backfill ──
  res := public.apply_schema_change(
    root,
    root_own || '[{"key":"zz_req","label":"Required One","type":"string",
                   "required":true,"position":3}]'::jsonb,
    '{}'::jsonb,
    '{"zz_req":{"strategy":"backfill","value":"filled"}}'::jsonb,
    NULL);

  INSERT INTO _apply_results VALUES (4,
    'backfill: all 5 subtree items written, version 1, nothing incomplete',
    (res->>'version')::int = 1
      AND (res->>'items_updated')::int = 5
      AND (res->>'items_incomplete')::int = 0,
    format('version=%s updated=%s orphaned=%s incomplete=%s',
      res->>'version', res->>'items_updated',
      res->>'items_orphaned', res->>'items_incomplete'));

  INSERT INTO _apply_results VALUES (5,
    'backfill: the value actually landed in item data (root and child alike)',
    (SELECT data->>'zz_req' FROM public.items WHERE id = r1) = 'filled'
      AND (SELECT data->>'zz_req' FROM public.items WHERE id = c2) = 'filled',
    format('r1=%s c2=%s',
      (SELECT data->>'zz_req' FROM public.items WHERE id = r1),
      (SELECT data->>'zz_req' FROM public.items WHERE id = c2)));

  INSERT INTO _apply_results VALUES (6,
    'A schema_versions row was written for the category AND its descendant',
    (SELECT count(*) FROM public.schema_versions WHERE category_id = root AND version = 1) = 1
      AND (SELECT count(*) FROM public.schema_versions WHERE category_id = child AND version = 1) = 1,
    format('root=%s child=%s',
      (SELECT count(*) FROM public.schema_versions WHERE category_id = root),
      (SELECT count(*) FROM public.schema_versions WHERE category_id = child)));

  INSERT INTO _apply_results VALUES (7,
    'The version row records the AUTHORED state, not just the effective snapshot',
    (SELECT authored ? 'own_fields' AND authored ? 'overrides'
       FROM public.schema_versions WHERE category_id = root AND version = 1)
    AND (SELECT jsonb_array_length(authored->'own_fields')
           FROM public.schema_versions WHERE category_id = root AND version = 1) = 4,
    (SELECT jsonb_array_length(authored->'own_fields')::text
       FROM public.schema_versions WHERE category_id = root AND version = 1));

  -- ── STEP B (v2): retype number → string, strategy cast ────
  SELECT own_fields INTO root_own FROM public.categories WHERE id = root;
  res := public.apply_schema_change(
    root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 'zz_size'
                           THEN e || '{"type":"string"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(root_own) e),
    '{}'::jsonb,
    '{"zz_size":{"strategy":"cast"}}'::jsonb,
    NULL);

  INSERT INTO _apply_results VALUES (8,
    'cast (number->string): 4 items hold zz_size and all convert, 0 orphaned',
    (res->>'items_updated')::int = 4 AND (res->>'items_orphaned')::int = 0,
    format('updated=%s orphaned=%s', res->>'items_updated', res->>'items_orphaned'));

  INSERT INTO _apply_results VALUES (9,
    'cast: the stored value is now a JSON string, and its content survived',
    jsonb_typeof((SELECT data->'zz_size' FROM public.items WHERE id = r1)) = 'string'
      AND (SELECT data->>'zz_size' FROM public.items WHERE id = r1) = '10',
    format('type=%s value=%s',
      jsonb_typeof((SELECT data->'zz_size' FROM public.items WHERE id = r1)),
      (SELECT data->>'zz_size' FROM public.items WHERE id = r1)));

  INSERT INTO _apply_results VALUES (10,
    'items.schema_version bumped to 2 on TOUCHED items, left at 1 on untouched',
    (SELECT schema_version FROM public.items WHERE id = r1) = 2
      AND (SELECT schema_version FROM public.items WHERE id = c1) = 2
      AND (SELECT schema_version FROM public.items WHERE id = c2) = 1,
    format('r1=%s c1=%s c2=%s (c2 has no zz_size, so it was not touched)',
      (SELECT schema_version FROM public.items WHERE id = r1),
      (SELECT schema_version FROM public.items WHERE id = c1),
      (SELECT schema_version FROM public.items WHERE id = c2)));

  -- ── STEP C (v3): retype string → number, values cannot cast ─
  SELECT own_fields INTO root_own FROM public.categories WHERE id = root;
  res := public.apply_schema_change(
    root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 'zz_brand'
                           THEN e || '{"type":"number"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(root_own) e),
    '{}'::jsonb,
    '{"zz_brand":{"strategy":"cast"}}'::jsonb,
    NULL);

  SELECT data INTO d FROM public.items WHERE id = r1;
  INSERT INTO _apply_results VALUES (11,
    'cast failure NEVER deletes: "Acme" moved to __orphaned, key removed from data',
    (res->>'items_orphaned')::int = 5
      AND d->'__orphaned'->>'zz_brand' = 'Acme'
      AND NOT (d ? 'zz_brand'),
    format('orphaned=%s __orphaned.zz_brand=%s still_present=%s',
      res->>'items_orphaned', d->'__orphaned'->>'zz_brand', (d ? 'zz_brand')::text));

  -- ── STEP D (v4): remove a field, strategy orphan ──────────
  SELECT own_fields INTO root_own FROM public.categories WHERE id = root;
  res := public.apply_schema_change(
    root,
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(root_own) e WHERE e->>'key' <> 'zz_color'),
    '{}'::jsonb,
    '{"zz_color":{"strategy":"orphan"}}'::jsonb,
    NULL);

  SELECT data INTO d FROM public.items WHERE id = r1;
  INSERT INTO _apply_results VALUES (12,
    'orphan: removed field value preserved under __orphaned alongside the earlier one',
    d->'__orphaned'->>'zz_color' = 'red'
      AND d->'__orphaned'->>'zz_brand' = 'Acme'
      AND NOT (d ? 'zz_color'),
    (d->'__orphaned')::text);

  -- ── STEP E: discard WITH confirm, on the child ────────────
  res := public.apply_schema_change(
    child, '[]'::jsonb, '{}'::jsonb,
    '{"zz_note":{"strategy":"discard","confirm":true}}'::jsonb,
    NULL);

  SELECT data INTO d FROM public.items WHERE id = c1;
  INSERT INTO _apply_results VALUES (13,
    'discard (confirmed): the key is gone from data and NOT kept in __orphaned',
    NOT (d ? 'zz_note')
      AND NOT (COALESCE(d->'__orphaned', '{}'::jsonb) ? 'zz_note'),
    d::text);

  INSERT INTO _apply_results VALUES (14,
    'Applying on the child versioned the child only, leaving the root history alone',
    (SELECT max(version) FROM public.schema_versions WHERE category_id = child) = 5
      AND (SELECT max(version) FROM public.schema_versions WHERE category_id = root) = 4,
    format('child=%s root=%s',
      (SELECT max(version) FROM public.schema_versions WHERE category_id = child),
      (SELECT max(version) FROM public.schema_versions WHERE category_id = root)));

  -- ── STEP F: rollback the root to version 1 ────────────────
  res := public.rollback_schema_version(root, 1, NULL);

  INSERT INTO _apply_results VALUES (15,
    'rollback writes a NEW FORWARD version (5), it does not rewrite history',
    (res->>'version')::int = 5
      AND (res->>'restored_from')::int = 1
      AND (SELECT count(*) FROM public.schema_versions WHERE category_id = root) = 5,
    format('version=%s restored_from=%s total_rows=%s',
      res->>'version', res->>'restored_from',
      (SELECT count(*) FROM public.schema_versions WHERE category_id = root)));

  INSERT INTO _apply_results VALUES (16,
    'rollback restored the authored schema exactly (zz_color back, zz_size number again)',
    (SELECT own_fields FROM public.categories WHERE id = root)
      = (SELECT authored->'own_fields' FROM public.schema_versions
          WHERE category_id = root AND version = 1),
    (SELECT jsonb_pretty(own_fields) FROM public.categories WHERE id = root));

  INSERT INTO _apply_results VALUES (17,
    'The rollback is recorded in the audit trail as a rollback',
    (SELECT change_summary->0->>'kind' FROM public.schema_versions
      WHERE category_id = root AND version = 5) = 'rollback',
    (SELECT change_summary->0 FROM public.schema_versions
      WHERE category_id = root AND version = 5)::text);
END $$;


-- ============================================================
-- Block 2 — atomicity: inject a failure mid-transaction
-- ------------------------------------------------------------
-- The trigger fires when apply_schema_change reaches step 5, i.e.
-- AFTER it has rewritten the category and remediated item data. If
-- the function is genuinely atomic, none of that survives.
-- ============================================================
CREATE OR REPLACE FUNCTION public._zz_inject_failure()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'injected failure: schema_versions write blocked';
END;
$$;

DROP TRIGGER IF EXISTS _zz_inject_failure ON public.schema_versions;
CREATE TRIGGER _zz_inject_failure
  BEFORE INSERT ON public.schema_versions
  FOR EACH ROW EXECUTE FUNCTION public._zz_inject_failure();

DO $$
DECLARE
  root UUID := 'aa000000-0000-0000-0000-0000000000a1';
  own_before  JSONB;
  own_after   JSONB;
  data_before TEXT;
  data_after  TEXT;
  ver_before  BIGINT;
  ver_after   BIGINT;
  ok  BOOLEAN;
  msg TEXT;
BEGIN
  SELECT own_fields INTO own_before FROM public.categories WHERE id = root;
  SELECT md5(string_agg(i.id::text || i.data::text || i.schema_version::text, '|' ORDER BY i.id))
    INTO data_before
  FROM public.items i
  WHERE i.category_id IN (SELECT s.id FROM public.get_category_subtree(root) s);
  SELECT count(*) INTO ver_before FROM public.schema_versions
   WHERE category_id IN (SELECT s.id FROM public.get_category_subtree(root) s);

  BEGIN
    PERFORM public.apply_schema_change(
      root,
      (SELECT jsonb_agg(e) FROM jsonb_array_elements(own_before) e WHERE e->>'key' <> 'zz_req'),
      '{}'::jsonb,
      '{"zz_req":{"strategy":"orphan"}}'::jsonb,
      NULL);
    ok := false; msg := '(no exception raised — the injection did not fire)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;

  INSERT INTO _apply_results VALUES (18,
    'An injected mid-transaction failure aborts apply_schema_change', ok, msg);

  SELECT own_fields INTO own_after FROM public.categories WHERE id = root;
  SELECT md5(string_agg(i.id::text || i.data::text || i.schema_version::text, '|' ORDER BY i.id))
    INTO data_after
  FROM public.items i
  WHERE i.category_id IN (SELECT s.id FROM public.get_category_subtree(root) s);
  SELECT count(*) INTO ver_after FROM public.schema_versions
   WHERE category_id IN (SELECT s.id FROM public.get_category_subtree(root) s);

  INSERT INTO _apply_results VALUES (19,
    'ZERO partial state: schema, item data, schema_version and history all unchanged',
    own_before = own_after
      AND data_before IS NOT DISTINCT FROM data_after
      AND ver_before = ver_after,
    format('own_fields_same=%s items_digest_same=%s versions %s->%s',
      (own_before = own_after)::text,
      (data_before IS NOT DISTINCT FROM data_after)::text,
      ver_before, ver_after));
END $$;

DROP TRIGGER IF EXISTS _zz_inject_failure ON public.schema_versions;
DROP FUNCTION IF EXISTS public._zz_inject_failure();


-- ============================================================
-- Block 3 — tear the sandbox down (CASCADE takes the child,
-- its items and every schema_versions row with it)
-- ============================================================
DELETE FROM public.categories WHERE id = 'aa000000-0000-0000-0000-0000000000a1';


-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _apply_results
ORDER BY n;

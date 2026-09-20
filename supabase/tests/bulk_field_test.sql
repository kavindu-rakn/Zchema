-- ============================================================
-- Zchema — bulk field edits and staleness counting
-- ------------------------------------------------------------
-- Built for the Supabase SQL editor: returns a PASS/FAIL table as its
-- FINAL statement.
--
-- Covers set_item_field() and get_stale_items() (functions.sql §12,
-- §13). The interesting part is the optimistic token: a bulk edit must
-- skip rows that moved on since the user selected them, say which, and
-- still write the rest.
--
-- `updated_at` is set from now(), which is the TRANSACTION timestamp,
-- so re-updating a row inside this one script cannot change it. A row
-- that has moved on is therefore simulated the only faithful way
-- available here — by handing the function the token the user would
-- have been holding, one second behind the row.
--
-- NON-DESTRUCTIVE: fixed ids, cleaned before and after.
--
-- Run AFTER every feature file.
-- Expected: 16 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _bulk_results;
CREATE TEMP TABLE _bulk_results (n int PRIMARY KEY, assertion text, status text, detail text);

-- ── Run SQL as `authenticated` with a given uid ──────────────
-- Returns the first column of the first row as text, or
-- 'DENIED: <message>'. Always restores the original role.
CREATE OR REPLACE FUNCTION pg_temp._as(p_uid UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE res TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql INTO res;
    res := COALESCE(res, 'OK');
  EXCEPTION WHEN OTHERS THEN
    res := 'DENIED: ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN res;
END $fn$;

CREATE OR REPLACE FUNCTION pg_temp._forget()
RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE
  ids UUID[] := ARRAY[
    'beef0000-0000-4000-8000-00000000b001', 'beef0000-0000-4000-8000-00000000b002',
    'beef0000-0000-4000-8000-00000000c001', 'beef0000-0000-4000-8000-00000000c002',
    'beef0000-0000-4000-8000-00000000c003', 'beef0000-0000-4000-8000-00000000c004']::UUID[];
BEGIN
  DELETE FROM public.categories WHERE id = ANY(ids);
  DELETE FROM public.trash
  WHERE batch IN (
    SELECT t.batch FROM public.trash t
    WHERE t.row_id = ANY(ids) OR (t.row_data->>'category_id')::uuid = ANY(ids)
  );
  DELETE FROM auth.users WHERE id IN (
    'beef0000-0000-4000-8000-00000000a001', 'beef0000-0000-4000-8000-00000000a002');
END $fn$;


DO $$
DECLARE
  editor_id CONSTANT UUID := 'beef0000-0000-4000-8000-00000000a001';
  viewer_id CONSTANT UUID := 'beef0000-0000-4000-8000-00000000a002';
  root_id   CONSTANT UUID := 'beef0000-0000-4000-8000-00000000b001';
  child_id  CONSTANT UUID := 'beef0000-0000-4000-8000-00000000b002';
  item1     CONSTANT UUID := 'beef0000-0000-4000-8000-00000000c001';
  item2     CONSTANT UUID := 'beef0000-0000-4000-8000-00000000c002';
  item3     CONSTANT UUID := 'beef0000-0000-4000-8000-00000000c003';
  ghost     CONSTANT UUID := 'beef0000-0000-4000-8000-00000000c004';
  seen      TIMESTAMPTZ;
  fresh     JSONB;
  stale     JSONB;
  r         TEXT;
  res       JSONB;
  ok        BOOLEAN;
BEGIN
  PERFORM pg_temp._forget();

  -- ── Fixture: two categories, so the version stamp has two
  --    different right answers to choose between. ─────────────
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', editor_id, 'authenticated', 'authenticated',
     'bulktest-editor@zchema.test', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', viewer_id, 'authenticated', 'authenticated',
     'bulktest-viewer@zchema.test', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false);
  UPDATE public.profiles SET role = 'DATA_EDITOR' WHERE id = editor_id;
  UPDATE public.profiles SET role = 'VIEWER'      WHERE id = viewer_id;

  INSERT INTO public.categories (id, name, slug, own_fields) VALUES
    (root_id, 'ZZ Bulk Root', 'zz-bulk-root',
     '[{"key":"status","label":"Status","type":"string","required":false,"position":0}]'::jsonb);
  INSERT INTO public.categories (id, name, slug, parent_id) VALUES
    (child_id, 'ZZ Bulk Child', 'zz-bulk-child', root_id);

  -- The parent is on v4, the child on v2.
  INSERT INTO public.schema_versions (category_id, version, snapshot) VALUES
    (root_id, 1, '[]'::jsonb), (root_id, 2, '[]'::jsonb),
    (root_id, 3, '[]'::jsonb), (root_id, 4, '[]'::jsonb),
    (child_id, 1, '[]'::jsonb), (child_id, 2, '[]'::jsonb);

  INSERT INTO public.items (id, category_id, data, schema_version) VALUES
    (item1, root_id,  '{"status":"draft"}'::jsonb, 1),
    (item2, root_id,  '{"status":"draft"}'::jsonb, 1),
    (item3, child_id, '{"status":"draft"}'::jsonb, 1);

  SELECT i.updated_at INTO seen FROM public.items i WHERE i.id = item1;
  fresh := jsonb_build_array(
    jsonb_build_object('id', item1, 'updated_at', seen),
    jsonb_build_object('id', item2, 'updated_at', seen));
  stale := jsonb_build_array(
    jsonb_build_object('id', item1, 'updated_at', seen - interval '1 second'),
    jsonb_build_object('id', item2, 'updated_at', seen));

  -- ── 1. One call sets the value on every selected item ──────
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text', fresh, 'status', '"live"'::jsonb));
  res := r::jsonb;
  SELECT count(*) = 2 INTO ok FROM public.items
   WHERE id IN (item1, item2) AND data->>'status' = 'live';
  ok := ok AND (res->>'updated')::int = 2 AND res->'conflicted' = '[]'::jsonb;
  INSERT INTO _bulk_results VALUES (1, 'one call sets the field on every selected item',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 2. Each item is stamped with ITS OWN category's version ─
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text',
    jsonb_build_array(jsonb_build_object('id', item1, 'updated_at', seen),
                      jsonb_build_object('id', item3, 'updated_at', seen)),
    'status', '"shipped"'::jsonb));
  SELECT (SELECT schema_version FROM public.items WHERE id = item1) = 4
     AND (SELECT schema_version FROM public.items WHERE id = item3) = 2
    INTO ok;
  INSERT INTO _bulk_results VALUES (2, 'each item takes its own category''s current version, not the caller''s',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 3. A JSON null clears the key rather than storing null ──
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text', fresh, 'status', 'null'::jsonb));
  SELECT NOT (data ? 'status') INTO ok FROM public.items WHERE id = item1;
  INSERT INTO _bulk_results VALUES (3, 'a JSON null clears the key instead of storing a null value',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  PERFORM pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text', fresh, 'status', '"draft"'::jsonb));

  -- ── 4. A row that moved on is skipped and named ────────────
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text', stale, 'status', '"live"'::jsonb));
  res := r::jsonb;
  ok := (res->>'updated')::int = 1
    AND res->'conflicted' = jsonb_build_array(item1);
  INSERT INTO _bulk_results VALUES (4, 'an item changed since it was selected is skipped and named',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 5. …and its unchanged siblings are still written ───────
  SELECT (SELECT data->>'status' FROM public.items WHERE id = item1) = 'draft'
     AND (SELECT data->>'status' FROM public.items WHERE id = item2) = 'live'
    INTO ok;
  INSERT INTO _bulk_results VALUES (5, 'the rest of the selection is written even when one conflicts',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 6. p_force is the deliberate overwrite ─────────────────
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L, true)::text', stale, 'status', '"forced"'::jsonb));
  res := r::jsonb;
  SELECT count(*) = 2 INTO ok FROM public.items
   WHERE id IN (item1, item2) AND data->>'status' = 'forced';
  ok := ok AND (res->>'updated')::int = 2 AND res->'conflicted' = '[]'::jsonb;
  INSERT INTO _bulk_results VALUES (6, 'p_force overwrites the conflicting rows too',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 7. A null token means "no check", not "never matches" ──
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text',
    jsonb_build_array(jsonb_build_object('id', item1, 'updated_at', NULL)),
    'status', '"untokened"'::jsonb));
  res := r::jsonb;
  SELECT data->>'status' = 'untokened' INTO ok FROM public.items WHERE id = item1;
  ok := ok AND (res->>'updated')::int = 1;
  INSERT INTO _bulk_results VALUES (7, 'an item sent without a token is written unconditionally',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 8. An id that no longer exists is reported, not counted ─
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text',
    jsonb_build_array(jsonb_build_object('id', ghost, 'updated_at', seen)),
    'status', '"live"'::jsonb));
  res := r::jsonb;
  ok := (res->>'updated')::int = 0 AND res->'conflicted' = jsonb_build_array(ghost);
  INSERT INTO _bulk_results VALUES (8, 'an item deleted meanwhile is reported rather than silently counted',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 9. An unusable key is refused ──────────────────────────
  r := pg_temp._as(editor_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text', fresh, 'Status; DROP', '"x"'::jsonb));
  INSERT INTO _bulk_results VALUES (9, 'a key no schema could define is refused',
    CASE WHEN r LIKE '%not a valid field key%' OR r LIKE '%Not a valid field key%'
         THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 10. A VIEWER is refused by name, not by silence ────────
  r := pg_temp._as(viewer_id, format(
    'SELECT public.set_item_field(%L, %L, %L)::text', fresh, 'status', '"live"'::jsonb));
  SELECT data->>'status' <> 'live' INTO ok FROM public.items WHERE id = item2;
  ok := COALESCE(ok, false) AND r LIKE 'DENIED:%';
  INSERT INTO _bulk_results VALUES (10, 'a VIEWER is told no rather than handed a conflict report',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 11. An empty selection is a no-op ──────────────────────
  r := pg_temp._as(editor_id,
    'SELECT public.set_item_field(''[]''::jsonb, ''status'', ''"live"''::jsonb)::text');
  res := r::jsonb;
  INSERT INTO _bulk_results VALUES (11, 'an empty selection writes nothing and reports nothing',
    CASE WHEN (res->>'updated')::int = 0 AND res->'conflicted' = '[]'::jsonb
         THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 12. Authorship is still stamped from the session ───────
  SELECT updated_by = editor_id INTO ok FROM public.items WHERE id = item1;
  INSERT INTO _bulk_results VALUES (12, 'a bulk edit stamps updated_by like any other write',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 13–16. get_stale_items ─────────────────────────────────
  -- item1 and item2 sit on v4 (root's current). Put one behind.
  UPDATE public.items SET schema_version = 2 WHERE id = item1;

  res := public.get_stale_items(root_id);
  INSERT INTO _bulk_results VALUES (13, 'stale counts only the items below the current version',
    CASE WHEN (res->>'current_version')::int = 4 AND (res->>'stale_count')::int = 1
         THEN 'PASS' ELSE 'FAIL' END, res::text);

  INSERT INTO _bulk_results VALUES (14, 'oldest_version is the furthest behind any item has fallen',
    CASE WHEN (res->>'oldest_version')::int = 2 THEN 'PASS' ELSE 'FAIL' END, res::text);

  UPDATE public.items SET schema_version = 4 WHERE id = item1;
  res := public.get_stale_items(root_id);
  INSERT INTO _bulk_results VALUES (15, 'nothing is stale once every item is on the current version',
    CASE WHEN (res->>'stale_count')::int = 0 AND res->>'oldest_version' IS NULL
         THEN 'PASS' ELSE 'FAIL' END, res::text);

  -- A category whose schema has never been versioned.
  DELETE FROM public.schema_versions WHERE category_id = child_id;
  res := public.get_stale_items(child_id);
  INSERT INTO _bulk_results VALUES (16, 'a category with no versions yet reports v0 and nothing stale',
    CASE WHEN (res->>'current_version')::int = 0 AND (res->>'stale_count')::int = 0
              AND res->>'oldest_version' IS NULL
         THEN 'PASS' ELSE 'FAIL' END, res::text);

  PERFORM pg_temp._forget();
END $$;

SELECT n, assertion, status, detail FROM _bulk_results ORDER BY n;

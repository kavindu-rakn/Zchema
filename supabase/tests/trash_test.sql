-- ============================================================
-- Zchema — trash and item-authorship tests
-- ------------------------------------------------------------
-- Built for the Supabase SQL editor: returns a PASS/FAIL table as its
-- FINAL statement.
--
-- Creates three throwaway users (@zchema.test) and a two-level sandbox
-- tree, then drives everything as `authenticated` with simulated JWT
-- claims — the same path a PostgREST call takes. Deletes, restores and
-- purges go through the real functions and the real triggers.
--
-- NON-DESTRUCTIVE: fixed ids, cleaned before and after. The cleanup's
-- own deletes land in the trash like any other, so it removes those
-- trash entries too.
--
-- Run AFTER every feature file, trash.sql included.
-- Expected: 18 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _trash_results;
CREATE TEMP TABLE _trash_results (n int PRIMARY KEY, assertion text, status text, detail text);

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

-- ── Remove every trace of the sandbox, trash entries included ──
CREATE OR REPLACE FUNCTION pg_temp._forget()
RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE
  ids UUID[] := ARRAY[
    'c0ffee00-0000-4000-8000-00000000b001', 'c0ffee00-0000-4000-8000-00000000b002',
    'c0ffee00-0000-4000-8000-00000000c001', 'c0ffee00-0000-4000-8000-00000000c002',
    'c0ffee00-0000-4000-8000-00000000c003']::UUID[];
BEGIN
  DELETE FROM public.categories WHERE id = ANY(ids);
  DELETE FROM public.trash
  WHERE batch IN (
    SELECT t.batch FROM public.trash t
    WHERE t.row_id = ANY(ids) OR (t.row_data->>'category_id')::uuid = ANY(ids)
  );
  DELETE FROM auth.users WHERE id IN (
    'c0ffee00-0000-4000-8000-00000000a001', 'c0ffee00-0000-4000-8000-00000000a002',
    'c0ffee00-0000-4000-8000-00000000a003');
END $fn$;


DO $$
DECLARE
  admin_id  CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000a001';
  editor_id CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000a002';
  viewer_id CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000a003';
  root_id   CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000b001';
  child_id  CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000b002';
  item1     CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000c001';
  item2     CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000c002';
  item3     CONSTANT UUID := 'c0ffee00-0000-4000-8000-00000000c003';
  r         TEXT;
  res       JSONB;
  b_item2   TEXT;
  b_item3   TEXT;
  b_tree    TEXT;
  b_item1   TEXT;
  b_purge   TEXT;
  listed    JSONB;
  ok        BOOLEAN;
BEGIN
  PERFORM pg_temp._forget();

  -- ── Fixture ────────────────────────────────────────────────
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES
    ('00000000-0000-0000-0000-000000000000', admin_id,  'authenticated', 'authenticated',
     'trashtest-admin@zchema.test', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', editor_id, 'authenticated', 'authenticated',
     'trashtest-editor@zchema.test', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false),
    ('00000000-0000-0000-0000-000000000000', viewer_id, 'authenticated', 'authenticated',
     'trashtest-viewer@zchema.test', '', now(), now(), now(),
     '{"provider":"email","providers":["email"]}', '{}', false);
  UPDATE public.profiles SET role = 'SCHEMA_ADMIN' WHERE id = admin_id;
  UPDATE public.profiles SET role = 'DATA_EDITOR'  WHERE id = editor_id;
  UPDATE public.profiles SET role = 'VIEWER'       WHERE id = viewer_id;

  INSERT INTO public.categories (id, name, slug, own_fields) VALUES
    (root_id, 'ZZ Trash Root', 'zz-trash-root',
     '[{"key":"name","label":"Name","type":"string","required":false,"position":0},
       {"key":"price","label":"Price","type":"number","required":false,"position":1}]'::jsonb);
  INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
    (child_id, 'ZZ Trash Child', 'zz-trash-child', root_id,
     '[{"key":"color","label":"Color","type":"string","required":false,"position":0}]'::jsonb);
  INSERT INTO public.schema_versions (category_id, version, snapshot)
  VALUES (child_id, 1, '[]'::jsonb);

  -- ── 1. A client cannot choose an item's author ─────────────
  r := pg_temp._as(editor_id, format(
    'INSERT INTO public.items (id, category_id, data, created_by, updated_by) VALUES (%L, %L, %L, %L, %L) RETURNING id',
    item1, child_id, '{"name":"A","price":1,"color":"red"}', admin_id, admin_id));
  SELECT created_by = editor_id AND updated_by = editor_id INTO ok FROM public.items WHERE id = item1;
  INSERT INTO _trash_results VALUES (1, 'insert by a client is stamped with the caller, not the claimed author',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, r);

  PERFORM pg_temp._as(editor_id, format(
    'INSERT INTO public.items (id, category_id, data) VALUES (%L, %L, %L), (%L, %L, %L) RETURNING id',
    item2, child_id, '{"name":"B"}', item3, child_id, '{"name":"C"}'));

  -- ── 2. An update changes updated_by, never created_by ──────
  r := pg_temp._as(admin_id, format(
    'UPDATE public.items SET data = data || %L, created_by = %L WHERE id = %L RETURNING id',
    '{"price":2}', viewer_id, item1));
  SELECT created_by = editor_id AND updated_by = admin_id INTO ok FROM public.items WHERE id = item1;
  INSERT INTO _trash_results VALUES (2, 'update stamps updated_by and cannot rewrite created_by',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 3. A raw DELETE, as a client could send, is captured ───
  r := pg_temp._as(editor_id, format('DELETE FROM public.items WHERE id = %L RETURNING id', item2));
  SELECT t.batch::text INTO b_item2 FROM public.trash t WHERE t.row_id = item2;
  SELECT NOT EXISTS (SELECT 1 FROM public.items WHERE id = item2)
     AND EXISTS (SELECT 1 FROM public.trash WHERE row_id = item2 AND deleted_by = editor_id
                 AND row_data->'data'->>'name' = 'B')
    INTO ok;
  INSERT INTO _trash_results VALUES (3, 'a direct DELETE lands in the trash with who deleted it',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 4. An editor restores an items-only entry ──────────────
  r := pg_temp._as(editor_id, format('SELECT public.restore_trash(%L)::text', b_item2));
  SELECT EXISTS (SELECT 1 FROM public.items WHERE id = item2 AND data->>'name' = 'B'
                 AND created_by = editor_id)
     AND NOT EXISTS (SELECT 1 FROM public.trash WHERE batch::text = b_item2)
    INTO ok;
  INSERT INTO _trash_results VALUES (4, 'restore puts the item back as it was and empties the entry',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 5. delete_items() reports the batch it made ────────────
  r := pg_temp._as(editor_id, format('SELECT public.delete_items(ARRAY[%L]::uuid[])::text', item3));
  b_item3 := (r::jsonb)->>'trash_batch';
  SELECT EXISTS (SELECT 1 FROM public.trash WHERE row_id = item3 AND batch::text = b_item3) INTO ok;
  INSERT INTO _trash_results VALUES (5, 'delete_items() returns the batch its rows landed in',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 6. A viewer can neither see nor restore the trash ──────
  r := pg_temp._as(viewer_id, 'SELECT public.list_trash()::text');
  INSERT INTO _trash_results VALUES (6, 'a VIEWER cannot list the trash',
    CASE WHEN r LIKE 'DENIED%' THEN 'PASS' ELSE 'FAIL' END, left(r, 120));
  r := pg_temp._as(viewer_id, format('SELECT public.restore_trash(%L)::text', b_item3));
  INSERT INTO _trash_results VALUES (7, 'a VIEWER cannot restore',
    CASE WHEN r LIKE 'DENIED%' THEN 'PASS' ELSE 'FAIL' END, left(r, 120));

  -- ── 8. Nobody reaches the table itself, and anon no function ──
  ok := NOT has_table_privilege('authenticated', 'public.trash', 'SELECT')
    AND NOT has_table_privilege('authenticated', 'public.trash', 'DELETE')
    AND NOT has_function_privilege('anon', 'public.list_trash()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.restore_trash(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.purge_trash(text, boolean)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.delete_items(uuid[])', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.member_email(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.trash_blocked_by(bigint)', 'EXECUTE');
  INSERT INTO _trash_results VALUES (8, 'no client privilege on public.trash; no trash function for anon',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 9. Deleting a category is ONE entry: tree, items, history ──
  r := pg_temp._as(admin_id, format('SELECT public.delete_category_safely(%L, false)::text', root_id));
  b_tree := (r::jsonb)->>'trash_batch';
  -- This whole script is one transaction, so this also proves that two
  -- deletions in one transaction stay two entries: item3, deleted in
  -- test 5, must not have joined this batch.
  SELECT count(*) FILTER (WHERE table_name = 'categories') = 2
     AND count(*) FILTER (WHERE table_name = 'items') = 2
     AND count(*) FILTER (WHERE table_name = 'schema_versions') = 1
     AND b_tree IS DISTINCT FROM b_item3
    INTO ok
  FROM public.trash WHERE batch::text = b_tree;
  INSERT INTO _trash_results VALUES (9, 'a category delete is one batch of its own: tree, items and versions',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 10. list_trash names the top of the tree, not every node ──
  listed := pg_temp._as(admin_id, 'SELECT public.list_trash()::text')::jsonb;
  SELECT e->'top_categories' = '["ZZ Trash Root"]'::jsonb AND (e->>'categories')::int = 2
         AND (e->>'items')::int = 2 AND e->>'deleted_by' = 'trashtest-admin@zchema.test'
    INTO ok
  FROM jsonb_array_elements(listed) e WHERE e->>'batch' = b_tree;
  INSERT INTO _trash_results VALUES (10, 'list_trash() summarises an entry by its top category and who deleted it',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 11. An item cannot go back before its category ─────────
  r := pg_temp._as(editor_id, format('SELECT public.restore_trash(%L)::text', b_item3));
  INSERT INTO _trash_results VALUES (11, 'an item whose category is in the trash says which to restore first',
    CASE WHEN r LIKE '%Restore “ZZ Trash Child” first%' THEN 'PASS' ELSE 'FAIL' END, left(r, 160));

  -- ── 12. Restoring categories needs a SCHEMA_ADMIN ──────────
  r := pg_temp._as(editor_id, format('SELECT public.restore_trash(%L)::text', b_tree));
  INSERT INTO _trash_results VALUES (12, 'a DATA_EDITOR cannot restore a category entry',
    CASE WHEN r LIKE 'DENIED%' THEN 'PASS' ELSE 'FAIL' END, left(r, 120));

  -- ── 13. The admin restores the whole tree ──────────────────
  r := pg_temp._as(admin_id, format('SELECT public.restore_trash(%L)::text', b_tree));
  SELECT (SELECT parent_id FROM public.categories WHERE id = child_id) = root_id
     AND (SELECT own_fields->0->>'key' FROM public.categories WHERE id = child_id) = 'color'
     AND (SELECT count(*) FROM public.items WHERE category_id = child_id) = 2
     AND (SELECT count(*) FROM public.schema_versions WHERE category_id = child_id) = 1
    INTO ok;
  INSERT INTO _trash_results VALUES (13, 'restore rebuilds the tree, its items and its history',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 14. …and then the item can follow ─────────────────────
  r := pg_temp._as(editor_id, format('SELECT public.restore_trash(%L)::text', b_item3));
  SELECT EXISTS (SELECT 1 FROM public.items WHERE id = item3) INTO ok;
  INSERT INTO _trash_results VALUES (14, 'once its category is back, the item restores',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 15. Restore never drops a value the schema no longer has ──
  r := pg_temp._as(editor_id, format('SELECT public.delete_items(ARRAY[%L]::uuid[])::text', item1));
  b_item1 := (r::jsonb)->>'trash_batch';
  PERFORM pg_temp._as(admin_id, format(
    'UPDATE public.categories SET own_fields = %L WHERE id = %L RETURNING id', '[]', child_id));
  r := pg_temp._as(editor_id, format('SELECT public.restore_trash(%L)::text', b_item1));
  SELECT NOT (data ? 'color') AND data->'__orphaned'->>'color' = 'red'
     AND data->>'name' = 'A' AND created_by = editor_id AND updated_by = admin_id
    INTO ok
  FROM public.items WHERE id = item1;
  INSERT INTO _trash_results VALUES (15, 'a value whose field is gone comes back under __orphaned, authors intact',
    CASE WHEN COALESCE(ok, false) AND (r::jsonb->>'orphaned_values')::int = 1 THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 16. Purging needs an admin AND confirm ─────────────────
  r := pg_temp._as(editor_id, format('SELECT public.delete_items(ARRAY[%L]::uuid[])::text', item2));
  b_purge := (r::jsonb)->>'trash_batch';
  ok := pg_temp._as(editor_id, format('SELECT public.purge_trash(%L, true)::text', b_purge)) LIKE 'DENIED%'
    AND pg_temp._as(admin_id, format('SELECT public.purge_trash(%L)::text', b_purge)) LIKE 'DENIED%Confirm%';
  r := pg_temp._as(admin_id, format('SELECT public.purge_trash(%L, true)::text', b_purge));
  ok := ok AND NOT EXISTS (SELECT 1 FROM public.trash WHERE batch::text = b_purge)
          AND NOT EXISTS (SELECT 1 FROM public.items WHERE id = item2);
  INSERT INTO _trash_results VALUES (16, 'purge refuses an editor and a missing confirm, then deletes for good',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── 17. Unknown and malformed entries are refused cleanly ──
  ok := pg_temp._as(admin_id, 'SELECT public.restore_trash(''999999999999'')::text') LIKE '%no longer exists%'
    AND pg_temp._as(admin_id, 'SELECT public.restore_trash(''1; select 1'')::text') LIKE '%not a trash entry%';
  INSERT INTO _trash_results VALUES (17, 'restore refuses an unknown or malformed entry id',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 18. The restore flag does not outlive the restore ──────
  INSERT INTO _trash_results VALUES (18, 'restore_trash() switches its author flag back off',
    CASE WHEN COALESCE(current_setting('zchema.restoring', true), '') <> 'on' THEN 'PASS' ELSE 'FAIL' END,
    current_setting('zchema.restoring', true));

  PERFORM pg_temp._forget();
END $$;

SELECT n, assertion, status, detail FROM _trash_results ORDER BY n;

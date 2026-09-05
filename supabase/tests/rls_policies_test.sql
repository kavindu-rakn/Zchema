-- ============================================================
-- Zchema — RLS policy tests (Phase 1, Increment 4)
-- ------------------------------------------------------------
-- Built for the Supabase SQL editor: returns a PASS/FAIL/SKIP
-- table as its FINAL statement.
--
-- Part A (1-8)  : policy metadata — always runs, no dependencies.
-- Part B (9-16) : REAL behavioural probes. Creates three throwaway
--                 auth.users, switches to the `authenticated` role
--                 with simulated JWT claims, and checks what each
--                 role can actually do. If the test users cannot be
--                 created on this Supabase version, rows 9-16 report
--                 SKIP (with the reason) instead of a false PASS.
--
-- NON-DESTRUCTIVE: fixture ids are fixed and cleaned before + after;
-- test users use @zchema.test emails.
--
-- Run AFTER schema.sql + functions.sql + triggers.sql + policies.sql.
-- Expected: 16 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _p_test_results;
CREATE TEMP TABLE _p_test_results (n int PRIMARY KEY, assertion text, status text, detail text);

-- ── Probe helper: run SQL as `authenticated` with a given uid ──
-- Returns 'ALLOWED:<rows>' or 'DENIED: <message>'. Always restores
-- the original role, including on the error path.
CREATE OR REPLACE FUNCTION pg_temp._rls_probe(p_uid UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE res TEXT; n_rows INT;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS n_rows = ROW_COUNT;
    res := 'ALLOWED:' || n_rows;
  EXCEPTION WHEN OTHERS THEN
    res := 'DENIED: ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN res;
END $fn$;

-- ── Probe helper: scalar count as `authenticated` ─────────────
CREATE OR REPLACE FUNCTION pg_temp._rls_count(p_uid UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $fn$
DECLARE c INT; res TEXT;
BEGIN
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', p_uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql INTO c;
    res := c::text;
  EXCEPTION WHEN OTHERS THEN
    res := 'DENIED: ' || SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN res;
END $fn$;


-- ============================================================
-- PART A — policy metadata
-- ============================================================
DO $$
DECLARE c INT; t TEXT; ok BOOLEAN;
BEGIN
  -- 1. RLS enabled on all six tables
  SELECT count(*) INTO c FROM pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname IN ('profiles','blueprints','categories','attributes','items','schema_versions')
     AND relrowsecurity;
  INSERT INTO _p_test_results VALUES
    (1, 'RLS enabled on all six tables', CASE WHEN c = 6 THEN 'PASS' ELSE 'FAIL' END,
     format('%s of 6 tables have rowsecurity', c));

  -- 2. schema_versions has NO update and NO delete policy (append-only by omission)
  SELECT count(*) INTO c FROM pg_policies
   WHERE schemaname='public' AND tablename='schema_versions' AND cmd IN ('UPDATE','DELETE');
  INSERT INTO _p_test_results VALUES
    (2, 'schema_versions has no UPDATE/DELETE policy (append-only)', CASE WHEN c = 0 THEN 'PASS' ELSE 'FAIL' END,
     format('found %s update/delete policies', c));

  -- 3. schema_versions has exactly one SELECT and one INSERT policy
  SELECT count(*) INTO c FROM pg_policies
   WHERE schemaname='public' AND tablename='schema_versions' AND cmd IN ('SELECT','INSERT');
  INSERT INTO _p_test_results VALUES
    (3, 'schema_versions has SELECT + INSERT policies', CASE WHEN c = 2 THEN 'PASS' ELSE 'FAIL' END,
     format('found %s select/insert policies', c));

  -- 4. categories write policies are SCHEMA_ADMIN-only (never DATA_EDITOR)
  SELECT count(*) INTO c FROM pg_policies
   WHERE schemaname='public' AND tablename='categories' AND cmd IN ('INSERT','UPDATE','DELETE')
     AND COALESCE(qual,'') || COALESCE(with_check,'') LIKE '%SCHEMA_ADMIN%'
     AND COALESCE(qual,'') || COALESCE(with_check,'') NOT LIKE '%DATA_EDITOR%';
  INSERT INTO _p_test_results VALUES
    (4, 'categories INSERT/UPDATE/DELETE restricted to SCHEMA_ADMIN only', CASE WHEN c = 3 THEN 'PASS' ELSE 'FAIL' END,
     format('%s of 3 admin-only write policies', c));

  -- 5. items write policies admit DATA_EDITOR
  SELECT count(*) INTO c FROM pg_policies
   WHERE schemaname='public' AND tablename='items' AND cmd IN ('INSERT','UPDATE','DELETE')
     AND COALESCE(qual,'') || COALESCE(with_check,'') LIKE '%DATA_EDITOR%';
  INSERT INTO _p_test_results VALUES
    (5, 'items INSERT/UPDATE/DELETE admit DATA_EDITOR', CASE WHEN c = 3 THEN 'PASS' ELSE 'FAIL' END,
     format('%s of 3 item write policies mention DATA_EDITOR', c));

  -- 6. blueprints and attributes each carry the full four-policy set
  SELECT count(*) INTO c FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('blueprints','attributes');
  INSERT INTO _p_test_results VALUES
    (6, 'blueprints + attributes have 4 policies each', CASE WHEN c = 8 THEN 'PASS' ELSE 'FAIL' END,
     format('found %s policies across both tables', c));

  -- 7. get_user_role() is SECURITY DEFINER + STABLE (prevents policy recursion)
  SELECT (prosecdef AND provolatile = 's') INTO ok FROM pg_proc
   WHERE proname = 'get_user_role' AND pronamespace = 'public'::regnamespace;
  INSERT INTO _p_test_results VALUES
    (7, 'get_user_role() is SECURITY DEFINER and STABLE', CASE WHEN COALESCE(ok,false) THEN 'PASS' ELSE 'FAIL' END,
     format('secdef+stable=%s', COALESCE(ok::text,'function missing')));

  -- 8. grant shape: append-only schema_versions, no TRUNCATE anywhere, anon locked out.
  --    Supabase default privileges GRANT ALL to anon/authenticated at table
  --    creation, so policies.sql must REVOKE before granting. TRUNCATE matters
  --    especially: it is NOT governed by RLS.
  t := '';
  IF NOT has_table_privilege('authenticated','public.schema_versions','SELECT')
     THEN t := t || 'sv.select missing; '; END IF;
  IF NOT has_table_privilege('authenticated','public.schema_versions','INSERT')
     THEN t := t || 'sv.insert missing; '; END IF;
  IF has_table_privilege('authenticated','public.schema_versions','UPDATE')
     THEN t := t || 'sv.UPDATE still granted; '; END IF;
  IF has_table_privilege('authenticated','public.schema_versions','DELETE')
     THEN t := t || 'sv.DELETE still granted; '; END IF;
  IF has_table_privilege('authenticated','public.categories','TRUNCATE')
     THEN t := t || 'categories.TRUNCATE still granted (RLS does not stop it); '; END IF;
  IF has_table_privilege('authenticated','public.items','TRUNCATE')
     THEN t := t || 'items.TRUNCATE still granted; '; END IF;
  IF has_table_privilege('anon','public.categories','SELECT')
     THEN t := t || 'anon can select categories; '; END IF;
  IF has_table_privilege('anon','public.items','SELECT')
     THEN t := t || 'anon can select items; '; END IF;
  INSERT INTO _p_test_results VALUES
    (8, 'Grants: schema_versions append-only, no TRUNCATE for authenticated, anon has none',
     CASE WHEN t = '' THEN 'PASS' ELSE 'FAIL' END,
     CASE WHEN t = '' THEN 'all grant checks clean' ELSE t END);
END $$;


-- ============================================================
-- PART B — behavioural probes under the `authenticated` role
-- ============================================================
DO $$
DECLARE
  admin_id  UUID := 'b0000000-0000-0000-0000-00000000a001';
  editor_id UUID := 'b0000000-0000-0000-0000-00000000a002';
  viewer_id UUID := 'b0000000-0000-0000-0000-00000000a003';
  cat_id    UUID := 'b0000000-0000-0000-0000-00000000c001';
  new_cat   UUID := 'b0000000-0000-0000-0000-00000000c002';
  ver_id    UUID := 'b0000000-0000-0000-0000-00000000d001';
  setup_err TEXT := NULL;
  r         TEXT;
  i         INT;
BEGIN
  -- ── setup: throwaway users + fixture category + audit row ──
  BEGIN
    DELETE FROM auth.users WHERE id IN (admin_id, editor_id, viewer_id);
    DELETE FROM public.categories WHERE id IN (cat_id, new_cat);

    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data, is_super_admin)
    VALUES
      ('00000000-0000-0000-0000-000000000000', admin_id,  'authenticated','authenticated',
       'rlstest-admin@zchema.test','', now(), now(), now(),
       '{"provider":"email","providers":["email"]}','{}', false),
      ('00000000-0000-0000-0000-000000000000', editor_id, 'authenticated','authenticated',
       'rlstest-editor@zchema.test','', now(), now(), now(),
       '{"provider":"email","providers":["email"]}','{}', false),
      ('00000000-0000-0000-0000-000000000000', viewer_id, 'authenticated','authenticated',
       'rlstest-viewer@zchema.test','', now(), now(), now(),
       '{"provider":"email","providers":["email"]}','{}', false);

    -- handle_new_user() created the profiles; set the roles under test
    UPDATE public.profiles SET role = 'SCHEMA_ADMIN' WHERE id = admin_id;
    UPDATE public.profiles SET role = 'DATA_EDITOR'  WHERE id = editor_id;
    UPDATE public.profiles SET role = 'VIEWER'       WHERE id = viewer_id;

    INSERT INTO public.categories (id, name, slug, own_fields)
    VALUES (cat_id, 'ZZ RLS Fixture', 'zz-rls-fixture',
            '[{"key":"brand","label":"Brand","type":"string","required":false,"position":0}]'::jsonb);

    INSERT INTO public.schema_versions (id, category_id, version, snapshot)
    VALUES (ver_id, cat_id, 1, '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    setup_err := SQLERRM;
  END;

  IF setup_err IS NOT NULL THEN
    FOR i IN 9..16 LOOP
      INSERT INTO _p_test_results VALUES
        (i, 'Behavioural probe #' || i, 'SKIP', 'test-user setup failed: ' || setup_err);
    END LOOP;
    RETURN;
  END IF;

  -- 9. VIEWER cannot INSERT a category
  r := pg_temp._rls_probe(viewer_id,
    format('INSERT INTO public.categories (id, name, slug) VALUES (%L, %L, %L)',
           new_cat, 'ZZ Viewer Attempt', 'zz-viewer-attempt'));
  INSERT INTO _p_test_results VALUES
    (9, 'VIEWER cannot INSERT a category', CASE WHEN r LIKE 'DENIED%' THEN 'PASS' ELSE 'FAIL' END, r);

  -- 10. DATA_EDITOR cannot INSERT a category (schema is admin-only)
  r := pg_temp._rls_probe(editor_id,
    format('INSERT INTO public.categories (id, name, slug) VALUES (%L, %L, %L)',
           new_cat, 'ZZ Editor Attempt', 'zz-editor-attempt'));
  INSERT INTO _p_test_results VALUES
    (10, 'DATA_EDITOR cannot INSERT a category', CASE WHEN r LIKE 'DENIED%' THEN 'PASS' ELSE 'FAIL' END, r);

  -- 11. VIEWER cannot INSERT an item
  r := pg_temp._rls_probe(viewer_id,
    format('INSERT INTO public.items (category_id, data) VALUES (%L, ''{}''::jsonb)', cat_id));
  INSERT INTO _p_test_results VALUES
    (11, 'VIEWER cannot INSERT an item', CASE WHEN r LIKE 'DENIED%' THEN 'PASS' ELSE 'FAIL' END, r);

  -- 12. DATA_EDITOR CAN INSERT an item
  r := pg_temp._rls_probe(editor_id,
    format('INSERT INTO public.items (category_id, data) VALUES (%L, ''{"brand":"x"}''::jsonb)', cat_id));
  INSERT INTO _p_test_results VALUES
    (12, 'DATA_EDITOR CAN INSERT an item', CASE WHEN r LIKE 'ALLOWED%' THEN 'PASS' ELSE 'FAIL' END, r);

  -- 13. SCHEMA_ADMIN CAN INSERT a category
  r := pg_temp._rls_probe(admin_id,
    format('INSERT INTO public.categories (id, name, slug) VALUES (%L, %L, %L)',
           new_cat, 'ZZ Admin Attempt', 'zz-admin-attempt'));
  INSERT INTO _p_test_results VALUES
    (13, 'SCHEMA_ADMIN CAN INSERT a category', CASE WHEN r LIKE 'ALLOWED%' THEN 'PASS' ELSE 'FAIL' END, r);

  -- 14. VIEWER can read categories (read is open to all authenticated)
  r := pg_temp._rls_count(viewer_id, 'SELECT count(*)::int FROM public.categories');
  INSERT INTO _p_test_results VALUES
    (14, 'VIEWER can SELECT categories', CASE WHEN r ~ '^[0-9]+$' AND r::int > 0 THEN 'PASS' ELSE 'FAIL' END,
     format('visible categories=%s', r));

  -- 15. VIEWER sees only their OWN profile row
  r := pg_temp._rls_count(viewer_id, 'SELECT count(*)::int FROM public.profiles');
  INSERT INTO _p_test_results VALUES
    (15, 'VIEWER sees only their own profile row', CASE WHEN r = '1' THEN 'PASS' ELSE 'FAIL' END,
     format('visible profiles=%s (expected 1)', r));

  -- 16. Even SCHEMA_ADMIN cannot UPDATE an audit row (append-only)
  r := pg_temp._rls_probe(admin_id,
    format('UPDATE public.schema_versions SET version = 99 WHERE id = %L', ver_id));
  INSERT INTO _p_test_results VALUES
    (16, 'SCHEMA_ADMIN cannot UPDATE schema_versions (append-only)',
     CASE WHEN r LIKE 'DENIED%' OR r = 'ALLOWED:0' THEN 'PASS' ELSE 'FAIL' END, r);

  -- ── cleanup ───────────────────────────────────────────────
  DELETE FROM public.items WHERE category_id = cat_id;
  DELETE FROM public.categories WHERE id IN (cat_id, new_cat);
  DELETE FROM auth.users WHERE id IN (admin_id, editor_id, viewer_id);
END $$;

-- Safety-net cleanup (in case the block above returned early)
DELETE FROM public.categories WHERE name LIKE 'ZZ %';
DELETE FROM auth.users WHERE email LIKE 'rlstest-%@zchema.test';

-- ── FINAL RESULT (what the editor displays) ─────────────────
SELECT n, status AS result, assertion, detail
FROM _p_test_results
ORDER BY n;

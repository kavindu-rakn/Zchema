-- ============================================================
-- Zchema — invitation tests
-- ------------------------------------------------------------
-- Built for the Supabase SQL editor: returns a PASS/FAIL table as its
-- FINAL statement.
--
-- Signing up is simulated the way GoTrue does it: insert the auth.users
-- row with the token in raw_user_meta_data, then confirm the address in
-- a second statement. Both triggers are the real ones.
--
-- The rule under test is the one that matters: the link alone is not a
-- role. It takes the link AND the invited address, confirmed.
--
-- NON-DESTRUCTIVE: fixed ids and @zchema.test addresses, cleaned before
-- and after.
-- Expected: 14 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _invite_results;
CREATE TEMP TABLE _invite_results (n int PRIMARY KEY, assertion text, status text, detail text);

-- Run SQL as `authenticated` with a given uid; first column as text.
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

-- Sign up exactly as GoTrue would, with an invite token in metadata.
CREATE OR REPLACE FUNCTION pg_temp._signup(p_id UUID, p_email TEXT, p_token TEXT)
RETURNS VOID LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, is_super_admin)
  VALUES ('00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
          p_email, '', NULL, now(), now(),
          '{"provider":"email","providers":["email"]}',
          CASE WHEN p_token IS NULL THEN '{}'::jsonb
               ELSE jsonb_build_object('invite_token', p_token) END,
          false);
END $fn$;

CREATE OR REPLACE FUNCTION pg_temp._forget()
RETURNS VOID LANGUAGE plpgsql AS $fn$
BEGIN
  DELETE FROM public.invitations WHERE email LIKE '%@zchema.test';
  DELETE FROM auth.users WHERE email LIKE '%invitetest%@zchema.test';
END $fn$;


DO $$
DECLARE
  admin_id   CONSTANT UUID := 'c0ffee00-0000-4000-8000-0000000000a1';
  editor_id  CONSTANT UUID := 'c0ffee00-0000-4000-8000-0000000000a2';
  joiner_id  CONSTANT UUID := 'c0ffee00-0000-4000-8000-0000000000a3';
  wrong_id   CONSTANT UUID := 'c0ffee00-0000-4000-8000-0000000000a4';
  expired_id CONSTANT UUID := 'c0ffee00-0000-4000-8000-0000000000a5';
  r        TEXT;
  invite   JSONB;
  token    TEXT;
  ok       BOOLEAN;
  n_open   INT;
BEGIN
  PERFORM pg_temp._forget();

  -- ── Fixture: an admin and an editor ───────────────────────
  PERFORM pg_temp._signup(admin_id, 'invitetest-admin@zchema.test', NULL);
  PERFORM pg_temp._signup(editor_id, 'invitetest-editor@zchema.test', NULL);
  UPDATE public.profiles SET role = 'SCHEMA_ADMIN' WHERE id = admin_id;
  UPDATE public.profiles SET role = 'DATA_EDITOR'  WHERE id = editor_id;

  -- ── 1. Only an admin can invite ───────────────────────────
  r := pg_temp._as(editor_id,
    'SELECT public.create_invitation(''nope@zchema.test'', ''VIEWER'')::text');
  INSERT INTO _invite_results VALUES (1, 'a DATA_EDITOR cannot invite',
    CASE WHEN r LIKE 'DENIED%SCHEMA_ADMIN%' THEN 'PASS' ELSE 'FAIL' END, left(r, 120));

  -- ── 2. An admin gets a token back, hashed in the table ────
  invite := pg_temp._as(admin_id,
    'SELECT public.create_invitation(''invitetest-joiner@zchema.test'', ''DATA_EDITOR'')::text')::jsonb;
  token := invite->>'token';
  SELECT i.token_hash = encode(sha256(token::bytea), 'hex') AND i.role = 'DATA_EDITOR'
         AND i.email = 'invitetest-joiner@zchema.test' AND i.invited_by = admin_id
    INTO ok
  FROM public.invitations i WHERE i.email = 'invitetest-joiner@zchema.test';
  INSERT INTO _invite_results VALUES (2, 'create_invitation returns a token and stores only its hash',
    CASE WHEN COALESCE(ok, false) AND length(token) = 64 THEN 'PASS' ELSE 'FAIL' END,
    left(invite::text, 80));

  -- ── 3. Rubbish in, refusal out ────────────────────────────
  ok := pg_temp._as(admin_id, 'SELECT public.create_invitation(''not-an-email'', ''VIEWER'')::text')
          LIKE '%does not look like an email%'
    AND pg_temp._as(admin_id, 'SELECT public.create_invitation(''x@zchema.test'', ''ADMIN'')::text')
          LIKE '%Pick a role%'
    AND pg_temp._as(admin_id,
          'SELECT public.create_invitation(''invitetest-editor@zchema.test'', ''VIEWER'')::text')
          LIKE '%already has an account%';
  INSERT INTO _invite_results VALUES (3, 'a bad address, a bad role and an existing account are refused',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 4. A second invitation replaces the first ─────────────
  PERFORM pg_temp._as(admin_id,
    'SELECT public.create_invitation(''invitetest-joiner@zchema.test'', ''VIEWER'')::text');
  SELECT count(*) INTO n_open FROM public.invitations
   WHERE email = 'invitetest-joiner@zchema.test' AND accepted_at IS NULL;
  INSERT INTO _invite_results VALUES (4, 'inviting the same address again leaves one open invitation',
    CASE WHEN n_open = 1 THEN 'PASS' ELSE 'FAIL' END, format('%s open', n_open));

  -- Back to the role under test, with a fresh link.
  DELETE FROM public.invitations WHERE email = 'invitetest-joiner@zchema.test';
  invite := pg_temp._as(admin_id,
    'SELECT public.create_invitation(''invitetest-joiner@zchema.test'', ''DATA_EDITOR'')::text')::jsonb;
  token := invite->>'token';

  -- ── 5. Signing up unconfirmed grants nothing yet ──────────
  PERFORM pg_temp._signup(joiner_id, 'invitetest-joiner@zchema.test', token);
  SELECT (SELECT role FROM public.profiles WHERE id = joiner_id) = 'VIEWER'
     AND (SELECT accepted_at IS NULL FROM public.invitations
          WHERE email = 'invitetest-joiner@zchema.test')
    INTO ok;
  INSERT INTO _invite_results VALUES (5, 'an unconfirmed signup holds no role, and the invitation stays open',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 6. Confirming the address grants the invited role ─────
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = joiner_id;
  SELECT (SELECT role FROM public.profiles WHERE id = joiner_id) = 'DATA_EDITOR'
     AND (SELECT accepted_at IS NOT NULL AND accepted_by = joiner_id
          FROM public.invitations WHERE email = 'invitetest-joiner@zchema.test')
    INTO ok;
  INSERT INTO _invite_results VALUES (6, 'confirming the address grants the invited role and spends the invitation',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT role FROM public.profiles WHERE id = joiner_id));

  -- ── 7. A spent invitation cannot be used twice ────────────
  UPDATE public.profiles SET role = 'VIEWER' WHERE id = joiner_id;
  PERFORM public.claim_invitation(joiner_id);
  INSERT INTO _invite_results VALUES (7, 'an accepted invitation grants nothing a second time',
    CASE WHEN (SELECT role FROM public.profiles WHERE id = joiner_id) = 'VIEWER'
         THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 8. The link is bound to the invited address ───────────
  invite := pg_temp._as(admin_id,
    'SELECT public.create_invitation(''invitetest-bound@zchema.test'', ''SCHEMA_ADMIN'')::text')::jsonb;
  PERFORM pg_temp._signup(wrong_id, 'invitetest-someoneelse@zchema.test', invite->>'token');
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = wrong_id;
  SELECT (SELECT role FROM public.profiles WHERE id = wrong_id) = 'VIEWER'
     AND (SELECT accepted_at IS NULL FROM public.invitations
          WHERE email = 'invitetest-bound@zchema.test')
    INTO ok;
  INSERT INTO _invite_results VALUES (8, 'the same link used by another address grants nothing',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END,
    (SELECT role FROM public.profiles WHERE id = wrong_id));

  -- ── 9. An expired invitation grants nothing ───────────────
  invite := pg_temp._as(admin_id,
    'SELECT public.create_invitation(''invitetest-late@zchema.test'', ''SCHEMA_ADMIN'')::text')::jsonb;
  UPDATE public.invitations SET expires_at = now() - INTERVAL '1 day'
   WHERE email = 'invitetest-late@zchema.test';
  PERFORM pg_temp._signup(expired_id, 'invitetest-late@zchema.test', invite->>'token');
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = expired_id;
  INSERT INTO _invite_results VALUES (9, 'an expired invitation grants nothing',
    CASE WHEN (SELECT role FROM public.profiles WHERE id = expired_id) = 'VIEWER'
         THEN 'PASS' ELSE 'FAIL' END,
    (SELECT role FROM public.profiles WHERE id = expired_id));

  -- ── 10. A made-up token grants nothing ────────────────────
  UPDATE auth.users
     SET raw_user_meta_data = jsonb_build_object('invite_token', repeat('f', 64))
   WHERE id = expired_id;
  PERFORM public.claim_invitation(expired_id);
  INSERT INTO _invite_results VALUES (10, 'an invented token grants nothing',
    CASE WHEN (SELECT role FROM public.profiles WHERE id = expired_id) = 'VIEWER'
         THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 11. Listing: admins only, and never the hash ──────────
  r := pg_temp._as(editor_id, 'SELECT public.list_invitations()::text');
  ok := r LIKE 'DENIED%';
  r := pg_temp._as(admin_id, 'SELECT public.list_invitations()::text');
  ok := ok AND r NOT LIKE '%token_hash%' AND r LIKE '%invitetest-joiner@zchema.test%';
  INSERT INTO _invite_results VALUES (11, 'only an admin lists invitations, and the hash is never returned',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 12. Status reads as open / accepted / expired ─────────
  SELECT bool_and(expected = actual) INTO ok FROM (
    SELECT 'accepted' AS expected, e->>'status' AS actual
    FROM jsonb_array_elements(r::jsonb) e WHERE e->>'email' = 'invitetest-joiner@zchema.test'
    UNION ALL
    SELECT 'expired', e->>'status'
    FROM jsonb_array_elements(r::jsonb) e WHERE e->>'email' = 'invitetest-late@zchema.test'
    UNION ALL
    SELECT 'open', e->>'status'
    FROM jsonb_array_elements(r::jsonb) e WHERE e->>'email' = 'invitetest-bound@zchema.test'
  ) checks;
  INSERT INTO _invite_results VALUES (12, 'each invitation reports open, accepted or expired',
    CASE WHEN COALESCE(ok, false) THEN 'PASS' ELSE 'FAIL' END, NULL);

  -- ── 13. Revoking: admins only, and it stops the link ──────
  ok := pg_temp._as(editor_id, format('SELECT public.revoke_invitation(%L)::text',
          (SELECT id FROM public.invitations WHERE email = 'invitetest-bound@zchema.test'))) LIKE 'DENIED%';
  r := pg_temp._as(admin_id, format('SELECT public.revoke_invitation(%L)::text',
          (SELECT id FROM public.invitations WHERE email = 'invitetest-bound@zchema.test')));
  ok := ok AND NOT EXISTS (SELECT 1 FROM public.invitations WHERE email = 'invitetest-bound@zchema.test');
  INSERT INTO _invite_results VALUES (13, 'only an admin revokes, and the invitation is then gone',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, left(r, 80));

  -- ── 14. No client touches the table or claim_invitation ───
  ok := NOT has_table_privilege('authenticated', 'public.invitations', 'SELECT')
    AND NOT has_table_privilege('anon', 'public.invitations', 'SELECT')
    AND NOT has_function_privilege('authenticated', 'public.claim_invitation(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.create_invitation(text, text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.list_invitations()', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.revoke_invitation(uuid)', 'EXECUTE');
  INSERT INTO _invite_results VALUES (14, 'no client privilege on invitations, and claim_invitation is trigger-only',
    CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, NULL);

  PERFORM pg_temp._forget();
END $$;

SELECT n, status, assertion, detail FROM _invite_results ORDER BY n;

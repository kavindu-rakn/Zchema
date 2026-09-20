-- ============================================================
-- Zchema — Invitations: how a teammate gets in, with a role
-- Run AFTER trash.sql (load order: … → onboarding → trash → invites).
--
-- Joining used to mean finding the signup page unaided, then waiting
-- for an admin to notice and change your role. An invitation names the
-- role up front and travels as a link:
--
--   1. An admin calls create_invitation(email, role). It returns the
--      token ONCE; only its SHA-256 is stored, so nobody — including
--      anyone who can read the table — can reconstruct a working link.
--   2. The admin sends /signup?invite=<token>. Zchema sends no mail of
--      its own; the link goes by whatever the team already uses.
--   3. Signing up puts the token in the account's metadata.
--   4. claim_invitation() grants the role WHEN THE ADDRESS IS
--      CONFIRMED (schema.sql §9c) — never merely because someone typed
--      that address into the form. A leaked link on its own is not a
--      role: it also takes the mailbox.
--
-- PRIVILEGE: as in trash.sql, the admin-facing functions are SECURITY
-- DEFINER because clients hold nothing on public.invitations, and
-- EXECUTE is revoked from anon so require_schema_admin()'s no-JWT
-- branch cannot be reached through them.
-- ============================================================


-- ============================================================
-- 1. claim_invitation(user) → TEXT (the role granted, or NULL)
-- ------------------------------------------------------------
-- Internal: called by the auth.users triggers, never by a client.
-- Silent about failure by design — a signup must not become a way to
-- test whether an invitation exists.
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_invitation(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  account RECORD;
  invite  RECORD;
  token   TEXT;
BEGIN
  SELECT u.id, u.email, u.email_confirmed_at, u.raw_user_meta_data
    INTO account
  FROM auth.users u WHERE u.id = p_user_id;

  -- No confirmed address, no role.
  IF NOT FOUND OR account.email_confirmed_at IS NULL THEN
    RETURN NULL;
  END IF;

  token := NULLIF(btrim(COALESCE(account.raw_user_meta_data->>'invite_token', '')), '');
  IF token IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT i.* INTO invite
  FROM public.invitations i
  WHERE i.token_hash = encode(sha256(token::bytea), 'hex')
    AND i.accepted_at IS NULL
    AND i.expires_at > now()
    AND i.email = lower(account.email)
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE public.invitations
     SET accepted_at = now(), accepted_by = account.id
   WHERE id = invite.id;

  -- protect_role_update() allows this: it runs as the owner here, not
  -- as a client (see schema.sql §10).
  UPDATE public.profiles SET role = invite.role WHERE id = account.id;

  RETURN invite.role;
END;
$$;


-- ============================================================
-- 2. create_invitation(email, role) → { id, email, role, token, … }
-- ------------------------------------------------------------
-- The token is returned once, here, and never again.
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_invitation(p_email TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_email TEXT := lower(btrim(COALESCE(p_email, '')));
  v_token TEXT;
  invite  RECORD;
BEGIN
  BEGIN
    PERFORM public.require_schema_admin();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Only a SCHEMA_ADMIN can invite people.';
  END;

  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION '“%” does not look like an email address.', p_email;
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('SCHEMA_ADMIN', 'DATA_EDITOR', 'VIEWER') THEN
    RAISE EXCEPTION 'Pick a role: SCHEMA_ADMIN, DATA_EDITOR or VIEWER.';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION '% already has an account. Change their role in the users table instead.', v_email;
  END IF;

  -- A fresh link replaces any open one for this address, so there is
  -- never more than one way in.
  DELETE FROM public.invitations i WHERE i.email = v_email AND i.accepted_at IS NULL;

  -- 244 bits from two v4 UUIDs: unguessable, and no extension needed.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.invitations (email, role, token_hash, invited_by)
  VALUES (v_email, p_role, encode(sha256(v_token::bytea), 'hex'), auth.uid())
  RETURNING * INTO invite;

  RETURN jsonb_build_object(
    'id',         invite.id,
    'email',      invite.email,
    'role',       invite.role,
    'token',      v_token,
    'expires_at', invite.expires_at
  );
END;
$$;


-- ============================================================
-- 3. list_invitations() → JSONB array, newest first
-- ------------------------------------------------------------
-- Never returns token_hash: there is nothing a caller could do with it,
-- and no reason to hand it out.
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_invitations()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    PERFORM public.require_schema_admin();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Only a SCHEMA_ADMIN can see invitations.';
  END;

  RETURN COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'id',          i.id,
        'email',       i.email,
        'role',        i.role,
        'created_at',  i.created_at,
        'expires_at',  i.expires_at,
        'accepted_at', i.accepted_at,
        'invited_by',  public.member_email(i.invited_by),
        'status',      CASE
                         WHEN i.accepted_at IS NOT NULL THEN 'accepted'
                         WHEN i.expires_at <= now()     THEN 'expired'
                         ELSE 'open'
                       END
      ) ORDER BY i.created_at DESC
    )
    FROM public.invitations i
  ), '[]'::jsonb);
END;
$$;


-- ============================================================
-- 4. revoke_invitation(id) → { revoked }
-- ------------------------------------------------------------
-- Makes the link stop working. An accepted one is history and stays.
-- ============================================================
CREATE OR REPLACE FUNCTION public.revoke_invitation(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  n INT;
BEGIN
  BEGIN
    PERFORM public.require_schema_admin();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Only a SCHEMA_ADMIN can revoke an invitation.';
  END;

  DELETE FROM public.invitations WHERE id = p_id AND accepted_at IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'That invitation is already gone — revoked, or accepted.';
  END IF;

  RETURN jsonb_build_object('revoked', n);
END;
$$;


-- ============================================================
-- 5. Grants
-- ------------------------------------------------------------
-- claim_invitation() is trigger-only; the rest are for signed-in
-- admins, and the role check inside is what enforces that.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.claim_invitation(UUID)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_invitation(TEXT, TEXT)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_invitations()              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_invitation(UUID)         FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_invitation(TEXT, TEXT)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_invitations()               TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_invitation(UUID)          TO authenticated;

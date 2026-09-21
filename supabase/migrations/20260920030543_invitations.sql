-- ============================================================
-- Invitations: join with a role, from a link
-- ------------------------------------------------------------
-- Joining meant finding the signup page unaided, then waiting for an
-- admin to notice and change your role. An invitation names the role up
-- front and travels as a link.
--
-- public.invitations stores only the SHA-256 of each link's token, and
-- clients hold nothing on the table: create_invitation(),
-- list_invitations() and revoke_invitation() are the way in, all
-- SCHEMA_ADMIN only. claim_invitation() grants the role when GoTrue
-- CONFIRMS the invited address (the new trigger on auth.users), so a
-- leaked link on its own is not a role — it also takes the mailbox.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.invitations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  role        TEXT NOT NULL
              CHECK (role IN ('SCHEMA_ADMIN', 'DATA_EDITOR', 'VIEWER')),
  token_hash  TEXT NOT NULL,
  invited_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_open_invitation
  ON public.invitations (email) WHERE accepted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_invitations_token ON public.invitations (token_hash);

ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitations FROM anon, authenticated;

-- ── The functions (supabase/invites.sql) ───────────────────
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

-- ── Signup claims an invitation, confirmation grants it (schema.sql) ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  -- Serialise the bootstrap check. Without the lock two signups racing
  -- on an empty instance could both observe "nobody else yet" and both
  -- become admin. Transaction-scoped; released automatically. Under
  -- READ COMMITTED the check below takes a fresh snapshot after the lock
  -- is granted, so the loser of the race sees the winner's row.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('zchema_bootstrap_admin')
  );
  -- AFTER INSERT: NEW is already in auth.users, so look for anyone else.
  is_first_user := NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id <> NEW.id
  );

  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE WHEN is_first_user THEN 'SCHEMA_ADMIN' ELSE 'VIEWER' END
  );

  -- An invited signup gets the role its invitation names — but only
  -- once the address is confirmed, which is usually later, on the
  -- UPDATE that sets email_confirmed_at (§9c). This call covers the
  -- case where it is already confirmed at insert, i.e. a project with
  -- email confirmation switched off. Never for the first user: they
  -- are the admin regardless.
  IF NOT is_first_user THEN
    PERFORM public.claim_invitation(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_user_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.claim_invitation(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_user_confirmed();

REVOKE EXECUTE ON FUNCTION public.handle_new_user()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_user_confirmed() FROM PUBLIC, anon, authenticated;

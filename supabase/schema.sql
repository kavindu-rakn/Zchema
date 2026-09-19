-- ============================================================
-- Zchema — Database Schema (Phase 1: schema composition)
-- Run this in the Supabase SQL Editor (or via supabase db push).
--
-- MODEL: schema lives on the CATEGORY node and is composed down
-- the tree. A category owns `own_fields` and may `override` fields
-- it inherits from ancestors. Blueprints (formerly templates) are
-- demoted to optional starter presets — no live link.
--
-- Load order: schema → functions → triggers → policies → impact →
-- attributes → search → import → onboarding.
--
-- This file is the readable source of truth for the tables; what a
-- database actually runs is supabase/migrations/ (see AGENTS.md).
-- It is safe to re-run: tables and indexes are IF NOT EXISTS, and it
-- never drops anything. A CREATE TABLE IF NOT EXISTS does not reshape
-- a table that already exists, so a column change needs a migration.
-- ============================================================

-- The destructive rebuild that used to open this file now lives in
-- supabase/dev/reset.sql, where running it has to be deliberate. With
-- it here, re-applying the schema to a live database wiped every row.


-- ============================================================
-- 1. Profiles
-- ------------------------------------------------------------
-- Mirrors auth.users with an application-level role.
-- New role vocabulary: "template admin" no longer makes sense
-- once templates are demoted to optional blueprints.
--   SCHEMA_ADMIN  (was TEMPLATE_ADMIN)
--   DATA_EDITOR   (was DATA_CONTRIBUTOR)
--   VIEWER        (unchanged)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'VIEWER'
             CHECK (role IN ('SCHEMA_ADMIN', 'DATA_EDITOR', 'VIEWER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 2. Blueprints (was `templates`)
-- ------------------------------------------------------------
-- Optional starter presets. Applying a blueprint COPIES its
-- fields into a category's own_fields; there is no live link.
-- `fields` is a JSONB array of SchemaField objects.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.blueprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 3. Categories — now own their schema
-- ------------------------------------------------------------
-- Hierarchical tree (parent_id references self).
--   own_fields : JSONB array of SchemaField authored on THIS node.
--   overrides  : JSONB object keyed by inherited field key, each
--                value a FieldOverride patch (label/required/
--                options/default/help_text/position only).
--   blueprint_id : provenance only (nullable, SET NULL on delete).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  parent_id    UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  blueprint_id UUID REFERENCES public.blueprints(id) ON DELETE SET NULL,
  own_fields   JSONB NOT NULL DEFAULT '[]'::jsonb,
  overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon         TEXT,
  color        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 4. Items — gain `schema_version`
-- ------------------------------------------------------------
-- Dynamic item data stored as JSONB keyed to the category's
-- effective schema. `data` may contain a `__orphaned` sub-object
-- holding values whose field has since disappeared.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 5. Schema Versions — immutable audit trail
-- ------------------------------------------------------------
-- Populated in Phase 5. The table exists now so the FK graph is
-- stable. Append-only (no UPDATE/DELETE RLS policy — Increment 4).
--
-- `snapshot`  — the EFFECTIVE schema at this version (EffectiveField[]),
--               what the history diff renders.
-- `authored`  — the AUTHORED state that produced it:
--               { own_fields: SchemaField[], overrides: {…} }.
--               Phase 5 addition. Rollback needs this: own_fields can be
--               recovered from `snapshot`, but a category's `overrides`
--               cannot — the snapshot only records the post-patch value,
--               not which properties the patch carried. Storing the
--               authored state makes rollback exact instead of lossy.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.schema_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  snapshot       JSONB NOT NULL,
  authored       JSONB NOT NULL DEFAULT '{}'::jsonb,
  change_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, version)
);


-- ============================================================
-- 6. Attributes — reusable field registry
-- ------------------------------------------------------------
-- Populated in Phase 6. The table exists now so the FK graph is
-- stable and SchemaField.attribute_id has a target.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.attributes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,
  unit        TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================
-- 7. Indexes
-- ============================================================
-- GIN index for fast JSONB containment / key-exists queries on items.
CREATE INDEX IF NOT EXISTS idx_items_data_gin ON public.items USING gin (data);

-- Hierarchical category lookups.
CREATE INDEX IF NOT EXISTS idx_categories_parent ON public.categories (parent_id);

-- Category → blueprint provenance joins.
CREATE INDEX IF NOT EXISTS idx_categories_blueprint ON public.categories (blueprint_id);

-- Item → category joins, and the Items tab's default page: one
-- category, newest first, with i.id as the tiebreaker query_items sorts
-- by. The index returns rows already in that order, so a page is a
-- short index walk instead of sorting the whole category — measured at
-- 29 ms → 6 ms per page on a 20,000-item category. It also serves every
-- lookup by category_id alone, which is why the old single-column index
-- it replaces is dropped.
CREATE INDEX IF NOT EXISTS idx_items_category_created
  ON public.items (category_id, created_at DESC, id);
DROP INDEX IF EXISTS public.idx_items_category;

-- Slug uniqueness: unique within a parent, and unique among roots.
CREATE UNIQUE INDEX IF NOT EXISTS unique_category_slug_parent
  ON public.categories (parent_id, slug) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_category_slug_root
  ON public.categories (slug) WHERE parent_id IS NULL;

-- GIN index over own_fields for field-key lookups.
CREATE INDEX IF NOT EXISTS idx_categories_own_fields ON public.categories USING gin (own_fields);

-- Schema version history lookups, newest first.
CREATE INDEX IF NOT EXISTS idx_schema_versions_category
  ON public.schema_versions (category_id, version DESC);


-- ============================================================
-- 8. updated_at triggers
-- ------------------------------------------------------------
-- search_path is pinned here as on every other function in the project.
-- now() still resolves: pg_catalog is always searched, even when the
-- path is empty.
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

DROP TRIGGER IF EXISTS update_profiles_modtime        ON public.profiles;
DROP TRIGGER IF EXISTS update_blueprints_modtime      ON public.blueprints;
DROP TRIGGER IF EXISTS update_categories_modtime      ON public.categories;
DROP TRIGGER IF EXISTS update_items_modtime           ON public.items;
DROP TRIGGER IF EXISTS update_attributes_modtime      ON public.attributes;

CREATE TRIGGER update_profiles_modtime   BEFORE UPDATE ON public.profiles   FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_blueprints_modtime BEFORE UPDATE ON public.blueprints FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_categories_modtime BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_items_modtime      BEFORE UPDATE ON public.items      FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_attributes_modtime BEFORE UPDATE ON public.attributes FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
-- NB: schema_versions is append-only; it has no updated_at column and no modtime trigger.


-- ============================================================
-- 9. Auto-create profile on signup
-- ------------------------------------------------------------
-- The FIRST account on a fresh instance becomes SCHEMA_ADMIN, so a new
-- deployment is usable without hand-editing the database. Every account
-- after it starts as VIEWER and is promoted from Settings.
--
-- This replaces a hardcoded `admin@zchema.com` / `editor@zchema.com`
-- email match, which granted SCHEMA_ADMIN to whoever registered an
-- address nobody owns — and re-opened that window on every rebuild.
--
-- "First" is judged against auth.users, NEVER against profiles. The
-- two can disagree: this file drops and recreates `profiles`, which
-- empties it while every account survives in auth.users. Keyed on
-- profiles, a re-run would make the next stranger to sign up the admin
-- of an instance that already has users. (That happened on 2026-09-18
-- — see the backfill in §9b below, which exists for the same reason.)
-- ============================================================
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 9b. Backfill profiles for accounts that already exist
-- ------------------------------------------------------------
-- handle_new_user() only fires when an auth.users row is INSERTED, but
-- supabase/dev/reset.sql drops `profiles` while every account survives
-- in auth.users. Rebuilding after a reset would otherwise leave each of
-- them with no profile: no role, and every requireProfile() call failing.
--
-- Recreate the missing rows by the bootstrap rule — if no SCHEMA_ADMIN
-- exists, the oldest account becomes one; everyone else is VIEWER.
-- Earlier role assignments cannot be recovered (they lived in the table
-- that was dropped), so re-promote from Settings → Users.
-- A no-op on a fresh project, and on any project whose profiles are
-- intact.
-- ============================================================
INSERT INTO public.profiles (id, email, role)
SELECT
  u.id,
  u.email,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE role = 'SCHEMA_ADMIN')
     AND u.id = (SELECT id FROM auth.users ORDER BY created_at, id LIMIT 1)
    THEN 'SCHEMA_ADMIN'
    ELSE 'VIEWER'
  END
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id);


-- ============================================================
-- 10. Role protection — UPDATE *and* INSERT
-- ------------------------------------------------------------
-- Only a SCHEMA_ADMIN may set or change a profile's role.
--
-- Both paths are guarded, and the pairing is load-bearing. Guarding
-- UPDATE alone left a full escalation open: a VIEWER could DELETE their
-- own profile row and re-INSERT it with role 'SCHEMA_ADMIN', because no
-- trigger fired on INSERT. Since requireSchemaAdmin() and every RLS
-- policy read this table, that handed out the whole application.
-- policies.sql §3 now also withholds INSERT/DELETE on profiles from
-- `authenticated`, so this is the second of two layers, not the only one.
--
-- Note `IS DISTINCT FROM` rather than `<>` when reading the caller's
-- role: if it comes back NULL (no auth.uid(), or a profile mid-deletion)
-- then `<>` yields NULL, the IF is not taken, and the guard fails OPEN.
--
-- A NULL auth.uid() means there is no JWT, and that has two meanings.
-- From the SQL editor, a migration or the service role it is the table
-- owner — trusted, and the only way an operator can promote anyone by
-- hand (seed.sql §4, the RLS test suite). From the API roles it is an
-- unauthenticated caller — never trusted. Told apart by `current_user`,
-- exactly as require_schema_admin() in impact.sql does.
--
-- That is why both functions are SECURITY INVOKER. Inside a DEFINER
-- function `current_user` is always the owner, so the check above would
-- be blind. Nothing here needs elevated rights: the caller's role comes
-- from get_user_role(), which is itself DEFINER precisely so that it can
-- read `profiles` past RLS.
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.uid() IS NULL THEN
      IF current_user IN ('anon', 'authenticated') THEN
        RAISE EXCEPTION 'Only SCHEMA_ADMIN can change roles';
      END IF;
      RETURN NEW;  -- owner / service_role / SQL editor
    END IF;

    IF public.get_user_role() IS DISTINCT FROM 'SCHEMA_ADMIN' THEN
      RAISE EXCEPTION 'Only SCHEMA_ADMIN can change roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_role_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    -- No JWT. The legitimate case is handle_new_user(): it is DEFINER, so
    -- the insert it makes — and this trigger, fired inside it — run as
    -- the owner, and the bootstrap SCHEMA_ADMIN row is allowed through.
    -- anon and authenticated hold no INSERT grant on profiles, so they
    -- should never reach here; refuse them anyway rather than rely on it.
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Only SCHEMA_ADMIN can assign a role other than VIEWER';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM 'VIEWER'
     AND public.get_user_role() IS DISTINCT FROM 'SCHEMA_ADMIN' THEN
    RAISE EXCEPTION 'Only SCHEMA_ADMIN can assign a role other than VIEWER';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_role_protection ON public.profiles;
CREATE TRIGGER ensure_role_protection
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_role_update();

DROP TRIGGER IF EXISTS ensure_role_protection_insert ON public.profiles;
CREATE TRIGGER ensure_role_protection_insert
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_role_insert();

-- Postgres grants EXECUTE on every new function to PUBLIC, so each of
-- these trigger functions was exposed as /rest/v1/rpc/<name> to anon and
-- authenticated — and handle_new_user() is SECURITY DEFINER, which the
-- Supabase security advisor flags. Calling a trigger function outside a
-- trigger fails, so none of this was exploitable, but there is no reason
-- to offer any of it on the public API.
-- Revoking EXECUTE does NOT stop the triggers from firing: the privilege
-- is checked at CREATE TRIGGER time, not each time a trigger fires.
-- (Verified against the live project on 2026-09-18 before relying on it:
-- with EXECUTE revoked from `authenticated`, an insert by `authenticated`
-- still fired the trigger. Getting this wrong would break every signup.)
REVOKE EXECUTE ON FUNCTION public.handle_new_user()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_role_update() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_role_insert() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 11. Cycle guard — a category must not become its own ancestor
-- ------------------------------------------------------------
-- Walks parent_id upward on INSERT / UPDATE OF parent_id and
-- rejects any move that would place a node under its own descendant.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_category_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  cur UUID := NEW.parent_id;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Cannot move category "%" under its own descendant', NEW.name;
    END IF;
    SELECT parent_id INTO cur FROM public.categories WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categories_no_cycle ON public.categories;
CREATE TRIGGER categories_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.prevent_category_cycle();


-- ============================================================
-- End of schema.sql
-- ------------------------------------------------------------
-- Resolver functions (get_effective_schema, get_category_tree, …)
-- live in functions.sql (Increment 2), sourced AFTER this file.
-- Integrity/validation triggers (Increment 3) and RLS policies
-- (Increment 4) are added in their own increments.
-- ============================================================

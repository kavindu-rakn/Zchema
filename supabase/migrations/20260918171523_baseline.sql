-- ============================================================
-- Baseline migration
-- ------------------------------------------------------------
-- The whole schema as of 2026-09-18: the nine supabase/*.sql files,
-- concatenated in load order and otherwise unchanged. A fresh project
-- gets everything from this one file (`npx supabase db push`).
--
-- On the original production project this migration was recorded as
-- applied rather than re-run: that database had already been built
-- from those files, and every function body in it was verified
-- checksum-identical to the repository on the same day.
--
-- Never edit this file. Change the feature file you mean to change,
-- then add a new migration carrying the same change — the drift test
-- (supabase/migrations.test.ts) fails when the two disagree.
-- ============================================================


-- ████████████████████████████████████████████████████████████
-- ██  supabase/schema.sql
-- ████████████████████████████████████████████████████████████

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

-- Item → category joins.
CREATE INDEX IF NOT EXISTS idx_items_category ON public.items (category_id);

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


-- ████████████████████████████████████████████████████████████
-- ██  supabase/functions.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Schema Resolver Functions (Phase 1, Increment 2)
-- Source this AFTER schema.sql.
--
-- These functions are the CONTRACT every later phase reads from.
-- The client-side mirror in src/lib/schema.ts (Increment 5) must
-- reproduce get_effective_schema()'s algorithm exactly.
-- ============================================================


-- ============================================================
-- 1. get_category_ancestors(p_category_id)
-- ------------------------------------------------------------
-- Recursive CTE walking UPWARD from the target category.
--   depth = 0  → the target itself
--   depth = 1  → its parent, and so on toward the root
-- Result is ordered ROOT-FIRST (depth DESC) so callers can fold
-- fields in inheritance order.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_ancestors(p_category_id UUID)
RETURNS TABLE(id UUID, name TEXT, own_fields JSONB, overrides JSONB, depth INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE chain AS (
    SELECT c.id, c.name, c.own_fields, c.overrides, c.parent_id, 0 AS depth
    FROM public.categories c
    WHERE c.id = p_category_id
    UNION ALL
    SELECT c.id, c.name, c.own_fields, c.overrides, c.parent_id, ch.depth + 1
    FROM public.categories c
    JOIN chain ch ON c.id = ch.parent_id
  )
  SELECT chain.id, chain.name, chain.own_fields, chain.overrides, chain.depth
  FROM chain
  ORDER BY chain.depth DESC;
$$;


-- ============================================================
-- 2. get_effective_schema(p_category_id)  → JSONB[]  (EffectiveField[])
-- ------------------------------------------------------------
-- Folds own_fields down the ancestor chain and applies overrides.
-- MUST agree, key-for-key, with resolveEffectiveSchema() in
-- src/lib/schema.ts. Keep the algorithm comments identical.
--
-- Algorithm:
--   1. Empty ordered accumulator.
--   2. Root → target: append every own_field, stamped with source
--      + depth + inherited + overridden_by=[]. Skip a key already
--      accumulated (duplicates are trigger-prevented, but never throw).
--   3. Root → target again: apply each ancestor's overrides to the
--      matching accumulated field. Only label/required/options/
--      default/help_text/position are patchable; append the patching
--      category id to overridden_by.
--   4. Sort by (depth DESC, position ASC, label ASC).
--   5. Return a JSONB array of EffectiveField.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_schema(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anc      RECORD;
  fld      JSONB;
  acc      JSONB := '[]'::jsonb;               -- ordered accumulator
  seen     TEXT[] := ARRAY[]::TEXT[];          -- keys already accumulated
  k        TEXT;
  o_key    TEXT;                               -- override target key
  o_patch  JSONB;                              -- override patch object
  p_key    TEXT;                               -- patch property key
  p_val    JSONB;                              -- patch property value
  idx      INT;
  cur      JSONB;
  patched  JSONB;
  allowed  TEXT[] := ARRAY['label','required','options','default','help_text','position'];
BEGIN
  -- ── Pass 1: fold own_fields, root → target ─────────────────
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    IF jsonb_typeof(COALESCE(anc.own_fields, '[]'::jsonb)) <> 'array' THEN
      CONTINUE;
    END IF;
    FOR fld IN SELECT value FROM jsonb_array_elements(anc.own_fields)
    LOOP
      k := fld->>'key';
      IF k IS NULL THEN CONTINUE; END IF;
      IF k = ANY(seen) THEN CONTINUE; END IF;   -- duplicate: skip, never throw
      seen := array_append(seen, k);
      acc := acc || jsonb_build_array(
        fld
        || jsonb_build_object(
             'source_category_id',   anc.id,
             'source_category_name', anc.name,
             'depth',                anc.depth,
             'inherited',            anc.depth > 0,
             'overridden_by',        '[]'::jsonb
           )
      );
    END LOOP;
  END LOOP;

  -- ── Pass 2: apply overrides, root → target ─────────────────
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    IF jsonb_typeof(COALESCE(anc.overrides, '{}'::jsonb)) <> 'object' THEN
      CONTINUE;
    END IF;
    FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(anc.overrides)
    LOOP
      FOR idx IN 0 .. jsonb_array_length(acc) - 1
      LOOP
        cur := acc->idx;
        IF cur->>'key' = o_key THEN
          patched := cur;
          FOR p_key, p_val IN SELECT key, value FROM jsonb_each(o_patch)
          LOOP
            IF p_key = ANY(allowed) THEN
              patched := patched || jsonb_build_object(p_key, p_val);
            END IF;
          END LOOP;
          patched := jsonb_set(
            patched, '{overridden_by}',
            COALESCE(patched->'overridden_by', '[]'::jsonb) || to_jsonb(anc.id)
          );
          acc := jsonb_set(acc, ARRAY[idx::text], patched);
          EXIT;  -- one field per key; stop scanning
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ── Pass 3: sort (depth DESC, position ASC, label ASC) ─────
  SELECT COALESCE(
           jsonb_agg(e ORDER BY (e->>'depth')::int DESC,
                                COALESCE((e->>'position')::numeric, 0) ASC,
                                COALESCE(e->>'label', '') ASC),
           '[]'::jsonb)
    INTO acc
  FROM jsonb_array_elements(acc) e;

  RETURN acc;
END;
$$;


-- ============================================================
-- 3. get_category_subtree(p_category_id)
-- ------------------------------------------------------------
-- Recursive CTE walking DOWNWARD, INCLUDING the target (depth 0).
-- Used everywhere "and all its descendants" is needed.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_subtree(p_category_id UUID)
RETURNS TABLE(id UUID, depth INT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH RECURSIVE sub AS (
    SELECT c.id, 0 AS depth
    FROM public.categories c
    WHERE c.id = p_category_id
    UNION ALL
    SELECT c.id, s.depth + 1
    FROM public.categories c
    JOIN sub s ON c.parent_id = s.id
  )
  SELECT sub.id, sub.depth FROM sub;
$$;


-- ============================================================
-- 4. count_subtree_items(p_category_id)
-- ------------------------------------------------------------
-- Count of items on the category and every descendant.
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_subtree_items(p_category_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM public.items
  WHERE category_id IN (SELECT s.id FROM public.get_category_subtree(p_category_id) s);
$$;


-- ============================================================
-- 5. get_category_tree()  → JSONB[]  (flat CategoryNode-ish list)
-- ------------------------------------------------------------
-- One call returning the whole tree with counts, so the UI never
-- N+1s. Returned FLAT; nesting is assembled client-side.
-- Each node carries the full category row PLUS the four counts, so the
-- payload satisfies the canonical CategoryNode type in src/lib/types.ts
-- without any partial-object casting, and Phase 3's schema editor gets
-- own_fields/overrides from the same single call.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_tree()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER 
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                    c.id,
        'name',                  c.name,
        'slug',                  c.slug,
        'description',           c.description,
        'parent_id',             c.parent_id,
        'blueprint_id',          c.blueprint_id,
        'own_fields',            c.own_fields,
        'overrides',             c.overrides,
        'icon',                  c.icon,
        'color',                 c.color,
        'position',              c.position,
        'created_at',            c.created_at,
        'updated_at',            c.updated_at,
        'own_field_count',       jsonb_array_length(COALESCE(c.own_fields, '[]'::jsonb)),
        'inherited_field_count', (
          SELECT count(*)::int
          FROM jsonb_array_elements(public.get_effective_schema(c.id)) e
          WHERE (e->>'inherited')::boolean
        ),
        'item_count',            (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id),
        'subtree_item_count',    public.count_subtree_items(c.id)
      )
      ORDER BY c.position ASC, c.name ASC
    ),
    '[]'::jsonb)
  FROM public.categories c;
$$;


-- ============================================================
-- 6. get_items_missing_required()  → JSONB[]
-- ------------------------------------------------------------
-- Categories holding items that are blank for a field the EFFECTIVE
-- schema marks required — including fields that only became required
-- through an inherited override.
--
-- Resolves the schema once PER CATEGORY (not per item): doing this in
-- the client would mean one round trip per category, and doing it
-- naively in SQL would call the resolver once per row.
--
-- Each node: category_id, category_name, missing_count.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_items_missing_required()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH required_by_category AS (
    SELECT c.id                        AS category_id,
           c.name                      AS category_name,
           array_agg(f.elem->>'key')   AS required_keys
    FROM public.categories c
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem)
    WHERE (f.elem->>'required')::boolean
    GROUP BY c.id, c.name
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.missing_count DESC), '[]'::jsonb)
  FROM (
    SELECT r.category_id,
           r.category_name,
           count(*)::int AS missing_count
    FROM required_by_category r
    JOIN public.items i ON i.category_id = r.category_id
    WHERE EXISTS (
      SELECT 1
      FROM unnest(r.required_keys) AS k
      WHERE NOT (i.data ? k)
         OR i.data->>k IS NULL
         OR btrim(i.data->>k) = ''
    )
    GROUP BY r.category_id, r.category_name
  ) x;
$$;


-- ============================================================
-- 7. query_items(...)  → JSONB { total, rows }
-- ------------------------------------------------------------
-- Server-side sort, filter and pagination for the items table.
--
-- WHY THIS IS SQL AND NOT A POSTGREST QUERY
-- Sorting `data->>'ram_gb'` as text puts 8 after 16. Correct ordering
-- needs a cast chosen by the field's type, which PostgREST cannot
-- express — and sorting only the current page is wrong anyway.
--
-- SAFETY: p_sort_key and every filter key are validated against the
-- field-key grammar before being interpolated, and all values go
-- through %L. A key that does not match is ignored rather than run.
--
-- p_filters is a JSONB array of:
--   { key, type, op, value, value2 }
--     op: contains | eq | in | range | bool | is_empty | not_empty
--
-- p_stale_before (Phase 5) filters on items.schema_version, a real
-- COLUMN rather than a key inside `data`, so it cannot be expressed as
-- one of the p_filters entries. It backs the History tab's
-- "12 items were written against v3 and older" link.
-- ============================================================

-- Adding a parameter to an existing function creates an OVERLOAD rather
-- than replacing it, and two candidates would make every PostgREST call
-- ambiguous. Drop the previous signature first.
DROP FUNCTION IF EXISTS public.query_items(UUID, BOOLEAN, TEXT, TEXT, TEXT, JSONB, INT, INT, TEXT);

CREATE OR REPLACE FUNCTION public.query_items(
  p_category_id     UUID,
  p_include_subtree BOOLEAN DEFAULT false,
  p_sort_key        TEXT    DEFAULT NULL,
  p_sort_type       TEXT    DEFAULT 'string',
  p_sort_dir        TEXT    DEFAULT 'asc',
  p_filters         JSONB   DEFAULT '[]'::jsonb,
  p_limit           INT     DEFAULT 50,
  p_offset          INT     DEFAULT 0,
  -- 'incomplete' | 'orphaned' | NULL. Drives the one-click health
  -- filters in the Items tab header strip.
  p_health          TEXT    DEFAULT NULL,
  -- Items written against a schema_version STRICTLY BELOW this.
  p_stale_before    INT     DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  key_re     CONSTANT TEXT := '^[a-z][a-z0-9_]*$';
  where_sql  TEXT := 'TRUE';
  order_sql  TEXT;
  dir        TEXT;
  flt        JSONB;
  fkey       TEXT;
  fop        TEXT;
  ftype      TEXT;
  fval       TEXT;
  fval2      TEXT;
  cast_expr    TEXT;
  scope_sql    TEXT;
  health_cte   TEXT := '';
  health_join  TEXT := '';
  health_where TEXT := '';
  total        INT;
  rows_json    JSONB;
BEGIN
  dir := CASE WHEN lower(COALESCE(p_sort_dir, 'asc')) = 'desc' THEN 'DESC' ELSE 'ASC' END;

  -- ── Scope: this category, or the whole subtree ────────────
  IF p_include_subtree THEN
    scope_sql := format(
      'i.category_id IN (SELECT s.id FROM public.get_category_subtree(%L::uuid) s)',
      p_category_id
    );
  ELSE
    scope_sql := format('i.category_id = %L::uuid', p_category_id);
  END IF;

  -- ── Filters ───────────────────────────────────────────────
  FOR flt IN SELECT value FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
  LOOP
    fkey  := flt->>'key';
    fop   := COALESCE(flt->>'op', 'contains');
    ftype := COALESCE(flt->>'type', 'string');
    fval  := flt->>'value';
    fval2 := flt->>'value2';

    CONTINUE WHEN fkey IS NULL OR fkey !~ key_re;

    IF fop = 'is_empty' THEN
      where_sql := where_sql || format(
        ' AND (NOT (i.data ? %L) OR i.data->>%L IS NULL OR btrim(i.data->>%L) = %L)',
        fkey, fkey, fkey, ''
      );

    ELSIF fop = 'not_empty' THEN
      where_sql := where_sql || format(
        ' AND (i.data ? %L AND i.data->>%L IS NOT NULL AND btrim(i.data->>%L) <> %L)',
        fkey, fkey, fkey, ''
      );

    ELSIF fval IS NULL OR fval = '' THEN
      CONTINUE;

    ELSIF fop = 'contains' THEN
      where_sql := where_sql || format(
        ' AND i.data->>%L ILIKE %L', fkey, '%' || fval || '%'
      );

    ELSIF fop = 'eq' THEN
      where_sql := where_sql || format(' AND i.data->>%L = %L', fkey, fval);

    ELSIF fop = 'bool' THEN
      where_sql := where_sql || format(
        ' AND (i.data->>%L)::boolean = %L::boolean', fkey, fval
      );

    ELSIF fop = 'in' THEN
      -- `value` is a comma-separated list of allowed values.
      where_sql := where_sql || format(
        ' AND i.data->>%L = ANY (string_to_array(%L, %L))', fkey, fval, ','
      );

    ELSIF fop = 'range' THEN
      -- Guard the cast: a non-numeric stray value would abort the query.
      where_sql := where_sql || format(
        ' AND (i.data->>%L) ~ %L', fkey, '^-?[0-9]+(\.[0-9]+)?$'
      );
      IF fval IS NOT NULL AND fval <> '' THEN
        where_sql := where_sql || format(
          ' AND (i.data->>%L)::numeric >= %L::numeric', fkey, fval
        );
      END IF;
      IF fval2 IS NOT NULL AND fval2 <> '' THEN
        where_sql := where_sql || format(
          ' AND (i.data->>%L)::numeric <= %L::numeric', fkey, fval2
        );
      END IF;
    END IF;
  END LOOP;

  -- ── Health filter ─────────────────────────────────────────
  -- "Incomplete" means missing a value for a REQUIRED field of the
  -- item's own effective schema. Required keys are resolved once per
  -- category in a CTE, not once per row.
  IF p_health = 'incomplete' THEN
    health_cte := format(
      'WITH req AS ('
      || 'SELECT c.id AS category_id, '
      || 'COALESCE(array_agg(f.elem->>%L) FILTER (WHERE (f.elem->>%L)::boolean), ARRAY[]::text[]) AS required_keys '
      || 'FROM public.categories c '
      || 'CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem) '
      || 'WHERE c.id IN (SELECT DISTINCT i2.category_id FROM public.items i2 WHERE %s) '
      || 'GROUP BY c.id) ',
      'key', 'required',
      replace(scope_sql, 'i.', 'i2.')
    );
    health_join  := 'LEFT JOIN req r ON r.category_id = i.category_id';
    health_where := format(
      ' AND EXISTS (SELECT 1 FROM unnest(COALESCE(r.required_keys, ARRAY[]::text[])) AS k'
      || ' WHERE NOT (i.data ? k) OR i.data->>k IS NULL OR btrim(i.data->>k) = %L)',
      ''
    );
  ELSIF p_health = 'orphaned' THEN
    health_where := format(
      ' AND (i.data ? %L) AND i.data->%L <> %L::jsonb',
      '__orphaned', '__orphaned', '{}'
    );
  END IF;

  -- ── Stale-schema filter ───────────────────────────────────
  IF p_stale_before IS NOT NULL THEN
    where_sql := where_sql || format(' AND i.schema_version < %L::int', p_stale_before);
  END IF;

  -- ── Sort ──────────────────────────────────────────────────
  IF p_sort_key IS NULL OR p_sort_key = '' THEN
    order_sql := 'i.created_at DESC';
  ELSIF p_sort_key = 'created_at' OR p_sort_key = 'updated_at' THEN
    order_sql := format('i.%I %s', p_sort_key, dir);
  ELSIF p_sort_key !~ key_re THEN
    order_sql := 'i.created_at DESC';
  ELSE
    -- The cast is what makes 8 sort before 16, and 2024-02 before
    -- 2024-10. NULLIF+regex keeps a stray non-numeric value from
    -- aborting the whole query.
    cast_expr := CASE p_sort_type
      WHEN 'number' THEN format(
        '(CASE WHEN i.data->>%L ~ %L THEN (i.data->>%L)::numeric END)',
        p_sort_key, '^-?[0-9]+(\.[0-9]+)?$', p_sort_key
      )
      WHEN 'date' THEN format(
        '(CASE WHEN i.data->>%L ~ %L THEN (i.data->>%L)::date END)',
        p_sort_key, '^\d{4}-\d{2}-\d{2}', p_sort_key
      )
      WHEN 'boolean' THEN format(
        '(CASE WHEN i.data->>%L IN (%L,%L) THEN (i.data->>%L)::boolean END)',
        p_sort_key, 'true', 'false', p_sort_key
      )
      ELSE format('lower(i.data->>%L)', p_sort_key)
    END;
    order_sql := format('%s %s NULLS LAST, i.created_at DESC', cast_expr, dir);
  END IF;

  -- ── Count, then page ──────────────────────────────────────
  EXECUTE format(
    '%s SELECT count(*)::int FROM public.items i %s WHERE %s AND %s %s',
    health_cte, health_join, scope_sql, where_sql, health_where
  ) INTO total;

  EXECUTE format(
    '%s SELECT COALESCE(jsonb_agg(rw ORDER BY rw.ord), %L::jsonb) FROM ('
    || 'SELECT row_number() OVER (ORDER BY %s) AS ord, i.id, i.category_id, i.data, '
    || 'i.schema_version, i.created_at, i.updated_at, c.name AS category_name '
    || 'FROM public.items i JOIN public.categories c ON c.id = i.category_id %s '
    || 'WHERE %s AND %s %s ORDER BY %s LIMIT %s OFFSET %s'
    || ') rw',
    health_cte, '[]', order_sql, health_join, scope_sql, where_sql, health_where, order_sql,
    GREATEST(COALESCE(p_limit, 50), 1), GREATEST(COALESCE(p_offset, 0), 0)
  ) INTO rows_json;

  RETURN jsonb_build_object('total', COALESCE(total, 0), 'rows', COALESCE(rows_json, '[]'::jsonb));
END;
$$;


-- ============================================================
-- 8. move_items(p_item_ids, p_target_category_id)  → JSONB
-- ------------------------------------------------------------
-- Move items between categories, reconciling their data with the
-- target's schema in ONE transaction.
--
-- An item's data was written against its old category's effective
-- schema. Moving it means three things happen to each value:
--   * key in BOTH schemas      → carried across untouched
--   * key only in the SOURCE   → moved to data.__orphaned (never
--                                deleted — Phase 5 surfaces it)
--   * key only in the TARGET   → left empty; the item simply reads as
--                                incomplete afterwards
--
-- Returns the counts so the caller can report what happened.
-- ============================================================
CREATE OR REPLACE FUNCTION public.move_items(
  p_item_ids           UUID[],
  p_target_category_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_keys    TEXT[];
  src_keys       TEXT[];
  it             RECORD;
  k              TEXT;
  new_data       JSONB;
  orphan_obj     JSONB;
  target_version INT;
  moved          INT := 0;
  carried        INT := 0;
  orphaned       INT := 0;
BEGIN
  IF p_item_ids IS NULL OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('moved', 0, 'carried', 0, 'orphaned', 0);
  END IF;

  SELECT COALESCE(array_agg(e->>'key'), ARRAY[]::TEXT[]) INTO target_keys
  FROM jsonb_array_elements(public.get_effective_schema(p_target_category_id)) e;

  SELECT COALESCE(MAX(version), 1) INTO target_version
  FROM public.schema_versions WHERE category_id = p_target_category_id;

  FOR it IN
    SELECT i.id, i.category_id, i.data FROM public.items i WHERE i.id = ANY(p_item_ids)
  LOOP
    -- Skip items already in the target: nothing to reconcile.
    CONTINUE WHEN it.category_id = p_target_category_id;

    SELECT COALESCE(array_agg(e->>'key'), ARRAY[]::TEXT[]) INTO src_keys
    FROM jsonb_array_elements(public.get_effective_schema(it.category_id)) e;

    new_data   := '{}'::jsonb;
    orphan_obj := COALESCE(it.data->'__orphaned', '{}'::jsonb);

    FOREACH k IN ARRAY src_keys LOOP
      CONTINUE WHEN NOT (it.data ? k);
      IF k = ANY(target_keys) THEN
        new_data := new_data || jsonb_build_object(k, it.data->k);
        carried  := carried + 1;
      ELSE
        orphan_obj := orphan_obj || jsonb_build_object(k, it.data->k);
        orphaned   := orphaned + 1;
      END IF;
    END LOOP;

    IF orphan_obj <> '{}'::jsonb THEN
      new_data := new_data || jsonb_build_object('__orphaned', orphan_obj);
    END IF;

    UPDATE public.items
       SET category_id    = p_target_category_id,
           data           = new_data,
           schema_version = target_version
     WHERE id = it.id;

    moved := moved + 1;
  END LOOP;

  RETURN jsonb_build_object('moved', moved, 'carried', carried, 'orphaned', orphaned);
END;
$$;


-- ============================================================
-- 9. get_incomplete_items(p_category_id, p_include_subtree)
-- ------------------------------------------------------------
-- Items missing a value for a field their effective schema marks
-- required. In SQL so the dashboard can ask this across the tree
-- cheaply, resolving each schema once per category rather than once
-- per item.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_incomplete_items(
  p_category_id     UUID,
  p_include_subtree BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT CASE
      WHEN p_include_subtree
        THEN (SELECT array_agg(s.id) FROM public.get_category_subtree(p_category_id) s)
      ELSE ARRAY[p_category_id]
    END AS ids
  ),
  required_by_category AS (
    SELECT c.id AS category_id,
           COALESCE(array_agg(f.elem->>'key') FILTER (
             WHERE (f.elem->>'required')::boolean
           ), ARRAY[]::TEXT[]) AS required_keys
    FROM public.categories c
    CROSS JOIN scope
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem)
    WHERE c.id = ANY(scope.ids)
    GROUP BY c.id
  )
  SELECT COALESCE(jsonb_agg(x), '[]'::jsonb)
  FROM (
    SELECT i.id,
           i.category_id,
           COALESCE(array_to_json(ARRAY(
             SELECT k FROM unnest(r.required_keys) AS k
             WHERE NOT (i.data ? k)
                OR i.data->>k IS NULL
                OR btrim(i.data->>k) = ''
           ))::jsonb, '[]'::jsonb) AS missing_required
    FROM public.items i
    JOIN required_by_category r ON r.category_id = i.category_id
    WHERE EXISTS (
      SELECT 1 FROM unnest(r.required_keys) AS k
      WHERE NOT (i.data ? k)
         OR i.data->>k IS NULL
         OR btrim(i.data->>k) = ''
    )
  ) x;
$$;


-- ============================================================
-- 10. get_item_health_counts(p_category_id, p_include_subtree)
-- ------------------------------------------------------------
-- Totals for the Items tab header strip:
--   "48 items · 5 incomplete · 2 with orphaned data"
--
-- Required keys are resolved ONCE PER CATEGORY via a CTE rather than
-- once per item — the same reason get_items_missing_required exists.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_item_health_counts(
  p_category_id     UUID,
  p_include_subtree BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT CASE
      WHEN p_include_subtree
        THEN (SELECT array_agg(s.id) FROM public.get_category_subtree(p_category_id) s)
      ELSE ARRAY[p_category_id]
    END AS ids
  ),
  req AS (
    SELECT c.id AS category_id,
           COALESCE(array_agg(f.elem->>'key') FILTER (
             WHERE (f.elem->>'required')::boolean
           ), ARRAY[]::TEXT[]) AS required_keys
    FROM public.categories c
    CROSS JOIN scope
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.id)) AS f(elem)
    WHERE c.id = ANY(scope.ids)
    GROUP BY c.id
  ),
  scoped AS (
    SELECT i.id, i.data, r.required_keys
    FROM public.items i
    CROSS JOIN scope
    LEFT JOIN req r ON r.category_id = i.category_id
    WHERE i.category_id = ANY(scope.ids)
  )
  SELECT jsonb_build_object(
    'total', count(*)::int,
    'incomplete', count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM unnest(COALESCE(s.required_keys, ARRAY[]::TEXT[])) AS k
      WHERE NOT (s.data ? k) OR s.data->>k IS NULL OR btrim(s.data->>k) = ''
    ))::int,
    'orphaned', count(*) FILTER (
      WHERE s.data ? '__orphaned' AND s.data->'__orphaned' <> '{}'::jsonb
    )::int
  )
  FROM scoped s;
$$;


-- ============================================================
-- 11. count_categories_with_orphans()  → JSONB[]
-- ------------------------------------------------------------
-- Categories holding items with orphaned values, for the dashboard's
-- attention panel.
-- ============================================================
CREATE OR REPLACE FUNCTION public.count_categories_with_orphans()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.orphan_count DESC), '[]'::jsonb)
  FROM (
    SELECT i.category_id,
           c.name AS category_name,
           count(*)::int AS orphan_count
    FROM public.items i
    JOIN public.categories c ON c.id = i.category_id
    WHERE i.data ? '__orphaned' AND i.data->'__orphaned' <> '{}'::jsonb
    GROUP BY i.category_id, c.name
  ) x;
$$;


-- ████████████████████████████████████████████████████████████
-- ██  supabase/triggers.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Integrity Triggers (Phase 1, Increment 3)
-- Source this AFTER functions.sql (it calls get_category_ancestors
-- and get_category_subtree).
--
-- Load order:  schema.sql  →  functions.sql  →  triggers.sql
--
-- All raised messages are written to surface directly in UI toasts,
-- so they are phrased for humans.
-- ============================================================


-- ============================================================
-- 1. validate_category_fields()
-- ------------------------------------------------------------
-- Fires BEFORE INSERT/UPDATE of own_fields, overrides or parent_id.
-- Enforces, in order:
--   A. shape of every own_field (key / type / options / position)
--   B. key uniqueness WITHIN own_fields
--   C. key must not collide with any ANCESTOR field  (no redefining
--      inherited fields — use an override instead)
--   D. key must not collide with any DESCENDANT field
--   E. override guard: target key must be inherited, and a patch may
--      not carry `type` or `key`.
--
-- NOTE ON TIMING: in a BEFORE trigger the target row still holds its
-- OLD values, so we resolve the ancestor chain from NEW.parent_id
-- (strict ancestors) and the descendant set from get_category_subtree
-- (NEW.id) minus the node itself. For a brand-new INSERT the node is
-- not yet in the table, so it has no descendants — correct.
-- ============================================================
CREATE OR REPLACE FUNCTION public.validate_category_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  fld           JSONB;
  k             TEXT;
  t             TEXT;
  dup           TEXT;
  anc_keys      TEXT[];
  desc_keys     TEXT[];
  o_key         TEXT;
  o_patch       JSONB;
  allowed_types TEXT[] := ARRAY['string','text','number','boolean','date','select','multiselect','url'];
BEGIN
  -- ── A. shape of every own_field ───────────────────────────
  IF jsonb_typeof(COALESCE(NEW.own_fields, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'own_fields must be a JSON array';
  END IF;

  FOR fld IN SELECT value FROM jsonb_array_elements(NEW.own_fields) LOOP
    k := fld->>'key';
    t := fld->>'type';

    IF k IS NULL OR k !~ '^[a-z][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Invalid field key "%": use snake_case matching ^[a-z][a-z0-9_]*$', COALESCE(k, '(missing)');
    END IF;

    IF t IS NULL OR NOT (t = ANY(allowed_types)) THEN
      RAISE EXCEPTION 'Field "%" has invalid type "%": must be one of string, text, number, boolean, date, select, multiselect, url',
        k, COALESCE(t, '(missing)');
    END IF;

    IF t IN ('select', 'multiselect') THEN
      IF jsonb_typeof(fld->'options') <> 'array'
         OR jsonb_array_length(COALESCE(fld->'options', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Field "%" of type % requires a non-empty "options" array', k, t;
      END IF;
    END IF;

    -- position is optional at the storage layer (the resolver defaults it
    -- to 0); when present it must be an integer.
    IF fld ? 'position'
       AND (jsonb_typeof(fld->'position') <> 'number'
            OR (fld->>'position')::numeric <> floor((fld->>'position')::numeric)) THEN
      RAISE EXCEPTION 'Field "%" position must be an integer', k;
    END IF;
  END LOOP;

  -- ── B. duplicate key within own_fields ────────────────────
  SELECT f->>'key' INTO dup
  FROM jsonb_array_elements(NEW.own_fields) f
  GROUP BY f->>'key' HAVING count(*) > 1
  LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate field key "%" within this category', dup;
  END IF;

  -- ── collect ancestor keys (strict ancestors: walk from parent)
  SELECT array_agg(DISTINCT af.elem->>'key') INTO anc_keys
  FROM public.get_category_ancestors(NEW.parent_id) a
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.own_fields, '[]'::jsonb)) AS af(elem);

  -- ── collect descendant keys (strict descendants of NEW.id) ─
  SELECT array_agg(DISTINCT df.elem->>'key') INTO desc_keys
  FROM public.get_category_subtree(NEW.id) sub
  JOIN public.categories c ON c.id = sub.id AND c.id <> NEW.id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.own_fields, '[]'::jsonb)) AS df(elem);

  -- ── C + D. own keys must not collide up or down the chain ──
  FOR fld IN SELECT value FROM jsonb_array_elements(NEW.own_fields) LOOP
    k := fld->>'key';
    IF anc_keys IS NOT NULL AND k = ANY(anc_keys) THEN
      RAISE EXCEPTION 'Field key "%" is already defined by an ancestor category; inherited fields cannot be redefined — use an override instead', k;
    END IF;
    IF desc_keys IS NOT NULL AND k = ANY(desc_keys) THEN
      RAISE EXCEPTION 'Field key "%" is already defined by a descendant category', k;
    END IF;
  END LOOP;

  -- ── C2. ancestor keys and descendant keys must stay disjoint ──
  -- Catches a re-parent (or any change) that would make an EXISTING
  -- descendant redefine a field it now inherits from the new chain —
  -- the descendant's own trigger does not fire on a move of this node.
  IF anc_keys IS NOT NULL AND desc_keys IS NOT NULL AND (anc_keys && desc_keys) THEN
    RAISE EXCEPTION 'This change would make a descendant category redefine an inherited field (key %)',
      (SELECT string_agg(x, ', ') FROM unnest(anc_keys) x WHERE x = ANY(desc_keys));
  END IF;

  -- ── E. override guard ─────────────────────────────────────
  IF jsonb_typeof(COALESCE(NEW.overrides, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'overrides must be a JSON object';
  END IF;

  FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(NEW.overrides) LOOP
    IF jsonb_typeof(o_patch) <> 'object' THEN
      RAISE EXCEPTION 'Override for "%" must be a JSON object', o_key;
    END IF;
    IF anc_keys IS NULL OR NOT (o_key = ANY(anc_keys)) THEN
      RAISE EXCEPTION 'Override targets "%", which is not an inherited field of this category', o_key;
    END IF;
    IF o_patch ? 'type' OR o_patch ? 'key' THEN
      RAISE EXCEPTION 'Override for "%" may not change "type" or "key"', o_key;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categories_validate_fields ON public.categories;
CREATE TRIGGER categories_validate_fields
  BEFORE INSERT OR UPDATE OF own_fields, overrides, parent_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.validate_category_fields();


-- ============================================================
-- 2. generate_category_slug()
-- ------------------------------------------------------------
-- BEFORE INSERT: if slug is null/blank, derive it from name
-- (lowercase → non-alphanumerics to '-' → collapse repeats → trim).
-- On collision within the same parent, append -2, -3, …
-- An explicitly-provided slug is respected as-is.
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_category_slug()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  base_slug TEXT;
  candidate TEXT;
  n         INT := 2;
BEGIN
  IF NEW.slug IS NOT NULL AND btrim(NEW.slug) <> '' THEN
    RETURN NEW;  -- respect an explicit slug
  END IF;

  base_slug := lower(COALESCE(NEW.name, ''));
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := btrim(base_slug, '-');
  IF base_slug = '' THEN
    base_slug := 'category';
  END IF;

  candidate := base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.slug = candidate
      AND c.id <> NEW.id
      AND c.parent_id IS NOT DISTINCT FROM NEW.parent_id
  ) LOOP
    candidate := base_slug || '-' || n;
    n := n + 1;
  END LOOP;

  NEW.slug := candidate;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS categories_generate_slug ON public.categories;
CREATE TRIGGER categories_generate_slug
  BEFORE INSERT ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.generate_category_slug();


-- ============================================================
-- Trigger fire order on categories (alphabetical within BEFORE):
--   1. categories_generate_slug     (INSERT: fill slug first)
--   2. categories_no_cycle          (parent_id: reject cycles)
--   3. categories_validate_fields   (fields/overrides integrity)
-- ============================================================


-- ████████████████████████████████████████████████████████████
-- ██  supabase/policies.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Row Level Security (Phase 1, Increment 4)
-- Source this AFTER schema.sql (tables) — it is independent of
-- functions.sql / triggers.sql but conventionally loads last.
--
-- Load order:  schema.sql → functions.sql → triggers.sql → policies.sql
--
-- Three-tier model with the new role vocabulary:
--   SCHEMA_ADMIN — owns the data model (blueprints, categories,
--                  attributes) and everything a DATA_EDITOR can do
--   DATA_EDITOR  — owns item data only; cannot touch schema
--   VIEWER       — read-only
--
-- Idempotent: every policy is dropped before it is created.
-- ============================================================


-- ============================================================
-- 1. Enable RLS on every application table
-- ============================================================
ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blueprints      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attributes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_versions ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- 2. Helper: current user's role
-- ------------------------------------------------------------
-- SECURITY DEFINER is REQUIRED here: it reads public.profiles,
-- which is itself RLS-protected. Without DEFINER the profiles
-- policies that call this function would recurse infinitely.
-- STABLE lets the planner cache it per statement.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Every policy that calls this is `TO authenticated`, so only that role
-- needs EXECUTE. anon had it through the default PUBLIC grant, exposing
-- a DEFINER function at /rest/v1/rpc/get_user_role to signed-out callers.
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_user_role() TO authenticated;


-- ============================================================
-- 3. Table grants
-- ------------------------------------------------------------
-- RLS only *restricts*; it cannot grant. Without table-level
-- privileges the policies below are unreachable. Supabase usually
-- sets these via default privileges — we state them explicitly so
-- the schema is self-contained.
--
-- schema_versions is deliberately granted SELECT + INSERT only:
-- the audit trail is append-only at BOTH the grant and policy layer.
-- ============================================================
GRANT USAGE ON SCHEMA public TO authenticated;

-- ── REVOKE FIRST — this is not optional ───────────────────────
-- Supabase ships default privileges that GRANT ALL on every new
-- table in `public` to anon, authenticated and service_role. Those
-- grants were applied when schema.sql created the tables, so an
-- additive GRANT alone cannot produce the privilege set we want:
--   * `ALL` includes UPDATE/DELETE, which would defeat the
--     append-only intent of schema_versions at the grant layer.
--   * `ALL` includes TRUNCATE, and TRUNCATE is NOT governed by RLS —
--     an authenticated VIEWER holding it could wipe a table outright,
--     policies notwithstanding.
-- So: strip everything from the two client-facing roles, then grant
-- back exactly the DML each one needs. service_role keeps its ALL
-- (server-side key, intentionally privileged).
REVOKE ALL ON public.profiles, public.blueprints, public.categories,
              public.attributes, public.items, public.schema_versions
  FROM anon, authenticated;

-- Zchema requires a login: the anonymous role gets nothing back.
-- profiles: no INSERT/DELETE for clients — see §4. Rows are created by
-- handle_new_user() and removed by the auth.users cascade, nowhere else.
GRANT SELECT, UPDATE                  ON public.profiles   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.blueprints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attributes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.items      TO authenticated;
-- append-only at the grant layer as well as the policy layer
GRANT SELECT, INSERT                  ON public.schema_versions TO authenticated;


-- ============================================================
-- 4. PROFILES
-- ------------------------------------------------------------
-- SELECT : own row; all rows for SCHEMA_ADMIN
-- UPDATE : own row; any row for SCHEMA_ADMIN
-- INSERT : nobody.   DELETE : nobody.
--
-- NOTE: a user may UPDATE their own row, which nominally includes
-- `role`. Privilege escalation is blocked by the protect_role_update()
-- trigger (schema.sql §10), which raises unless the caller is a
-- SCHEMA_ADMIN. Policy + trigger together, not policy alone.
--
-- There are deliberately NO INSERT or DELETE policies, and §3 grants
-- neither privilege to `authenticated`. This closes a full escalation:
-- a VIEWER could DELETE their own profile row and re-INSERT it with
-- role 'SCHEMA_ADMIN', because the role trigger fired only on UPDATE.
-- Since requireSchemaAdmin() and every policy below read this table,
-- that handed out the whole application to anyone who could sign up --
-- and it was reachable straight from PostgREST with the public anon
-- key, so "the UI doesn't do that" was never a mitigation.
--
-- Rows are created solely by handle_new_user() (SECURITY DEFINER,
-- schema.sql §9) and removed solely by the ON DELETE CASCADE from
-- auth.users. The DROP POLICY lines below are kept so that re-running
-- this file strips the old insert/delete policies from an existing
-- installation.
-- ============================================================
DROP POLICY IF EXISTS profiles_select_own    ON public.profiles;
DROP POLICY IF EXISTS profiles_select_admin  ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own    ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_admin  ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own    ON public.profiles;
DROP POLICY IF EXISTS profiles_update_admin  ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_own    ON public.profiles;
DROP POLICY IF EXISTS profiles_delete_admin  ON public.profiles;
-- legacy names from the pre-overhaul schema
DROP POLICY IF EXISTS profiles_select_contributor ON public.profiles;

CREATE POLICY profiles_select_own   ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid());
CREATE POLICY profiles_select_admin ON public.profiles FOR SELECT TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN');

CREATE POLICY profiles_update_own   ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_admin ON public.profiles FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN')
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');


-- ============================================================
-- 5. BLUEPRINTS  — read by all, written by SCHEMA_ADMIN
-- ============================================================
DROP POLICY IF EXISTS blueprints_select_all   ON public.blueprints;
DROP POLICY IF EXISTS blueprints_insert_admin ON public.blueprints;
DROP POLICY IF EXISTS blueprints_update_admin ON public.blueprints;
DROP POLICY IF EXISTS blueprints_delete_admin ON public.blueprints;

CREATE POLICY blueprints_select_all   ON public.blueprints FOR SELECT TO authenticated
  USING (true);
CREATE POLICY blueprints_insert_admin ON public.blueprints FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');
CREATE POLICY blueprints_update_admin ON public.blueprints FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN')
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');
CREATE POLICY blueprints_delete_admin ON public.blueprints FOR DELETE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN');


-- ============================================================
-- 6. CATEGORIES — read by all, written by SCHEMA_ADMIN
-- ------------------------------------------------------------
-- This is the schema itself. A DATA_EDITOR must NOT be able to
-- change the data model — only the records inside it.
-- ============================================================
DROP POLICY IF EXISTS categories_select_all   ON public.categories;
DROP POLICY IF EXISTS categories_insert_admin ON public.categories;
DROP POLICY IF EXISTS categories_update_admin ON public.categories;
DROP POLICY IF EXISTS categories_delete_admin ON public.categories;

CREATE POLICY categories_select_all   ON public.categories FOR SELECT TO authenticated
  USING (true);
CREATE POLICY categories_insert_admin ON public.categories FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');
CREATE POLICY categories_update_admin ON public.categories FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN')
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');
CREATE POLICY categories_delete_admin ON public.categories FOR DELETE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN');


-- ============================================================
-- 7. ATTRIBUTES — read by all, written by SCHEMA_ADMIN
-- ============================================================
DROP POLICY IF EXISTS attributes_select_all   ON public.attributes;
DROP POLICY IF EXISTS attributes_insert_admin ON public.attributes;
DROP POLICY IF EXISTS attributes_update_admin ON public.attributes;
DROP POLICY IF EXISTS attributes_delete_admin ON public.attributes;

CREATE POLICY attributes_select_all   ON public.attributes FOR SELECT TO authenticated
  USING (true);
CREATE POLICY attributes_insert_admin ON public.attributes FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');
CREATE POLICY attributes_update_admin ON public.attributes FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN')
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');
CREATE POLICY attributes_delete_admin ON public.attributes FOR DELETE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN');


-- ============================================================
-- 8. ITEMS — read by all, written by SCHEMA_ADMIN or DATA_EDITOR
-- ============================================================
DROP POLICY IF EXISTS items_select_all      ON public.items;
DROP POLICY IF EXISTS items_insert_editor   ON public.items;
DROP POLICY IF EXISTS items_update_editor   ON public.items;
DROP POLICY IF EXISTS items_delete_editor   ON public.items;
-- legacy names from the pre-overhaul schema
DROP POLICY IF EXISTS items_insert_contributor ON public.items;
DROP POLICY IF EXISTS items_update_contributor ON public.items;
DROP POLICY IF EXISTS items_delete_contributor ON public.items;

CREATE POLICY items_select_all    ON public.items FOR SELECT TO authenticated
  USING (true);
CREATE POLICY items_insert_editor ON public.items FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('SCHEMA_ADMIN', 'DATA_EDITOR'));
CREATE POLICY items_update_editor ON public.items FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('SCHEMA_ADMIN', 'DATA_EDITOR'))
  WITH CHECK (public.get_user_role() IN ('SCHEMA_ADMIN', 'DATA_EDITOR'));
CREATE POLICY items_delete_editor ON public.items FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('SCHEMA_ADMIN', 'DATA_EDITOR'));


-- ============================================================
-- 9. SCHEMA_VERSIONS — append-only audit trail
-- ------------------------------------------------------------
-- SELECT : all authenticated
-- INSERT : SCHEMA_ADMIN
-- UPDATE : *** no policy, deliberately ***
-- DELETE : *** no policy, deliberately ***
--
-- With RLS enabled, an operation with no matching policy is denied.
-- The audit trail is therefore immutable BY OMISSION — do not add
-- an UPDATE or DELETE policy here in a later phase.
-- ============================================================
DROP POLICY IF EXISTS schema_versions_select_all   ON public.schema_versions;
DROP POLICY IF EXISTS schema_versions_insert_admin ON public.schema_versions;

CREATE POLICY schema_versions_select_all   ON public.schema_versions FOR SELECT TO authenticated
  USING (true);
CREATE POLICY schema_versions_insert_admin ON public.schema_versions FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');


-- ████████████████████████████████████████████████████████████
-- ██  supabase/impact.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Schema Change Impact Analysis (Phase 5)
-- Source AFTER schema.sql → functions.sql → triggers.sql.
--
-- Changing a data model against live records is the scariest routine
-- operation in software. These functions measure the blast radius
-- BEFORE anything is written.
--
-- analyze_schema_change() is STRICTLY READ-ONLY. It is called on every
-- keystroke (debounced) by the impact dialog, so it must never write
-- and must stay cheap enough to run repeatedly.
-- ============================================================


-- ============================================================
-- 1. try_cast(value, target_type)  → JSONB or NULL
-- ------------------------------------------------------------
-- Probe whether a stored value survives a type change. Returns the
-- converted value, or NULL when the cast fails.
--
-- This has to happen in SQL: round-tripping every item value to the
-- client to test castability would defeat the point of the feature.
--
-- NOTE ON PRIVILEGE: the plan specified SECURITY DEFINER. This reads
-- no tables and needs no elevation, so it is INVOKER — DEFINER would
-- grant nothing here while widening the blast radius if the function
-- were ever extended. Change it if you disagree; nothing depends on it.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_cast(p_value JSONB, p_target TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  txt TEXT;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN NULL;
  END IF;

  -- Unwrap a JSON string; render anything else as text.
  txt := CASE WHEN jsonb_typeof(p_value) = 'string'
              THEN p_value #>> '{}'
              ELSE p_value::text END;

  IF btrim(COALESCE(txt, '')) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    CASE p_target
      WHEN 'number'  THEN RETURN to_jsonb(txt::numeric);
      WHEN 'boolean' THEN RETURN to_jsonb(txt::boolean);
      WHEN 'date'    THEN RETURN to_jsonb((txt::date)::text);
      WHEN 'multiselect' THEN
        IF jsonb_typeof(p_value) = 'array' THEN RETURN p_value; END IF;
        RETURN jsonb_build_array(txt);
      ELSE
        -- string / text / url / select all hold text.
        RETURN to_jsonb(txt);
    END CASE;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;
END;
$$;


-- ============================================================
-- 2. resolve_schema_preview(category, own_fields, overrides)
-- ------------------------------------------------------------
-- get_effective_schema(), but with the target category's own_fields
-- and overrides SUBSTITUTED for proposed ones that are not saved.
--
-- This is what lets the impact dialog answer "what would happen if I
-- saved this?" without writing anything first.
--
-- Keep the algorithm identical to get_effective_schema — if that one
-- changes, change this in the same commit.
-- ============================================================
CREATE OR REPLACE FUNCTION public.resolve_schema_preview(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  anc       RECORD;
  fld       JSONB;
  acc       JSONB := '[]'::jsonb;
  seen      TEXT[] := ARRAY[]::TEXT[];
  k         TEXT;
  o_key     TEXT;
  o_patch   JSONB;
  p_key     TEXT;
  p_val     JSONB;
  idx       INT;
  cur       JSONB;
  patched   JSONB;
  eff_own   JSONB;
  eff_over  JSONB;
  allowed   TEXT[] := ARRAY['label','required','options','default','help_text','position'];
BEGIN
  -- Pass 1: fold own_fields, root → target, substituting at the target.
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    eff_own := CASE WHEN anc.id = p_category_id
                    THEN COALESCE(p_new_own_fields, anc.own_fields)
                    ELSE anc.own_fields END;

    IF jsonb_typeof(COALESCE(eff_own, '[]'::jsonb)) <> 'array' THEN CONTINUE; END IF;

    FOR fld IN SELECT value FROM jsonb_array_elements(eff_own)
    LOOP
      k := fld->>'key';
      IF k IS NULL THEN CONTINUE; END IF;
      IF k = ANY(seen) THEN CONTINUE; END IF;
      seen := array_append(seen, k);
      acc := acc || jsonb_build_array(
        fld || jsonb_build_object(
          'source_category_id',   anc.id,
          'source_category_name', anc.name,
          'depth',                anc.depth,
          'inherited',            anc.depth > 0,
          'overridden_by',        '[]'::jsonb
        )
      );
    END LOOP;
  END LOOP;

  -- Pass 2: apply overrides, root → target, substituting at the target.
  FOR anc IN
    SELECT * FROM public.get_category_ancestors(p_category_id) ORDER BY depth DESC
  LOOP
    eff_over := CASE WHEN anc.id = p_category_id
                     THEN COALESCE(p_new_overrides, anc.overrides)
                     ELSE anc.overrides END;

    IF jsonb_typeof(COALESCE(eff_over, '{}'::jsonb)) <> 'object' THEN CONTINUE; END IF;

    FOR o_key, o_patch IN SELECT key, value FROM jsonb_each(eff_over)
    LOOP
      CONTINUE WHEN jsonb_typeof(o_patch) <> 'object';
      FOR idx IN 0 .. jsonb_array_length(acc) - 1
      LOOP
        cur := acc->idx;
        IF cur->>'key' = o_key THEN
          patched := cur;
          FOR p_key, p_val IN SELECT key, value FROM jsonb_each(o_patch)
          LOOP
            IF p_key = ANY(allowed) THEN
              patched := patched || jsonb_build_object(p_key, p_val);
            END IF;
          END LOOP;
          patched := jsonb_set(
            patched, '{overridden_by}',
            COALESCE(patched->'overridden_by', '[]'::jsonb) || to_jsonb(anc.id)
          );
          acc := jsonb_set(acc, ARRAY[idx::text], patched);
          EXIT;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- Pass 3: sort (depth DESC, position ASC, label ASC).
  SELECT COALESCE(
           jsonb_agg(e ORDER BY (e->>'depth')::int DESC,
                                COALESCE((e->>'position')::numeric, 0) ASC,
                                COALESCE(e->>'label', '') ASC),
           '[]'::jsonb)
    INTO acc
  FROM jsonb_array_elements(acc) e;

  RETURN acc;
END;
$$;


-- ============================================================
-- 3. analyze_schema_change(category, own_fields, overrides)
-- ------------------------------------------------------------
-- READ-ONLY. Returns the blast radius of a proposed schema change:
--
--   { category_id, current_version, next_version,
--     affected_categories: [{id,name,depth,item_count}],
--     total_affected_items, changes: SchemaChange[],
--     max_severity, blocked, blocked_reason }
--
-- Severity follows the Phase 5 table: adding an optional field is
-- safe, making a field required is a warning, and anything that can
-- lose a stored value is destructive.
-- ============================================================
CREATE OR REPLACE FUNCTION public.analyze_schema_change(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  key_re      CONSTANT TEXT := '^[a-z][a-z0-9_]*$';
  allowed_types TEXT[] := ARRAY['string','text','number','boolean','date','select','multiselect','url'];

  cur_schema JSONB;
  next_schema    JSONB;
  subtree_ids    UUID[];
  affected       JSONB := '[]'::jsonb;
  changes        JSONB := '[]'::jsonb;

  cur_ver     INT;
  total_items INT := 0;
  max_sev     TEXT := 'safe';
  blocked     BOOLEAN := false;
  reason      TEXT := NULL;

  fld         JSONB;
  k           TEXT;
  t           TEXT;
  before_f    JSONB;
  after_f     JSONB;
  anc_keys    TEXT[];
  desc_keys   TEXT[];
  o_key       TEXT;

  n_affected   INT;
  n_lossy      INT;
  samples      JSONB;
  removed_opts TEXT[];
BEGIN
  -- ── Validate the proposal before measuring it ─────────────
  IF jsonb_typeof(COALESCE(p_new_own_fields, '[]'::jsonb)) <> 'array' THEN
    blocked := true; reason := 'own_fields must be a JSON array.';
  END IF;

  IF NOT blocked THEN
    SELECT COALESCE(array_agg(DISTINCT af.elem->>'key'), ARRAY[]::TEXT[]) INTO anc_keys
    FROM public.get_category_ancestors(
           (SELECT parent_id FROM public.categories WHERE id = p_category_id)
         ) a
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(a.own_fields, '[]'::jsonb)) AS af(elem);

    SELECT COALESCE(array_agg(DISTINCT df.elem->>'key'), ARRAY[]::TEXT[]) INTO desc_keys
    FROM public.get_category_subtree(p_category_id) s
    JOIN public.categories c ON c.id = s.id AND c.id <> p_category_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.own_fields, '[]'::jsonb)) AS df(elem);

    FOR fld IN SELECT value FROM jsonb_array_elements(COALESCE(p_new_own_fields, '[]'::jsonb))
    LOOP
      k := fld->>'key';
      t := fld->>'type';

      IF k IS NULL OR k !~ key_re THEN
        blocked := true;
        reason := format('Invalid field key "%s": use snake_case.', COALESCE(k, '(missing)'));
        EXIT;
      END IF;
      IF t IS NULL OR NOT (t = ANY(allowed_types)) THEN
        blocked := true;
        reason := format('Field "%s" has an unsupported type "%s".', k, COALESCE(t, '(missing)'));
        EXIT;
      END IF;
      IF k = ANY(anc_keys) THEN
        blocked := true;
        reason := format('"%s" is already defined by an ancestor category. Override it instead of redefining it.', k);
        EXIT;
      END IF;
      IF k = ANY(desc_keys) THEN
        blocked := true;
        reason := format('"%s" is already defined by a descendant category.', k);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF NOT blocked AND jsonb_typeof(COALESCE(p_new_overrides, '{}'::jsonb)) = 'object' THEN
    FOR o_key IN SELECT key FROM jsonb_each(COALESCE(p_new_overrides, '{}'::jsonb))
    LOOP
      IF NOT (o_key = ANY(anc_keys)) THEN
        blocked := true;
        reason := format('Override targets "%s", which this category does not inherit.', o_key);
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- ── Resolve before / after ────────────────────────────────
  cur_schema := public.get_effective_schema(p_category_id);
  next_schema    := CASE WHEN blocked
                         THEN cur_schema
                         ELSE public.resolve_schema_preview(
                                p_category_id, p_new_own_fields, p_new_overrides)
                    END;

  -- ── Affected set: this category plus every descendant ─────
  -- Inherited fields propagate down, so a change here reaches all of
  -- them. (A descendant shadowing the key would be excluded, but the
  -- Phase 1 uniqueness trigger makes that unreachable today.)
  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'depth', s.depth,
           'item_count', (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id)
         ) ORDER BY s.depth, c.name), '[]'::jsonb),
         COALESCE(sum((SELECT count(*) FROM public.items i WHERE i.category_id = c.id)), 0)::int
    INTO affected, total_items
  FROM public.get_category_subtree(p_category_id) s
  JOIN public.categories c ON c.id = s.id;

  SELECT COALESCE(MAX(version), 0) INTO cur_ver
  FROM public.schema_versions WHERE category_id = p_category_id;

  -- ── Diff and measure ──────────────────────────────────────
  -- ADDED
  FOR after_f IN SELECT value FROM jsonb_array_elements(next_schema)
  LOOP
    k := after_f->>'key';
    SELECT e INTO before_f FROM jsonb_array_elements(cur_schema) e WHERE e->>'key' = k;
    CONTINUE WHEN before_f IS NOT NULL;

    IF (after_f->>'required')::boolean THEN
      -- Every existing item lacks it, by definition.
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'add_field', 'field_key', k, 'severity', 'warning',
        'to', after_f, 'affected_item_count', total_items,
        'sample_values', '[]'::jsonb
      ));
      IF max_sev = 'safe' THEN max_sev := 'warning'; END IF;
    ELSE
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'add_field', 'field_key', k, 'severity', 'safe',
        'to', after_f, 'affected_item_count', 0
      ));
    END IF;
  END LOOP;

  -- REMOVED
  FOR before_f IN SELECT value FROM jsonb_array_elements(cur_schema)
  LOOP
    k := before_f->>'key';
    SELECT e INTO after_f FROM jsonb_array_elements(next_schema) e WHERE e->>'key' = k;
    CONTINUE WHEN after_f IS NOT NULL;

    SELECT count(*)::int INTO n_affected
    FROM public.items i
    WHERE i.category_id = ANY(subtree_ids)
      AND i.data ? k AND i.data->>k IS NOT NULL AND btrim(i.data->>k) <> '';

    SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) INTO samples
    FROM (
      SELECT DISTINCT i.data->k AS v
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND i.data ? k AND i.data->>k IS NOT NULL AND btrim(i.data->>k) <> ''
      LIMIT 5
    ) s;

    changes := changes || jsonb_build_array(jsonb_build_object(
      'kind', 'remove_field', 'field_key', k, 'severity', 'destructive',
      'from', before_f, 'affected_item_count', n_affected, 'sample_values', samples
    ));
    max_sev := 'destructive';
  END LOOP;

  -- MODIFIED
  FOR after_f IN SELECT value FROM jsonb_array_elements(next_schema)
  LOOP
    k := after_f->>'key';
    SELECT e INTO before_f FROM jsonb_array_elements(cur_schema) e WHERE e->>'key' = k;
    CONTINUE WHEN before_f IS NULL;

    -- Type change: probe every stored value for castability.
    IF before_f->>'type' IS DISTINCT FROM after_f->>'type' THEN
      SELECT count(*)::int INTO n_affected
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids) AND i.data ? k;

      SELECT count(*)::int INTO n_lossy
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND i.data ? k
        AND i.data->>k IS NOT NULL
        AND btrim(i.data->>k) <> ''
        AND public.try_cast(i.data->k, after_f->>'type') IS NULL;

      SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) INTO samples
      FROM (
        SELECT DISTINCT i.data->k AS v
        FROM public.items i
        WHERE i.category_id = ANY(subtree_ids)
          AND i.data ? k
          AND i.data->>k IS NOT NULL
          AND btrim(i.data->>k) <> ''
          AND public.try_cast(i.data->k, after_f->>'type') IS NULL
        LIMIT 5
      ) s;

      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'retype_field', 'field_key', k, 'severity', 'destructive',
        'from', before_f->>'type', 'to', after_f->>'type',
        'affected_item_count', n_affected, 'lossy_item_count', n_lossy,
        'sample_values', samples
      ));
      max_sev := 'destructive';
    END IF;

    -- Optional → required.
    IF NOT COALESCE((before_f->>'required')::boolean, false)
       AND COALESCE((after_f->>'required')::boolean, false) THEN
      SELECT count(*)::int INTO n_affected
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND (NOT (i.data ? k) OR i.data->>k IS NULL OR btrim(i.data->>k) = '');

      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'require_field', 'field_key', k, 'severity', 'warning',
        'from', false, 'to', true, 'affected_item_count', n_affected
      ));
      IF max_sev = 'safe' THEN max_sev := 'warning'; END IF;
    END IF;

    -- Required → optional: nothing can break.
    IF COALESCE((before_f->>'required')::boolean, false)
       AND NOT COALESCE((after_f->>'required')::boolean, false) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'unrequire_field', 'field_key', k, 'severity', 'safe',
        'from', true, 'to', false, 'affected_item_count', 0
      ));
    END IF;

    -- Label change: cosmetic.
    IF before_f->>'label' IS DISTINCT FROM after_f->>'label' THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'rename_label', 'field_key', k, 'severity', 'safe',
        'from', before_f->>'label', 'to', after_f->>'label',
        'affected_item_count', 0
      ));
    END IF;

    -- Help text: also cosmetic, but it must still be REPORTED.
    -- A change nobody reports is a change nobody can apply: the impact
    -- dialog disables its button when the analysis comes back empty, so
    -- omitting this made a help-text-only edit impossible to save.
    IF COALESCE(before_f->>'help_text', '') IS DISTINCT FROM
       COALESCE(after_f->>'help_text', '') THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'change_help_text', 'field_key', k, 'severity', 'safe',
        'from', before_f->>'help_text', 'to', after_f->>'help_text',
        'affected_item_count', 0
      ));
    END IF;

    -- Options: only REMOVING one can strand data.
    IF COALESCE(before_f->'options', '[]'::jsonb) IS DISTINCT FROM
       COALESCE(after_f->'options', '[]'::jsonb) THEN

      -- Set-returning functions live in FROM, not the SELECT list, so
      -- the EXCEPT has plain columns to work on.
      SELECT COALESCE(array_agg(x.o), ARRAY[]::TEXT[]) INTO removed_opts
      FROM (
        SELECT b.o
        FROM jsonb_array_elements_text(COALESCE(before_f->'options', '[]'::jsonb)) AS b(o)
        EXCEPT
        SELECT a.o
        FROM jsonb_array_elements_text(COALESCE(after_f->'options', '[]'::jsonb)) AS a(o)
      ) x;

      IF array_length(removed_opts, 1) IS NULL THEN
        -- Options only added.
        changes := changes || jsonb_build_array(jsonb_build_object(
          'kind', 'change_options', 'field_key', k, 'severity', 'safe',
          'from', before_f->'options', 'to', after_f->'options',
          'affected_item_count', 0
        ));
      ELSE
        SELECT count(*)::int INTO n_affected
        FROM public.items i
        WHERE i.category_id = ANY(subtree_ids)
          AND i.data ? k
          AND i.data->>k = ANY(removed_opts);

        SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO samples
        FROM unnest(removed_opts) o;

        changes := changes || jsonb_build_array(jsonb_build_object(
          'kind', 'change_options', 'field_key', k,
          'severity', CASE WHEN n_affected > 0 THEN 'destructive' ELSE 'warning' END,
          'from', before_f->'options', 'to', after_f->'options',
          'affected_item_count', n_affected, 'sample_values', samples
        ));
        IF n_affected > 0 THEN max_sev := 'destructive';
        ELSIF max_sev = 'safe' THEN max_sev := 'warning';
        END IF;
      END IF;
    END IF;

    -- Override added / removed HERE. Severity follows whether it
    -- changed `required`; a label-only override cannot break data.
    IF NOT (COALESCE(before_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id))
       AND COALESCE(after_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'add_override', 'field_key', k,
        'severity', CASE WHEN COALESCE((before_f->>'required')::boolean, false)
                          IS DISTINCT FROM COALESCE((after_f->>'required')::boolean, false)
                         THEN 'warning' ELSE 'safe' END,
        'to', p_category_id, 'affected_item_count', 0
      ));
    END IF;

    IF COALESCE(before_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id)
       AND NOT (COALESCE(after_f->'overridden_by', '[]'::jsonb) @> to_jsonb(p_category_id)) THEN
      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'remove_override', 'field_key', k,
        'severity', CASE WHEN COALESCE((before_f->>'required')::boolean, false)
                          IS DISTINCT FROM COALESCE((after_f->>'required')::boolean, false)
                         THEN 'warning' ELSE 'safe' END,
        'from', p_category_id, 'affected_item_count', 0
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'category_id',          p_category_id,
    'current_version',      cur_ver,
    'next_version',         cur_ver + 1,
    'affected_categories',  affected,
    'total_affected_items', total_items,
    'changes',              changes,
    'max_severity',         CASE WHEN jsonb_array_length(changes) = 0 THEN 'safe' ELSE max_sev END,
    'blocked',              blocked,
    'blocked_reason',       reason
  );
END;
$$;


-- ============================================================
-- 4. schema_versions.authored  (Phase 5, Increment 2)
-- ------------------------------------------------------------
-- Idempotent for databases created before this column existed.
-- Fresh projects get it from schema.sql §5, which carries the same
-- definition and the rationale.
--
-- Short version: `snapshot` records the EFFECTIVE schema, which is
-- enough to DIFF a version but not enough to RESTORE one. A field's
-- resolved `required: true` does not say whether this category's
-- override set it or its parent did. Rollback that guesses at that is
-- rollback that quietly rewrites the model, so the authored state is
-- stored verbatim alongside the snapshot.
-- ============================================================
ALTER TABLE public.schema_versions
  ADD COLUMN IF NOT EXISTS authored JSONB NOT NULL DEFAULT '{}'::jsonb;


-- ============================================================
-- 5. Shared migration machinery
-- ------------------------------------------------------------
-- Editing a schema and RE-PARENTING a category are different user
-- actions with identical consequences for item data: fields appear,
-- fields disappear, and values have to go somewhere. Both must refuse
-- to guess, and neither may ever silently drop a value.
--
-- These three helpers are that shared floor. Duplicating them per
-- entry point is how the "never lose data" rule ends up enforced in
-- one path and quietly missing from the other.
-- ============================================================

-- ── 5a. validate_remediations(changes, remediations) ─────────
-- Raises on the first problem. Runs in full BEFORE any write, so a
-- request missing one remediation never applies the other nine.
CREATE OR REPLACE FUNCTION public.validate_remediations(
  p_changes      JSONB,
  p_remediations JSONB
)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  rems    JSONB := COALESCE(p_remediations, '{}'::jsonb);
  ch      JSONB;
  ch_kind TEXT;
  ch_key  TEXT;
  ch_sev  TEXT;
  rem     JSONB;
  strat   TEXT;
BEGIN
  FOR ch IN SELECT value FROM jsonb_array_elements(COALESCE(p_changes, '[]'::jsonb))
  LOOP
    ch_key  := ch->>'field_key';
    ch_kind := ch->>'kind';
    ch_sev  := ch->>'severity';
    rem     := COALESCE(rems -> (ch_key || ':' || ch_kind), rems -> ch_key);
    strat   := rem->>'strategy';

    -- (a) Destructive changes demand an explicit choice.
    IF ch_sev = 'destructive' AND strat IS NULL THEN
      RAISE EXCEPTION
        'Destructive change to "%" (%) has no remediation. Refusing to guess what should happen to % item value(s).',
        ch_key, ch_kind, ch->>'affected_item_count';
    END IF;

    -- Anything else defaults to "leave", which is a no-op.
    CONTINUE WHEN strat IS NULL;

    -- (b) The strategy must make sense for this kind of change.
    IF NOT (strat = ANY (
      CASE ch_kind
        WHEN 'add_field'      THEN ARRAY['backfill','leave']
        WHEN 'require_field'  THEN ARRAY['backfill','leave']
        WHEN 'remove_field'   THEN ARRAY['orphan','discard']
        WHEN 'retype_field'   THEN ARRAY['cast','orphan','discard']
        WHEN 'change_options' THEN ARRAY['orphan','backfill','discard','leave']
        ELSE ARRAY['leave']
      END)) THEN
      RAISE EXCEPTION 'Strategy "%" is not valid for % on "%".', strat, ch_kind, ch_key;
    END IF;

    -- (c) discard is the only strategy that destroys data outright.
    -- It is never a default and never silent.
    IF strat = 'discard' AND NOT COALESCE((rem->>'confirm')::boolean, false) THEN
      RAISE EXCEPTION
        'Strategy "discard" on "%" permanently deletes item values and requires an explicit "confirm": true.',
        ch_key;
    END IF;

    IF strat = 'backfill' AND NOT (rem ? 'value') THEN
      RAISE EXCEPTION 'Strategy "backfill" on "%" needs a "value" to write.', ch_key;
    END IF;
  END LOOP;
END;
$$;


-- ── 5b. apply_remediations(subtree, changes, remediations) ───
-- Rewrites item data across the affected subtree.
--
-- Returns { changes, touched, orphaned } where `changes` is the input
-- annotated with the strategy ACTUALLY used and how many rows it
-- touched — what gets recorded in the audit trail. Recording the
-- request instead of the effect would make the trail unfalsifiable.
CREATE OR REPLACE FUNCTION public.apply_remediations(
  p_subtree_ids  UUID[],
  p_changes      JSONB,
  p_remediations JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  rems         JSONB := COALESCE(p_remediations, '{}'::jsonb);
  ch           JSONB;
  ch_kind      TEXT;
  ch_key       TEXT;
  rem          JSONB;
  strat        TEXT;
  rem_value    JSONB;
  new_type     TEXT;
  removed_opts TEXT[];
  applied      JSONB := '[]'::jsonb;
  batch        UUID[];
  touched      UUID[] := ARRAY[]::UUID[];
  orphaned     UUID[] := ARRAY[]::UUID[];
BEGIN
  FOR ch IN SELECT value FROM jsonb_array_elements(COALESCE(p_changes, '[]'::jsonb))
  LOOP
    ch_key    := ch->>'field_key';
    ch_kind   := ch->>'kind';
    rem       := COALESCE(rems -> (ch_key || ':' || ch_kind), rems -> ch_key);
    strat     := COALESCE(rem->>'strategy', 'leave');
    rem_value := rem->'value';
    batch     := ARRAY[]::UUID[];

    IF strat = 'backfill' THEN
      -- change_options backfill rewrites the stranded values; every
      -- other backfill fills the blanks.
      IF ch_kind = 'change_options' THEN
        SELECT COALESCE(array_agg(o), ARRAY[]::TEXT[]) INTO removed_opts
        FROM jsonb_array_elements_text(COALESCE(ch->'sample_values', '[]'::jsonb)) AS t(o);

        WITH upd AS (
          UPDATE public.items i
             SET data = i.data || jsonb_build_object(ch_key, rem_value)
           WHERE i.category_id = ANY(p_subtree_ids)
             AND i.data ? ch_key
             AND i.data->>ch_key = ANY(removed_opts)
          RETURNING i.id
        ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      ELSE
        WITH upd AS (
          UPDATE public.items i
             SET data = i.data || jsonb_build_object(ch_key, rem_value)
           WHERE i.category_id = ANY(p_subtree_ids)
             AND (NOT (i.data ? ch_key)
                  OR i.data->>ch_key IS NULL
                  OR btrim(i.data->>ch_key) = '')
          RETURNING i.id
        ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      END IF;
      touched := touched || batch;

    ELSIF strat = 'cast' THEN
      new_type := ch->>'to';

      -- values that survive the cast are converted in place
      WITH upd AS (
        UPDATE public.items i
           SET data = i.data || jsonb_build_object(ch_key, public.try_cast(i.data->ch_key, new_type))
         WHERE i.category_id = ANY(p_subtree_ids)
           AND i.data ? ch_key
           AND btrim(COALESCE(i.data->>ch_key, '')) <> ''
           AND public.try_cast(i.data->ch_key, new_type) IS NOT NULL
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched := touched || batch;

      -- values that do NOT survive are preserved, not dropped
      WITH upd AS (
        UPDATE public.items i
           SET data = (i.data - ch_key)
                   || jsonb_build_object('__orphaned',
                        COALESCE(i.data->'__orphaned', '{}'::jsonb)
                        || jsonb_build_object(ch_key, i.data->ch_key))
         WHERE i.category_id = ANY(p_subtree_ids)
           AND i.data ? ch_key
           AND btrim(COALESCE(i.data->>ch_key, '')) <> ''
           AND public.try_cast(i.data->ch_key, new_type) IS NULL
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched  := touched  || batch;
      orphaned := orphaned || batch;

    ELSIF strat = 'orphan' THEN
      -- change_options orphans only the stranded values; everything
      -- else orphans the whole column.
      IF ch_kind = 'change_options' THEN
        SELECT COALESCE(array_agg(o), ARRAY[]::TEXT[]) INTO removed_opts
        FROM jsonb_array_elements_text(COALESCE(ch->'sample_values', '[]'::jsonb)) AS t(o);
      ELSE
        removed_opts := NULL;
      END IF;

      WITH upd AS (
        UPDATE public.items i
           SET data = (i.data - ch_key)
                   || jsonb_build_object('__orphaned',
                        COALESCE(i.data->'__orphaned', '{}'::jsonb)
                        || jsonb_build_object(ch_key, i.data->ch_key))
         WHERE i.category_id = ANY(p_subtree_ids)
           AND i.data ? ch_key
           AND btrim(COALESCE(i.data->>ch_key, '')) <> ''
           AND (removed_opts IS NULL OR i.data->>ch_key = ANY(removed_opts))
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched  := touched  || batch;
      orphaned := orphaned || batch;

      -- A blank value carries no information worth preserving; drop
      -- the empty key so it does not clutter __orphaned.
      IF removed_opts IS NULL THEN
        WITH upd AS (
          UPDATE public.items i
             SET data = i.data - ch_key
           WHERE i.category_id = ANY(p_subtree_ids)
             AND i.data ? ch_key
             AND btrim(COALESCE(i.data->>ch_key, '')) = ''
          RETURNING i.id
        ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
        touched := touched || batch;
      END IF;

    ELSIF strat = 'discard' THEN
      -- Removing a select OPTION strands only the items holding that
      -- option; discarding the whole column there would delete values
      -- the change never touched.
      IF ch_kind = 'change_options' THEN
        SELECT COALESCE(array_agg(o), ARRAY[]::TEXT[]) INTO removed_opts
        FROM jsonb_array_elements_text(COALESCE(ch->'sample_values', '[]'::jsonb)) AS t(o);
      ELSE
        removed_opts := NULL;
      END IF;

      WITH upd AS (
        UPDATE public.items i
           SET data = i.data - ch_key
         WHERE i.category_id = ANY(p_subtree_ids)
           AND i.data ? ch_key
           AND (removed_opts IS NULL OR i.data->>ch_key = ANY(removed_opts))
        RETURNING i.id
      ) SELECT COALESCE(array_agg(upd.id), ARRAY[]::UUID[]) INTO batch FROM upd;
      touched := touched || batch;
    END IF;

    -- Record what was actually done, not what was requested.
    applied := applied || jsonb_build_array(
      ch || jsonb_build_object(
        'strategy', strat,
        'remediated_item_count', COALESCE(array_length(batch, 1), 0)
      )
    );
  END LOOP;

  SELECT COALESCE(array_agg(DISTINCT u.x), ARRAY[]::UUID[]) INTO touched
  FROM unnest(touched) AS u(x);
  SELECT COALESCE(array_agg(DISTINCT u.x), ARRAY[]::UUID[]) INTO orphaned
  FROM unnest(orphaned) AS u(x);

  RETURN jsonb_build_object(
    'changes',  applied,
    'touched',  to_jsonb(touched),
    'orphaned', to_jsonb(orphaned)
  );
END;
$$;


-- ── 5c. record_schema_versions(category, summary, by, origin) ─
-- Append a version row for the category AND every descendant, then
-- stamp the touched items with their own category's new version.
--
-- Descendants are versioned too because THEIR effective schema changed
-- as well; a timeline that only recorded the edited node would lie by
-- omission. Untouched items keep their old schema_version on purpose —
-- that is what makes "12 items were written against v3" meaningful.
--
-- Returns the version number written for the target category.
CREATE OR REPLACE FUNCTION public.record_schema_versions(
  p_category_id UUID,
  p_summary     JSONB,
  p_changed_by  UUID,
  p_touched     UUID[],
  p_origin      JSONB DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  summary     JSONB := COALESCE(p_summary, '[]'::jsonb);
  subtree_ids UUID[];
  cat_id      UUID;
  new_ver     INT;
  target_ver  INT;
BEGIN
  IF p_origin IS NOT NULL THEN
    summary := jsonb_build_array(p_origin) || summary;
  END IF;

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  FOR cat_id IN SELECT s.id FROM public.get_category_subtree(p_category_id) s
  LOOP
    SELECT COALESCE(MAX(sv.version), 0) + 1 INTO new_ver
    FROM public.schema_versions sv WHERE sv.category_id = cat_id;

    INSERT INTO public.schema_versions
      (category_id, version, snapshot, authored, change_summary, changed_by)
    SELECT cat_id,
           new_ver,
           public.get_effective_schema(c.id),
           jsonb_build_object('own_fields', c.own_fields, 'overrides', c.overrides),
           summary,
           p_changed_by
    FROM public.categories c WHERE c.id = cat_id;

    IF cat_id = p_category_id THEN
      target_ver := new_ver;
    END IF;
  END LOOP;

  IF COALESCE(array_length(p_touched, 1), 0) > 0 THEN
    UPDATE public.items i
       SET schema_version = v.max_ver
      FROM (
        SELECT sv.category_id, MAX(sv.version) AS max_ver
        FROM public.schema_versions sv
        WHERE sv.category_id = ANY(subtree_ids)
        GROUP BY sv.category_id
      ) v
     WHERE i.category_id = v.category_id
       AND i.id = ANY(p_touched);
  END IF;

  RETURN target_ver;
END;
$$;


-- ── 5d. require_schema_admin() ───────────────────────────────
-- RLS already blocks a non-admin from writing categories, but a policy
-- that filters rows produces a silent no-op UPDATE, not an error. Fail
-- loudly instead.
--
-- A NULL auth.uid() means there is no JWT. That is legitimate from the
-- SQL editor, a migration or the service role — they are the table owner,
-- already bypass RLS, and the suites in supabase/tests/ depend on it.
-- It is NOT legitimate from PostgREST: Postgres grants EXECUTE on new
-- functions to PUBLIC by default, so an unauthenticated caller really can
-- reach this function, and "no JWT" must not read as "trusted" there.
-- Distinguish the two by the connection role rather than trusting the
-- table-grant layer to be the only thing standing in the way.
CREATE OR REPLACE FUNCTION public.require_schema_admin()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Only a SCHEMA_ADMIN may change the schema.';
    END IF;
    RETURN;  -- owner / service_role / SQL editor
  END IF;

  IF public.get_user_role() IS DISTINCT FROM 'SCHEMA_ADMIN' THEN
    RAISE EXCEPTION 'Only a SCHEMA_ADMIN may change the schema.';
  END IF;
END;
$$;


-- ============================================================
-- 6. apply_schema_change(...)  → JSONB
-- ------------------------------------------------------------
-- Execute a schema change with an explicit remediation for every
-- destructive consequence. ONE transaction: a plpgsql function body
-- is atomic, so any RAISE below leaves the database exactly as it
-- was found. A half-applied schema migration is the worst possible
-- outcome; this function is structured so it cannot happen.
--
-- p_remediations: { "<field_key>": { "strategy": …, "value": …, "confirm": … } }
--   A field with two changes at once (say retype + require) can be
--   addressed separately with the key "<field_key>:<kind>", which is
--   tried first and falls back to the plain field key.
--
-- Strategies
--   backfill  write `value` into every affected item missing the key
--   cast      convert to the new type; values that fail go to __orphaned
--   orphan    move values to data.__orphaned.<key>, preserving them
--   discard   hard-delete the key. Requires "confirm": true. Never a default.
--   leave     do nothing; affected items simply read as incomplete
--
-- Returns { version, items_updated, items_orphaned, items_incomplete }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_schema_change(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB,
  p_remediations   JSONB DEFAULT '{}'::jsonb,
  p_changed_by     UUID  DEFAULT NULL,
  -- Prepended to change_summary when the caller is not a plain edit.
  -- rollback_schema_version() uses it to mark its forward version.
  p_origin         JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  analysis     JSONB;
  outcome      JSONB;
  subtree_ids  UUID[];
  touched      UUID[];
  orphaned     UUID[];
  target_ver   INT;
  n_incomplete INT := 0;
BEGIN
  PERFORM public.require_schema_admin();

  -- ── 1. Re-analyse INSIDE the transaction ──────────────────
  -- The dialog's analysis may be seconds or minutes old, and the tree
  -- can have moved underneath it. This one is authoritative.
  analysis := public.analyze_schema_change(p_category_id, p_new_own_fields, p_new_overrides);

  IF (analysis->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Change rejected: %', COALESCE(analysis->>'blocked_reason', 'unknown reason');
  END IF;

  -- ── 2. Validate the whole remediation plan up front ───────
  PERFORM public.validate_remediations(analysis->'changes', p_remediations);

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  -- ── 3. Write the new schema ───────────────────────────────
  -- The Phase 1 integrity triggers fire here and are the last line of
  -- defence: anything analyze_schema_change failed to catch aborts the
  -- whole transaction rather than landing.
  UPDATE public.categories
     SET own_fields = COALESCE(p_new_own_fields, own_fields),
         overrides  = COALESCE(p_new_overrides,  overrides)
   WHERE id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % not found, or not writable by this user.', p_category_id;
  END IF;

  -- ── 4. Remediate item data across the affected subtree ────
  outcome := public.apply_remediations(subtree_ids, analysis->'changes', p_remediations);

  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::UUID[]) INTO touched
  FROM jsonb_array_elements_text(outcome->'touched');
  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::UUID[]) INTO orphaned
  FROM jsonb_array_elements_text(outcome->'orphaned');

  -- ── 5. Version the category AND every descendant ──────────
  target_ver := public.record_schema_versions(
    p_category_id, outcome->'changes', p_changed_by, touched, p_origin);

  -- ── 6. Report ─────────────────────────────────────────────
  n_incomplete := COALESCE(
    (public.get_item_health_counts(p_category_id, true)->>'incomplete')::int, 0);

  RETURN jsonb_build_object(
    'category_id',      p_category_id,
    'version',          target_ver,
    'items_updated',    COALESCE(array_length(touched, 1), 0),
    'items_orphaned',   COALESCE(array_length(orphaned, 1), 0),
    'items_incomplete', n_incomplete,
    'change_summary',   outcome->'changes'
  );
END;
$$;


-- ============================================================
-- 7. rollback_schema_version(category, target_version)  → JSONB
-- ------------------------------------------------------------
-- Restore a category's authored schema from a recorded version and
-- write a NEW FORWARD version describing the restore.
--
-- History is never rewritten. An audit trail that can be edited is not
-- an audit trail — rolling back v5 to v3 produces v6, and v4 and v5
-- remain readable forever.
--
-- ITEM DATA IS NOT REVERTED. Restoring the shape of the schema cannot
-- resurrect values a migration converted or orphaned; those live in
-- data.__orphaned and are restored from the Items tab. The confirm
-- dialog must say this plainly.
--
-- Remediations are chosen automatically and always preserve data:
-- retypes cast (failures orphan), everything else orphans. `discard`
-- is unreachable from here by design.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rollback_schema_version(
  p_category_id    UUID,
  p_target_version INT,
  p_changed_by     UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  src        RECORD;
  cur_ver    INT;
  restore_own  JSONB;
  restore_over JSONB;
  analysis   JSONB;
  ch         JSONB;
  rems       JSONB := '{}'::jsonb;
  result     JSONB;
BEGIN
  SELECT sv.version, sv.authored INTO src
  FROM public.schema_versions sv
  WHERE sv.category_id = p_category_id AND sv.version = p_target_version;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No version % recorded for this category.', p_target_version;
  END IF;

  IF NOT (COALESCE(src.authored, '{}'::jsonb) ? 'own_fields') THEN
    RAISE EXCEPTION
      'Version % predates authored-state recording and cannot be restored automatically. Its snapshot is still readable in the history tab.',
      p_target_version;
  END IF;

  SELECT COALESCE(MAX(sv.version), 0) INTO cur_ver
  FROM public.schema_versions sv WHERE sv.category_id = p_category_id;

  IF p_target_version = cur_ver THEN
    RAISE EXCEPTION 'Version % is already the current schema.', p_target_version;
  END IF;

  restore_own  := COALESCE(src.authored->'own_fields', '[]'::jsonb);
  restore_over := COALESCE(src.authored->'overrides',  '{}'::jsonb);

  -- Auto-remediate: never lose a value on the way back.
  analysis := public.analyze_schema_change(p_category_id, restore_own, restore_over);
  IF (analysis->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Cannot restore version %: %',
      p_target_version, COALESCE(analysis->>'blocked_reason', 'unknown reason');
  END IF;

  FOR ch IN SELECT value FROM jsonb_array_elements(analysis->'changes')
  LOOP
    CONTINUE WHEN ch->>'severity' <> 'destructive';
    rems := rems || jsonb_build_object(
      (ch->>'field_key') || ':' || (ch->>'kind'),
      CASE WHEN ch->>'kind' = 'retype_field'
           THEN '{"strategy":"cast"}'::jsonb
           ELSE '{"strategy":"orphan"}'::jsonb END
    );
  END LOOP;

  result := public.apply_schema_change(
    p_category_id, restore_own, restore_over, rems, p_changed_by,
    jsonb_build_object(
      'kind',                'rollback',
      'field_key',           '__schema',
      'severity',            'warning',
      'from',                cur_ver,
      'to',                  p_target_version,
      'affected_item_count', 0
    )
  );

  RETURN result || jsonb_build_object('restored_from', p_target_version);
END;
$$;


-- ============================================================
-- 8. analyze_category_move(category, new_parent)  → JSONB
-- ------------------------------------------------------------
-- READ-ONLY. Same return shape as analyze_schema_change(), so the same
-- impact dialog renders it.
--
-- Re-parenting is not a "different kind" of change from editing a
-- schema — it swaps the entire inherited half of the subtree's schema
-- in one move. Routing it through the same analysis is what stops
-- "this will break things" from being explained two different ways in
-- two different dialogs.
--
-- The moved category's OWN fields travel with it untouched; only what
-- it inherits changes. Descendants inherit through this node, so the
-- lost/gained set is the same for them — which is why item counts are
-- measured across the whole moved subtree.
-- ============================================================
CREATE OR REPLACE FUNCTION public.analyze_category_move(
  p_category_id   UUID,
  p_new_parent_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  cur_schema   JSONB;
  next_schema  JSONB := '[]'::jsonb;
  v_own_fields JSONB;
  v_overrides  JSONB;
  parent_eff   JSONB := '[]'::jsonb;
  subtree_ids  UUID[];
  subtree_keys TEXT[];
  parent_keys  TEXT[];
  affected     JSONB := '[]'::jsonb;
  changes      JSONB := '[]'::jsonb;
  cur_ver      INT;
  total_items  INT := 0;
  max_sev      TEXT := 'safe';
  blocked      BOOLEAN := false;
  reason       TEXT := NULL;
  fld          JSONB;
  before_f     JSONB;
  after_f      JSONB;
  k            TEXT;
  o_key        TEXT;
  n_affected   INT;
  samples      JSONB;
  clash        TEXT;
  cat_name     TEXT;
BEGIN
  SELECT c.own_fields, c.overrides, c.name
    INTO v_own_fields, v_overrides, cat_name
  FROM public.categories c WHERE c.id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % not found.', p_category_id;
  END IF;

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  -- ── Blocking conditions ───────────────────────────────────
  IF p_new_parent_id = p_category_id THEN
    blocked := true;
    reason := 'A category cannot be its own parent.';
  ELSIF p_new_parent_id IS NOT NULL AND p_new_parent_id = ANY(subtree_ids) THEN
    blocked := true;
    reason := 'That destination sits inside this subtree, which would create a cycle.';
  END IF;

  IF p_new_parent_id IS NOT NULL THEN
    parent_eff := public.get_effective_schema(p_new_parent_id);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT e->>'key'), ARRAY[]::TEXT[]) INTO parent_keys
  FROM jsonb_array_elements(parent_eff) e;

  -- Every key AUTHORED anywhere in the moving subtree. A field cannot
  -- be both inherited and redefined, so a clash makes the move
  -- impossible — the trigger would reject it, and learning that from a
  -- trigger error after the fact is a poor way to find out.
  SELECT COALESCE(array_agg(DISTINCT df.elem->>'key'), ARRAY[]::TEXT[]) INTO subtree_keys
  FROM public.categories c
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(c.own_fields, '[]'::jsonb)) AS df(elem)
  WHERE c.id = ANY(subtree_ids);

  IF NOT blocked THEN
    SELECT x INTO clash FROM unnest(parent_keys) x WHERE x = ANY(subtree_keys) LIMIT 1;
    IF clash IS NOT NULL THEN
      blocked := true;
      reason := format(
        '"%s" is defined inside this subtree and would also be inherited from the new parent. A field cannot be both — rename or remove it first.',
        clash);
    END IF;
  END IF;

  -- ── Resolve before / after ────────────────────────────────
  cur_schema := public.get_effective_schema(p_category_id);

  IF blocked THEN
    next_schema := cur_schema;
  ELSE
    -- Inherited half: the new parent's effective schema, one level
    -- further from the target than it is from the parent.
    SELECT COALESCE(jsonb_agg(
             e || jsonb_build_object(
               'depth',     (e->>'depth')::int + 1,
               'inherited', true)
           ), '[]'::jsonb)
      INTO next_schema
    FROM jsonb_array_elements(parent_eff) e;

    -- Own half: unchanged, at depth 0.
    FOR fld IN SELECT value FROM jsonb_array_elements(COALESCE(v_own_fields, '[]'::jsonb))
    LOOP
      next_schema := next_schema || jsonb_build_array(
        fld || jsonb_build_object(
          'source_category_id',   p_category_id,
          'source_category_name', cat_name,
          'depth',                0,
          'inherited',            false,
          'overridden_by',        '[]'::jsonb
        )
      );
    END LOOP;

    -- An override only survives if its key is still inherited. One
    -- that is not blocks the move rather than being silently dropped —
    -- dropping it would change the schema without saying so.
    FOR o_key IN SELECT key FROM jsonb_each(COALESCE(v_overrides, '{}'::jsonb))
    LOOP
      IF NOT (o_key = ANY(parent_keys)) THEN
        blocked := true;
        reason := format(
          'This category overrides "%s", which the new parent does not provide. Remove the override before moving.',
          o_key);
        next_schema := cur_schema;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- ── Affected set and current version ──────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'depth', s.depth,
           'item_count', (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id)
         ) ORDER BY s.depth, c.name), '[]'::jsonb),
         COALESCE(sum((SELECT count(*) FROM public.items i WHERE i.category_id = c.id)), 0)::int
    INTO affected, total_items
  FROM public.get_category_subtree(p_category_id) s
  JOIN public.categories c ON c.id = s.id;

  SELECT COALESCE(MAX(version), 0) INTO cur_ver
  FROM public.schema_versions WHERE category_id = p_category_id;

  -- ── Diff: what is gained, what is lost ────────────────────
  IF NOT blocked THEN
    -- GAINED
    FOR after_f IN SELECT value FROM jsonb_array_elements(next_schema)
    LOOP
      k := after_f->>'key';
      SELECT e INTO before_f FROM jsonb_array_elements(cur_schema) e WHERE e->>'key' = k;
      CONTINUE WHEN before_f IS NOT NULL;

      IF COALESCE((after_f->>'required')::boolean, false) THEN
        SELECT count(*)::int INTO n_affected
        FROM public.items i
        WHERE i.category_id = ANY(subtree_ids)
          AND (NOT (i.data ? k) OR i.data->>k IS NULL OR btrim(i.data->>k) = '');

        changes := changes || jsonb_build_array(jsonb_build_object(
          'kind', 'add_field', 'field_key', k, 'severity', 'warning',
          'to', after_f, 'affected_item_count', n_affected, 'sample_values', '[]'::jsonb
        ));
        IF max_sev = 'safe' THEN max_sev := 'warning'; END IF;
      ELSE
        changes := changes || jsonb_build_array(jsonb_build_object(
          'kind', 'add_field', 'field_key', k, 'severity', 'safe',
          'to', after_f, 'affected_item_count', 0
        ));
      END IF;
    END LOOP;

    -- LOST — the whole point of the dialog.
    FOR before_f IN SELECT value FROM jsonb_array_elements(cur_schema)
    LOOP
      k := before_f->>'key';
      SELECT e INTO after_f FROM jsonb_array_elements(next_schema) e WHERE e->>'key' = k;
      CONTINUE WHEN after_f IS NOT NULL;

      SELECT count(*)::int INTO n_affected
      FROM public.items i
      WHERE i.category_id = ANY(subtree_ids)
        AND i.data ? k AND i.data->>k IS NOT NULL AND btrim(i.data->>k) <> '';

      SELECT COALESCE(jsonb_agg(v), '[]'::jsonb) INTO samples
      FROM (
        SELECT DISTINCT i.data->k AS v
        FROM public.items i
        WHERE i.category_id = ANY(subtree_ids)
          AND i.data ? k AND i.data->>k IS NOT NULL AND btrim(i.data->>k) <> ''
        LIMIT 5
      ) s;

      changes := changes || jsonb_build_array(jsonb_build_object(
        'kind', 'remove_field', 'field_key', k, 'severity', 'destructive',
        'from', before_f, 'affected_item_count', n_affected, 'sample_values', samples
      ));
      max_sev := 'destructive';
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'category_id',          p_category_id,
    'new_parent_id',        p_new_parent_id,
    'current_version',      cur_ver,
    'next_version',         cur_ver + 1,
    'affected_categories',  affected,
    'total_affected_items', total_items,
    'changes',              changes,
    'max_severity',         CASE WHEN jsonb_array_length(changes) = 0 THEN 'safe' ELSE max_sev END,
    'blocked',              blocked,
    'blocked_reason',       reason
  );
END;
$$;


-- ============================================================
-- 9. apply_category_move(category, new_parent, remediations, by)
-- ------------------------------------------------------------
-- Re-parent a category and reconcile item data in ONE transaction,
-- through exactly the same validation and remediation machinery as a
-- schema edit.
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_category_move(
  p_category_id   UUID,
  p_new_parent_id UUID,
  p_remediations  JSONB DEFAULT '{}'::jsonb,
  p_changed_by    UUID  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  analysis     JSONB;
  outcome      JSONB;
  subtree_ids  UUID[];
  touched      UUID[];
  orphaned     UUID[];
  old_parent   UUID;
  target_ver   INT;
  n_incomplete INT := 0;
BEGIN
  PERFORM public.require_schema_admin();

  analysis := public.analyze_category_move(p_category_id, p_new_parent_id);

  IF (analysis->>'blocked')::boolean THEN
    RAISE EXCEPTION 'Move rejected: %', COALESCE(analysis->>'blocked_reason', 'unknown reason');
  END IF;

  PERFORM public.validate_remediations(analysis->'changes', p_remediations);

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  SELECT c.parent_id INTO old_parent FROM public.categories c WHERE c.id = p_category_id;

  -- Remediate BEFORE the move, while get_effective_schema() still
  -- returns the chain the analysis measured against.
  outcome := public.apply_remediations(subtree_ids, analysis->'changes', p_remediations);

  UPDATE public.categories SET parent_id = p_new_parent_id WHERE id = p_category_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % not found, or not writable by this user.', p_category_id;
  END IF;

  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::UUID[]) INTO touched
  FROM jsonb_array_elements_text(outcome->'touched');
  SELECT COALESCE(array_agg(value::uuid), ARRAY[]::UUID[]) INTO orphaned
  FROM jsonb_array_elements_text(outcome->'orphaned');

  target_ver := public.record_schema_versions(
    p_category_id, outcome->'changes', p_changed_by, touched,
    jsonb_build_object(
      'kind',                'reparent',
      'field_key',           '__parent',
      'severity',            CASE WHEN analysis->>'max_severity' = 'destructive'
                                  THEN 'destructive' ELSE 'warning' END,
      'from',                old_parent,
      'to',                  p_new_parent_id,
      'affected_item_count', (analysis->>'total_affected_items')::int
    ));

  n_incomplete := COALESCE(
    (public.get_item_health_counts(p_category_id, true)->>'incomplete')::int, 0);

  RETURN jsonb_build_object(
    'category_id',      p_category_id,
    'version',          target_ver,
    'items_updated',    COALESCE(array_length(touched, 1), 0),
    'items_orphaned',   COALESCE(array_length(orphaned, 1), 0),
    'items_incomplete', n_incomplete,
    'change_summary',   outcome->'changes'
  );
END;
$$;


-- ============================================================
-- 10. preview_category_delete(category)  → JSONB
-- ------------------------------------------------------------
-- READ-ONLY. What a delete would destroy, and whether the items could
-- be rescued to the parent instead.
--
-- `common_field_count` is the honest part: moving items to the parent
-- carries only the values whose keys exist in BOTH schemas. Saying
-- "48 items will be moved" without saying "and each keeps 3 of its 9
-- values, the rest becoming orphaned data" would be a half-truth.
-- ============================================================
CREATE OR REPLACE FUNCTION public.preview_category_delete(p_category_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent_id   UUID;
  parent_name   TEXT;
  subtree_ids   UUID[];
  n_categories  INT;
  n_items       INT;
  own_keys      TEXT[];
  parent_keys   TEXT[];
  carried       TEXT[];
  lost          TEXT[];
BEGIN
  SELECT c.parent_id INTO v_parent_id FROM public.categories c WHERE c.id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % not found.', p_category_id;
  END IF;

  SELECT c.name INTO parent_name FROM public.categories c WHERE c.id = v_parent_id;

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  n_categories := COALESCE(array_length(subtree_ids, 1), 0);

  SELECT count(*)::int INTO n_items
  FROM public.items i WHERE i.category_id = ANY(subtree_ids);

  -- Keys anywhere in the doomed subtree, versus keys the parent offers.
  SELECT COALESCE(array_agg(DISTINCT e->>'key'), ARRAY[]::TEXT[]) INTO own_keys
  FROM unnest(subtree_ids) AS t(cid)
  CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(t.cid)) e;

  IF v_parent_id IS NOT NULL THEN
    SELECT COALESCE(array_agg(DISTINCT e->>'key'), ARRAY[]::TEXT[]) INTO parent_keys
    FROM jsonb_array_elements(public.get_effective_schema(v_parent_id)) e;
  ELSE
    parent_keys := ARRAY[]::TEXT[];
  END IF;

  SELECT COALESCE(array_agg(x), ARRAY[]::TEXT[]) INTO carried
  FROM unnest(own_keys) x WHERE x = ANY(parent_keys);

  SELECT COALESCE(array_agg(x), ARRAY[]::TEXT[]) INTO lost
  FROM unnest(own_keys) x WHERE NOT (x = ANY(parent_keys));

  RETURN jsonb_build_object(
    'category_id',        p_category_id,
    'parent_id',          v_parent_id,
    'parent_name',        parent_name,
    'descendant_count',   GREATEST(n_categories - 1, 0),
    'item_count',         n_items,
    'can_move_to_parent', v_parent_id IS NOT NULL,
    'carried_keys',       to_jsonb(carried),
    'orphaned_keys',      to_jsonb(lost)
  );
END;
$$;


-- ============================================================
-- 11. delete_category_safely(category, move_items_to_parent)
-- ------------------------------------------------------------
-- ON DELETE CASCADE means deleting Electronics destroys every category
-- beneath it AND all of their items. That is sometimes exactly what is
-- wanted and sometimes catastrophic, so the alternative lives in the
-- same transaction:
--
--   p_move_items_to_parent = true  → every item in the subtree moves to
--     the parent first via move_items(), which reconciles each item's
--     data against the parent's schema and preserves whatever does not
--     fit as orphaned data. THEN the categories go.
--
--   false → plain cascade.
--
-- Returns { deleted_categories, moved_items, orphaned_values, deleted_items }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_category_safely(
  p_category_id          UUID,
  p_move_items_to_parent BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent_id  UUID;
  subtree_ids  UUID[];
  item_ids     UUID[];
  n_categories INT;
  n_items      INT;
  n_moved      INT := 0;
  move_result  JSONB := jsonb_build_object('moved', 0, 'carried', 0, 'orphaned', 0);
BEGIN
  PERFORM public.require_schema_admin();

  SELECT c.parent_id INTO v_parent_id FROM public.categories c WHERE c.id = p_category_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category % not found.', p_category_id;
  END IF;

  SELECT COALESCE(array_agg(s.id), ARRAY[]::UUID[]) INTO subtree_ids
  FROM public.get_category_subtree(p_category_id) s;

  SELECT COALESCE(array_agg(i.id), ARRAY[]::UUID[]) INTO item_ids
  FROM public.items i WHERE i.category_id = ANY(subtree_ids);

  n_categories := COALESCE(array_length(subtree_ids, 1), 0);
  n_items      := COALESCE(array_length(item_ids, 1), 0);

  IF p_move_items_to_parent THEN
    IF v_parent_id IS NULL THEN
      RAISE EXCEPTION
        'This is a root category — there is no parent to move its % item(s) to.', n_items;
    END IF;
    IF n_items > 0 THEN
      move_result := public.move_items(item_ids, v_parent_id);
      n_moved := COALESCE((move_result->>'moved')::int, 0);
    END IF;
  END IF;

  -- CASCADE takes the descendants, and any item still sitting on them.
  DELETE FROM public.categories WHERE id = p_category_id;

  RETURN jsonb_build_object(
    'deleted_categories', n_categories,
    'moved_items',        n_moved,
    'orphaned_values',    COALESCE((move_result->>'orphaned')::int, 0),
    'deleted_items',      n_items - n_moved
  );
END;
$$;


-- ████████████████████████████████████████████████████████████
-- ██  supabase/attributes.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Attribute Registry (Phase 6, Increment 1)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql.
--
-- WHY THIS EXISTS
-- Today `brand` is defined independently on Electronics, Clothing and
-- Home & Kitchen: three unrelated strings that happen to spell the same
-- word. So "show me everything by Sony, anywhere in the catalog" is
-- unanswerable — not because the query is hard, but because the data
-- model never asserted those three fields were the same thing.
--
-- The attribute registry makes that assertion. A category's own_fields
-- entry carries `attribute_id`, and that back-link is what turns three
-- coincidences into one queryable concept.
--
-- ── SYNC SEMANTICS (settled once, here) ─────────────────────
-- Editing an attribute's label / options / unit / description
--   → PROPAGATES to every linked field, immediately, by trigger.
--     These are presentation. No stored item value can be invalidated
--     by them, so there is no blast radius worth showing.
--
-- Editing an attribute's `key` or `type`
--   → REJECTED outright.
--     A global retype could touch thousands of items across unrelated
--     categories at once, and there is no single blast radius to
--     render for that — "this affects 9 categories and 1,400 items,
--     good luck" is not a decision anyone can make. Type changes go
--     through Phase 5's per-category impact flow instead, one category
--     at a time, each with its own remediation. The key is immutable
--     for the same reason item data is keyed on it.
-- ============================================================


-- ============================================================
-- 1. Registry columns
-- ------------------------------------------------------------
-- `group_name` is presentational only ("Physical", "Commercial") —
-- deliberately not a table, because a lookup table for four strings
-- buys nothing and costs a join everywhere.
--
-- `is_system` marks attributes the app itself relies on, so the UI can
-- refuse to delete them without hard-coding a list of keys.
-- ============================================================
ALTER TABLE public.attributes
  ADD COLUMN IF NOT EXISTS group_name TEXT,
  ADD COLUMN IF NOT EXISTS is_system  BOOLEAN NOT NULL DEFAULT false;

-- The same eight types own_fields accepts. Kept as a CHECK rather than
-- a trigger so a bad type cannot be written by any path at all.
ALTER TABLE public.attributes DROP CONSTRAINT IF EXISTS attributes_type_valid;
ALTER TABLE public.attributes ADD CONSTRAINT attributes_type_valid
  CHECK (type IN ('string','text','number','boolean','date','select','multiselect','url'));

ALTER TABLE public.attributes DROP CONSTRAINT IF EXISTS attributes_key_grammar;
ALTER TABLE public.attributes ADD CONSTRAINT attributes_key_grammar
  CHECK (key ~ '^[a-z][a-z0-9_]*$');

CREATE INDEX IF NOT EXISTS idx_attributes_group ON public.attributes (group_name, label);


-- ============================================================
-- 2. get_attribute_usage(p_attribute_id)  → JSONB[]
-- ------------------------------------------------------------
-- Every category whose own_fields links to this attribute, with the
-- field key it uses and its item counts.
--
-- INDEX NOTE: the predicate is written as a jsonb `@>` containment
-- against own_fields specifically so the existing
-- idx_categories_own_fields (GIN, jsonb_ops) can serve it. Writing the
-- obvious `EXISTS (SELECT 1 FROM jsonb_array_elements(...) WHERE
-- elem->>'attribute_id' = ...)` is equivalent and unindexable — it
-- forces a seq scan plus an unnest of every category's field array.
-- Verify with:
--
--   SET enable_seqscan = off;
--   EXPLAIN ANALYZE SELECT * FROM public.categories
--    WHERE own_fields @> '[{"attribute_id":"<uuid>"}]'::jsonb;
--
-- and confirm a Bitmap Index Scan on idx_categories_own_fields. At
-- current row counts the planner will often choose a seq scan anyway
-- because it is genuinely cheaper; that is correct behaviour, and the
-- point is that the index REMAINS available as the catalog grows.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attribute_usage(p_attribute_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.category_name), '[]'::jsonb)
  FROM (
    SELECT c.id                AS category_id,
           c.name              AS category_name,
           c.icon              AS category_icon,
           c.color             AS category_color,
           f.elem->>'key'      AS field_key,
           (f.elem->>'required')::boolean AS required,
           (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id) AS item_count,
           public.count_subtree_items(c.id) AS subtree_item_count
    FROM public.categories c
    CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
    WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', p_attribute_id))
      AND f.elem->>'attribute_id' = p_attribute_id::text
  ) x;
$$;


-- ============================================================
-- 3. get_attributes_with_usage()  → JSONB[]
-- ------------------------------------------------------------
-- The whole library plus a usage count per attribute, in one call, so
-- the list rail does not N+1 across the registry.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_attributes_with_usage()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY x.group_name NULLS LAST, x.label), '[]'::jsonb)
  FROM (
    SELECT a.id, a.key, a.label, a.type, a.options, a.unit, a.description,
           a.group_name, a.is_system, a.created_at, a.updated_at,
           (SELECT count(*)::int
              FROM public.categories c
             WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', a.id))
           ) AS category_count,
           (SELECT COALESCE(sum(sub.n), 0)::int FROM (
              SELECT (SELECT count(*) FROM public.items i WHERE i.category_id = c.id) AS n
                FROM public.categories c
               WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', a.id))
            ) sub) AS item_count
    FROM public.attributes a
  ) x;
$$;


-- ============================================================
-- 4. find_duplicate_field_definitions()  → JSONB[]
-- ------------------------------------------------------------
-- Field keys authored on 2+ categories that are NOT yet linked to an
-- attribute — the candidates for promotion.
--
-- This is how the library gets populated. Asking someone to sit down
-- and model their attributes before they have any data is how you get
-- an empty registry; showing them "you have written `brand` three
-- times, want to make it one thing?" is how you get a full one.
--
-- `types_agree` matters: promoting a key defined as `string` on one
-- category and `number` on another would have to coerce one of them,
-- and coercing silently is exactly what this project refuses to do.
-- Each entry reports the disagreement so the UI can say so.
--
-- Each entry:
--   { key, label, type, types_agree, types, category_count,
--     item_count, categories: [{ id, name, type, item_count }] }
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_duplicate_field_definitions()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH authored AS (
    SELECT c.id                       AS category_id,
           c.name                     AS category_name,
           f.elem->>'key'             AS field_key,
           f.elem->>'label'           AS field_label,
           f.elem->>'type'            AS field_type,
           f.elem->>'attribute_id'    AS attribute_id,
           (SELECT count(*)::int FROM public.items i WHERE i.category_id = c.id) AS item_count
    FROM public.categories c
    CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
  ),
  -- A key is a candidate only if NO definition of it is linked yet.
  -- Once one is promoted the rest are back-linked by
  -- promote_field_to_attribute, so a partially-linked key means someone
  -- is mid-migration and does not need nagging about it.
  unlinked AS (
    SELECT field_key
    FROM authored
    GROUP BY field_key
    HAVING count(*) > 1 AND count(attribute_id) = 0
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.category_count DESC, x.key), '[]'::jsonb)
  FROM (
    SELECT a.field_key                              AS key,
           min(a.field_label)                       AS label,
           mode() WITHIN GROUP (ORDER BY a.field_type) AS type,
           count(DISTINCT a.field_type) = 1         AS types_agree,
           to_jsonb(array_agg(DISTINCT a.field_type)) AS types,
           count(*)::int                            AS category_count,
           sum(a.item_count)::int                   AS item_count,
           jsonb_agg(jsonb_build_object(
             'id',         a.category_id,
             'name',       a.category_name,
             'type',       a.field_type,
             'item_count', a.item_count
           ) ORDER BY a.category_name)              AS categories
    FROM authored a
    JOIN unlinked u ON u.field_key = a.field_key
    GROUP BY a.field_key
  ) x;
$$;


-- ============================================================
-- 5. promote_field_to_attribute(category, field_key, group_name)
-- ------------------------------------------------------------
-- Create an attribute from an existing field and back-link every
-- matching field across the catalog WHOSE TYPE MATCHES.
--
-- Type mismatches are reported, never coerced. Rewriting a category's
-- `number` field to `string` because a different category happened to
-- spell the key the same way would be a schema change with real item
-- consequences, smuggled in under the word "promote".
--
-- Returns { attribute_id, key, linked, skipped: [{ id, name, type }] }.
-- ============================================================
CREATE OR REPLACE FUNCTION public.promote_field_to_attribute(
  p_category_id UUID,
  p_field_key   TEXT,
  p_group_name  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  src        JSONB;
  v_attr_id  UUID;
  v_type     TEXT;
  linked     INT := 0;
  skipped    JSONB := '[]'::jsonb;
  targets    JSONB;
  cat        JSONB;
BEGIN
  PERFORM public.require_schema_admin();

  -- The field being promoted, as authored on the source category.
  SELECT f.elem INTO src
  FROM public.categories c
  CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
  WHERE c.id = p_category_id AND f.elem->>'key' = p_field_key;

  IF src IS NULL THEN
    RAISE EXCEPTION 'Category % does not define a field called "%".', p_category_id, p_field_key;
  END IF;

  v_type := src->>'type';

  IF EXISTS (SELECT 1 FROM public.attributes a WHERE a.key = p_field_key) THEN
    RAISE EXCEPTION
      'An attribute called "%" already exists. Link the field to it instead of promoting again.',
      p_field_key;
  END IF;

  INSERT INTO public.attributes (key, label, type, options, unit, description, group_name)
  VALUES (
    p_field_key,
    COALESCE(src->>'label', p_field_key),
    v_type,
    COALESCE(src->'options', '[]'::jsonb),
    src->>'unit',
    src->>'help_text',
    p_group_name
  )
  RETURNING id INTO v_attr_id;

  -- Collect the targets BEFORE writing any of them. Iterating a cursor
  -- over the same table the loop body updates is the kind of thing that
  -- works until it doesn't; materialising the list first makes the set
  -- unambiguous.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name, 'type', f.elem->>'type')), '[]'::jsonb)
    INTO targets
  FROM public.categories c
  CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
  WHERE f.elem->>'key' = p_field_key;

  -- One statement per category rather than one big rewrite, because
  -- each write has to pass validate_category_fields on its own.
  FOR cat IN SELECT value FROM jsonb_array_elements(targets)
  LOOP
    IF cat->>'type' IS DISTINCT FROM v_type THEN
      skipped := skipped || jsonb_build_array(cat);
      CONTINUE;
    END IF;

    UPDATE public.categories c
       SET own_fields = (
             SELECT jsonb_agg(
                      CASE WHEN e->>'key' = p_field_key
                           THEN e || jsonb_build_object('attribute_id', v_attr_id)
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(c.own_fields) WITH ORDINALITY AS t(e, ord)
           )
     WHERE c.id = (cat->>'id')::uuid;

    linked := linked + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'attribute_id', v_attr_id,
    'key',          p_field_key,
    'type',         v_type,
    'linked',       linked,
    'skipped',      skipped
  );
END;
$$;


-- ============================================================
-- 6. Sync: propagate presentation, refuse structure
-- ------------------------------------------------------------
-- See the header for the reasoning. In short: label/options/unit/
-- description are presentation and propagate; key/type are structure
-- and are rejected, because a global retype has no single blast radius
-- to show and Phase 5's per-category flow does.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_attribute_to_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  patch   JSONB := '{}'::jsonb;
  targets UUID[];
  cat_id  UUID;
BEGIN
  -- ── Structure is immutable ────────────────────────────────
  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION
      'An attribute key cannot change: item data is stored against "%". Create a new attribute and migrate the categories that use it.',
      OLD.key;
  END IF;

  IF NEW.type IS DISTINCT FROM OLD.type THEN
    RAISE EXCEPTION
      'An attribute type cannot change globally (% → %). It is used by % categor(y/ies), and a single retype gives no blast radius anyone can assess. Change the type on each category''s Schema tab instead, where the impact is measured against that category''s own items.',
      OLD.type, NEW.type,
      (SELECT count(*) FROM public.categories c
        WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', OLD.id)));
  END IF;

  -- ── Presentation propagates ───────────────────────────────
  IF NEW.label IS DISTINCT FROM OLD.label THEN
    patch := patch || jsonb_build_object('label', NEW.label);
  END IF;
  IF NEW.options IS DISTINCT FROM OLD.options THEN
    patch := patch || jsonb_build_object('options', NEW.options);
  END IF;
  IF NEW.unit IS DISTINCT FROM OLD.unit THEN
    patch := patch || jsonb_build_object('unit', NEW.unit);
  END IF;
  IF NEW.description IS DISTINCT FROM OLD.description THEN
    patch := patch || jsonb_build_object('help_text', NEW.description);
  END IF;

  IF patch = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  -- Per-category updates so each one passes validate_category_fields
  -- on its own terms. Removing a select option here can strand item
  -- values, which is why the UI states the propagation count before
  -- saving — the trigger itself cannot ask.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::UUID[]) INTO targets
  FROM public.categories c
  WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', NEW.id));

  FOREACH cat_id IN ARRAY targets LOOP
    UPDATE public.categories c
       SET own_fields = (
             SELECT jsonb_agg(
                      CASE WHEN e->>'attribute_id' = NEW.id::text
                           THEN e || patch
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(c.own_fields) WITH ORDINALITY AS t(e, ord)
           )
     WHERE c.id = cat_id;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attributes_sync_fields ON public.attributes;
CREATE TRIGGER attributes_sync_fields
  BEFORE UPDATE ON public.attributes
  FOR EACH ROW EXECUTE FUNCTION public.sync_attribute_to_fields();


-- ============================================================
-- 7. Unlink on delete
-- ------------------------------------------------------------
-- Deleting an attribute must NOT delete the fields that referenced it.
-- Those fields hold live item data; the link is provenance, exactly as
-- blueprints are. Strip `attribute_id` and leave the field standing.
-- ============================================================
CREATE OR REPLACE FUNCTION public.unlink_attribute_from_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  targets UUID[];
  cat_id  UUID;
BEGIN
  IF OLD.is_system THEN
    RAISE EXCEPTION
      'The "%" attribute is a system attribute and cannot be deleted.', OLD.key;
  END IF;

  -- Materialise first: this loop's UPDATE strips the very key its
  -- predicate matches on, so a cursor over the live table would be
  -- deleting the ground it is standing on.
  SELECT COALESCE(array_agg(c.id), ARRAY[]::UUID[]) INTO targets
  FROM public.categories c
  WHERE c.own_fields @> jsonb_build_array(jsonb_build_object('attribute_id', OLD.id));

  FOREACH cat_id IN ARRAY targets LOOP
    UPDATE public.categories c
       SET own_fields = (
             SELECT jsonb_agg(
                      CASE WHEN e->>'attribute_id' = OLD.id::text
                           THEN e - 'attribute_id'
                           ELSE e END
                      ORDER BY ord)
             FROM jsonb_array_elements(c.own_fields) WITH ORDINALITY AS t(e, ord)
           )
     WHERE c.id = cat_id;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS attributes_unlink_fields ON public.attributes;
CREATE TRIGGER attributes_unlink_fields
  BEFORE DELETE ON public.attributes
  FOR EACH ROW EXECUTE FUNCTION public.unlink_attribute_from_fields();


-- ████████████████████████████████████████████████████████████
-- ██  supabase/search.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Cross-category item search (Phase 6, Increment 3)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql
--                        → attributes.sql.
--
-- The attribute registry asserted that `brand` on Electronics and
-- `brand` on Clothing are the same thing. This is what that assertion
-- buys: one query that spans the whole catalog.
-- ============================================================


-- ============================================================
-- 1. items.search_vector — generated, stored, indexed
-- ------------------------------------------------------------
-- TWO NON-OBVIOUS CHOICES, both load-bearing:
--
-- (a) 'english'::regconfig, explicitly.
--     A generated column requires an IMMUTABLE expression.
--     jsonb_to_tsvector(jsonb, jsonb) — the two-argument form — reads
--     default_text_search_config and is only STABLE, so it is rejected
--     outright. Only the form taking an explicit regconfig is
--     IMMUTABLE. This is not stylistic; the ALTER fails without it.
--
-- (b) `data - '__orphaned'`, not `data`.
--     jsonb_to_tsvector recurses into nested objects, so orphaned
--     values would otherwise be searchable — and finding an item by a
--     value whose field was deleted months ago, with nothing in the
--     result to explain the match, is a bug that looks like magic.
--     Search reflects the LIVE schema. Orphaned values have their own
--     dedicated filter on the Items tab. `jsonb - text` is immutable,
--     so this costs nothing.
--
-- The filter array '["string","numeric"]' selects which jsonb value
-- types are indexed. VERIFY IT rather than trusting this comment —
-- supabase/tests/search_test.sql assertion 1 prints the actual vector
-- for a known row.
-- ============================================================
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    jsonb_to_tsvector(
      'english'::regconfig,
      data - '__orphaned',
      '["string","numeric"]'::jsonb
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_items_search
  ON public.items USING gin (search_vector);


-- ============================================================
-- 2. try_numeric(text) → NUMERIC or NULL
-- ------------------------------------------------------------
-- THE CLASSIC JSONB FOOTGUN.
--
-- `WHERE (data->>'price')::numeric > 500` does not fail on the rows it
-- rejects — it fails on the rows it never meant to touch. One item in
-- one unrelated category holding "call for pricing" in a key that
-- happens to be spelled `price` aborts the entire query with
-- "invalid input syntax for type numeric". Across a catalog-wide
-- search that is not an edge case, it is Tuesday.
--
-- Guarding with a regex rather than a BEGIN/EXCEPTION block keeps the
-- function inlinable and parallel-safe; an exception block would force
-- a subtransaction per row.
-- ============================================================
CREATE OR REPLACE FUNCTION public.try_numeric(p_value TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value ~ '^\s*-?\d+(\.\d+)?([eE][-+]?\d+)?\s*$'
    THEN btrim(p_value)::numeric
  END;
$$;


-- ============================================================
-- 3. get_category_path(category) → TEXT
-- ------------------------------------------------------------
-- "Electronics / Laptops / Gaming Laptops". A search result from an
-- unfamiliar corner of the tree is meaningless without it — the whole
-- point of cross-category search is that you did not know where the
-- item lived.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_category_path(p_category_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT string_agg(a.name, ' / ' ORDER BY a.depth DESC)
  FROM public.get_category_ancestors(p_category_id) a;
$$;


-- ============================================================
-- 4. search_items(query, filters, category, limit, offset)
-- ------------------------------------------------------------
-- Free text plus structured filters, across the whole catalog or one
-- subtree.
--
-- p_filters is a JSONB array of { key, op, value }:
--   eq | neq | gt | gte | lte | lt | contains | starts_with
--   | in | is_null | not_null
--
-- SAFETY: every filter key is validated against the field-key grammar
-- before it is interpolated, and every value goes through %L. A key
-- that does not match is ignored rather than run — a malformed filter
-- should narrow nothing, not execute something.
--
-- `total_count` rides along as a window function so pagination has a
-- total without a second round trip counting the same predicate twice.
-- ============================================================
-- Adding a parameter creates an OVERLOAD rather than replacing, and two
-- candidates make every PostgREST call ambiguous. Drop the old shape.
DROP FUNCTION IF EXISTS public.search_items(TEXT, JSONB, UUID, INT, INT);

CREATE OR REPLACE FUNCTION public.search_items(
  p_query       TEXT  DEFAULT NULL,
  p_filters     JSONB DEFAULT '[]'::jsonb,
  p_category_id UUID  DEFAULT NULL,
  p_limit       INT   DEFAULT 50,
  p_offset      INT   DEFAULT 0,
  -- FALSE restricts to the category itself rather than its descendants.
  -- The Items tab needs this: it can show one category's own rows, and
  -- an export that quietly included the whole subtree would hand back
  -- more than the screen showed.
  p_include_subtree BOOLEAN DEFAULT true
)
RETURNS TABLE (
  id            UUID,
  category_id   UUID,
  category_name TEXT,
  category_path TEXT,
  data          JSONB,
  rank          REAL,
  total_count   BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  key_re    CONSTANT TEXT := '^[a-z][a-z0-9_]*$';
  where_sql TEXT := 'TRUE';
  rank_sql  TEXT := '0::real';
  order_sql TEXT := 'i.updated_at DESC';
  needle    TEXT := btrim(COALESCE(p_query, ''));
  flt       JSONB;
  fkey      TEXT;
  fop       TEXT;
  fval      TEXT;
  esc       TEXT;
BEGIN
  -- ── Free text ─────────────────────────────────────────────
  -- websearch_to_tsquery is the forgiving parser: it accepts quoted
  -- phrases, OR, and a leading -, and it never throws on junk input.
  -- to_tsquery would raise a syntax error on a stray colon, which in a
  -- search box means the user typing normally gets an error page.
  IF needle <> '' THEN
    where_sql := where_sql || format(
      ' AND i.search_vector @@ websearch_to_tsquery(%L::regconfig, %L)', 'english', needle
    );
    rank_sql := format(
      'ts_rank_cd(i.search_vector, websearch_to_tsquery(%L::regconfig, %L))::real',
      'english', needle
    );
    order_sql := 'rank DESC, i.updated_at DESC';
  END IF;

  -- ── Scope ─────────────────────────────────────────────────
  IF p_category_id IS NOT NULL THEN
    IF p_include_subtree THEN
      where_sql := where_sql || format(
        ' AND i.category_id IN (SELECT s.id FROM public.get_category_subtree(%L::uuid) s)',
        p_category_id
      );
    ELSE
      where_sql := where_sql || format(' AND i.category_id = %L::uuid', p_category_id);
    END IF;
  END IF;

  -- ── Structured filters, ANDed ─────────────────────────────
  FOR flt IN SELECT value FROM jsonb_array_elements(COALESCE(p_filters, '[]'::jsonb))
  LOOP
    fkey := flt->>'key';
    fop  := COALESCE(flt->>'op', 'eq');
    fval := flt->>'value';

    CONTINUE WHEN fkey IS NULL OR fkey !~ key_re;

    IF fop = 'is_null' THEN
      where_sql := where_sql || format(
        ' AND (NOT (i.data ? %L) OR i.data->>%L IS NULL OR btrim(i.data->>%L) = %L)',
        fkey, fkey, fkey, ''
      );
      CONTINUE;
    END IF;

    IF fop = 'not_null' THEN
      where_sql := where_sql || format(
        ' AND (i.data ? %L AND i.data->>%L IS NOT NULL AND btrim(i.data->>%L) <> %L)',
        fkey, fkey, fkey, ''
      );
      CONTINUE;
    END IF;

    CONTINUE WHEN fval IS NULL OR fval = '';

    CASE fop
      WHEN 'eq' THEN
        where_sql := where_sql || format(' AND i.data->>%L = %L', fkey, fval);

      WHEN 'neq' THEN
        -- IS DISTINCT FROM so an item MISSING the key counts as "not
        -- that value", which is what anyone typing -brand:Sony means.
        where_sql := where_sql || format(
          ' AND i.data->>%L IS DISTINCT FROM %L', fkey, fval
        );

      WHEN 'gt', 'gte', 'lt', 'lte' THEN
        -- try_numeric yields NULL for anything unparseable, and NULL
        -- fails the comparison rather than aborting the statement.
        where_sql := where_sql || format(
          ' AND public.try_numeric(i.data->>%L) %s %L::numeric',
          fkey,
          CASE fop WHEN 'gt' THEN '>' WHEN 'gte' THEN '>='
                   WHEN 'lt' THEN '<' ELSE '<=' END,
          fval
        );

      WHEN 'contains', 'starts_with' THEN
        -- Escape LIKE metacharacters: a user searching for "50%" means
        -- the string, not "anything starting 50".
        esc := replace(replace(replace(fval, '\', '\\'), '%', '\%'), '_', '\_');
        where_sql := where_sql || format(
          ' AND i.data->>%L ILIKE %L ESCAPE %L',
          fkey,
          CASE WHEN fop = 'contains' THEN '%' || esc || '%' ELSE esc || '%' END,
          '\'
        );

      WHEN 'in' THEN
        where_sql := where_sql || format(
          ' AND i.data->>%L = ANY (string_to_array(%L, %L))', fkey, fval, ','
        );

      ELSE
        -- Unknown operator: ignore it rather than guess.
        NULL;
    END CASE;
  END LOOP;

  RETURN QUERY EXECUTE format(
    'SELECT i.id, i.category_id, c.name, public.get_category_path(i.category_id), '
    || 'i.data, %s AS rank, count(*) OVER () AS total_count '
    || 'FROM public.items i '
    || 'JOIN public.categories c ON c.id = i.category_id '
    || 'WHERE %s ORDER BY %s LIMIT %s OFFSET %s',
    rank_sql, where_sql, order_sql,
    GREATEST(COALESCE(p_limit, 50), 1),
    GREATEST(COALESCE(p_offset, 0), 0)
  );
END;
$$;


-- ============================================================
-- 5. get_searchable_fields(category)  → JSONB[]
-- ------------------------------------------------------------
-- Every field key in scope, its type, and how many categories define
-- it. Drives the query bar's autocomplete: suggesting `brand` and
-- noting that 3 categories define it tells the user their filter will
-- span the catalog, which is the feature.
--
-- `attribute_id` rides along so the UI can mark the keys that are
-- genuinely one shared concept rather than a spelling coincidence.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_searchable_fields(
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT c.id
    FROM public.categories c
    WHERE p_category_id IS NULL
       OR c.id IN (SELECT s.id FROM public.get_category_subtree(p_category_id) s)
  ),
  fields AS (
    SELECT e->>'key'                 AS key,
           e->>'label'               AS label,
           e->>'type'                AS type,
           e->>'attribute_id'        AS attribute_id,
           e->'options'              AS options,
           s.id                      AS category_id
    FROM scope s
    CROSS JOIN LATERAL jsonb_array_elements(public.get_effective_schema(s.id)) e
  )
  SELECT COALESCE(jsonb_agg(x ORDER BY x.category_count DESC, x.key), '[]'::jsonb)
  FROM (
    SELECT f.key,
           min(f.label)                              AS label,
           mode() WITHIN GROUP (ORDER BY f.type)     AS type,
           count(DISTINCT f.category_id)::int        AS category_count,
           bool_or(f.attribute_id IS NOT NULL)       AS is_shared_attribute,
           -- The union of every option any category offers for this
           -- key, so value autocomplete works across the catalog.
           COALESCE(
             (SELECT jsonb_agg(DISTINCT o)
              FROM fields f2
              CROSS JOIN LATERAL jsonb_array_elements_text(
                     COALESCE(f2.options, '[]'::jsonb)) AS t(o)
              WHERE f2.key = f.key),
             '[]'::jsonb)                            AS options
    FROM fields f
    GROUP BY f.key
  ) x;
$$;


-- ============================================================
-- 6. search_facets(query, filters, category)  → JSONB
-- ------------------------------------------------------------
-- Added in Increment 4, when the search page needed it: facet counts
-- must be computed over the WHOLE match set, not the 50 rows one page
-- happens to show. Counting client-side from the current page would
-- produce numbers that change as you paginate, which is worse than no
-- numbers at all.
--
-- Returns { categories: [...], values: [{ key, label, values: [...] }] }.
--
-- Value facets are offered only for low-cardinality keys (<= 25
-- distinct values in the match set). A facet list with 400 entries is
-- not a filter, it is a second search problem.
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_facets(
  p_query       TEXT  DEFAULT NULL,
  p_filters     JSONB DEFAULT '[]'::jsonb,
  p_category_id UUID  DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  matched     JSONB;
  categories  JSONB;
  values_out  JSONB;
BEGIN
  -- Reuse search_items so the facets can never disagree with the
  -- results. A second copy of the predicate is a second thing to keep
  -- in sync, and it would be wrong the first time either changed.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'category_id', s.category_id,
           'data',        s.data)), '[]'::jsonb)
    INTO matched
  FROM public.search_items(p_query, p_filters, p_category_id, 100000, 0) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.count DESC, x.name), '[]'::jsonb)
    INTO categories
  FROM (
    SELECT (m->>'category_id')::uuid          AS id,
           c.name                             AS name,
           -- The real slug, not one re-derived from the name: a
           -- de-duplicated slug ("laptops-2") would never round-trip
           -- through `in:` if the facet guessed at it.
           c.slug                             AS slug,
           public.get_category_path((m->>'category_id')::uuid) AS path,
           count(*)::int                      AS count
    FROM jsonb_array_elements(matched) m
    JOIN public.categories c ON c.id = (m->>'category_id')::uuid
    GROUP BY 1, 2, 3, 4
  ) x;

  SELECT COALESCE(jsonb_agg(y ORDER BY y.total DESC, y.key), '[]'::jsonb)
    INTO values_out
  FROM (
    SELECT kv.key,
           count(*)::int AS total,
           jsonb_agg(jsonb_build_object('value', kv.value, 'count', kv.n)
                     ORDER BY kv.n DESC, kv.value) AS values
    FROM (
      SELECT e.key, e.value, count(*)::int AS n
      FROM jsonb_array_elements(matched) m
      CROSS JOIN LATERAL jsonb_each_text(m->'data') e
      WHERE e.key <> '__orphaned'
        AND btrim(e.value) <> ''
      GROUP BY e.key, e.value
    ) kv
    GROUP BY kv.key
    -- Low-cardinality only: a 400-entry facet is a second search
    -- problem, not a filter.
    HAVING count(*) BETWEEN 1 AND 25
  ) y;

  RETURN jsonb_build_object(
    'total',      jsonb_array_length(matched),
    'categories', categories,
    'values',     values_out
  );
END;
$$;


-- ████████████████████████████████████████████████████████████
-- ██  supabase/import.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Import (Phase 7, Increment 2)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql
--                        → attributes.sql → search.sql.
--
-- One function, one transaction. An import that half-succeeds is worse
-- than one that fails: the user cannot tell which rows landed, and
-- re-running it duplicates the ones that did.
--
-- ON DATES: values arrive already normalised to ISO by the client. That
-- is deliberate. Casting "03/04/2024" server-side would depend on the
-- session's DateStyle, which means the same file imports differently
-- depending on connection settings — and the CLIENT is the only place
-- that knows which reading the user picked when the column was
-- ambiguous.
-- ============================================================


-- ============================================================
-- 1. require_data_editor()
-- ------------------------------------------------------------
-- The item-level counterpart to require_schema_admin(). Importing rows
-- into an existing category with no new fields is a DATA operation, and
-- gating it behind SCHEMA_ADMIN would be wrong.
--
-- As with require_schema_admin, a NULL auth.uid() means there is no JWT.
-- Trusted from the SQL editor or the service role (table owner, bypasses
-- RLS anyway); NOT trusted from PostgREST, where EXECUTE is granted to
-- PUBLIC by default and an unauthenticated caller can reach this. The
-- connection role tells the two apart.
--
-- NOT IN is also a NULL trap: if get_user_role() returns NULL the whole
-- predicate is NULL and the guard fails open. IS DISTINCT FROM does not.
-- ============================================================
CREATE OR REPLACE FUNCTION public.require_data_editor()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  caller_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    IF current_user IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'You need the DATA_EDITOR or SCHEMA_ADMIN role to add items.';
    END IF;
    RETURN;  -- owner / service_role / SQL editor
  END IF;

  caller_role := public.get_user_role();
  IF caller_role IS DISTINCT FROM 'SCHEMA_ADMIN'
     AND caller_role IS DISTINCT FROM 'DATA_EDITOR' THEN
    RAISE EXCEPTION 'You need the DATA_EDITOR or SCHEMA_ADMIN role to add items.';
  END IF;
END;
$$;


-- ============================================================
-- 2. coerce_import_value(value, type) → JSONB
-- ------------------------------------------------------------
-- A CSV cell is always a string. This turns it into the JSONB shape the
-- field's type expects, or NULL when it cannot — and NULL is the signal
-- the caller turns into a per-row error naming the line and the value.
--
-- Reuses try_cast() from impact.sql for the scalar types so an imported
-- value and a migrated value are converted by exactly the same rule.
-- Two conversion paths that disagree would mean data imported today
-- behaves differently from the same data retyped tomorrow.
-- ============================================================
CREATE OR REPLACE FUNCTION public.coerce_import_value(p_raw TEXT, p_type TEXT)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  txt TEXT := btrim(COALESCE(p_raw, ''));
BEGIN
  IF txt = '' THEN RETURN NULL; END IF;

  -- multiselect splits; try_cast would wrap "S,M" as a single element.
  IF p_type = 'multiselect' THEN
    RETURN (
      SELECT COALESCE(jsonb_agg(t), '[]'::jsonb)
      FROM (
        SELECT btrim(part) AS t
        FROM unnest(string_to_array(txt, ',')) AS part
        WHERE btrim(part) <> ''
      ) parts
    );
  END IF;

  RETURN public.try_cast(to_jsonb(txt), p_type);
END;
$$;


-- ============================================================
-- 3. import_items(...)  → JSONB
-- ------------------------------------------------------------
-- Create or extend a category and insert rows, atomically.
--
--   p_category_id   existing target, or NULL to create one
--   p_new_category  { name, parent_id, icon, color } when creating
--   p_own_fields    fields to ensure exist on the target; keys already
--                   in the effective chain are IGNORED, not duplicated
--   p_rows          array of objects keyed by field key, values as text
--
-- Returns { category_id, created, fields_added, items_inserted,
--           errors: [{ row, key, value, message }] }.
--
-- A value that will not coerce becomes an ERROR AND AN EMPTY CELL — the
-- row still imports. Rejecting an entire 500-row file because row 47
-- has "n/a" in a date column is how an importer gets abandoned; the
-- errors are reported with line numbers so they can be fixed after.
-- ============================================================
CREATE OR REPLACE FUNCTION public.import_items(
  p_category_id  UUID,
  p_new_category JSONB,
  p_own_fields   JSONB,
  p_rows         JSONB,
  p_changed_by   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target      UUID := p_category_id;
  created     BOOLEAN := false;
  existing    JSONB;
  chain_keys  TEXT[];
  to_add      JSONB := '[]'::jsonb;
  fld         JSONB;
  schema_now  JSONB;
  types       JSONB := '{}'::jsonb;
  row_in      JSONB;
  data_out    JSONB;
  coerced     JSONB;
  raw         TEXT;
  k           TEXT;
  errors      JSONB := '[]'::jsonb;
  inserted    INT := 0;
  row_no      INT := 0;
  next_pos    INT;
  version_now INT;
BEGIN
  -- ── Authorisation ─────────────────────────────────────────
  -- Creating a category or adding fields is a SCHEMA change; dropping
  -- rows into an existing one is not.
  IF target IS NULL OR jsonb_array_length(COALESCE(p_own_fields, '[]'::jsonb)) > 0 THEN
    PERFORM public.require_schema_admin();
  ELSE
    PERFORM public.require_data_editor();
  END IF;

  -- ── Target category ───────────────────────────────────────
  IF target IS NULL THEN
    IF COALESCE(btrim(p_new_category->>'name'), '') = '' THEN
      RAISE EXCEPTION 'A name is required to create a category for this import.';
    END IF;

    INSERT INTO public.categories (name, parent_id, icon, color, own_fields)
    VALUES (
      btrim(p_new_category->>'name'),
      NULLIF(p_new_category->>'parent_id', '')::uuid,
      p_new_category->>'icon',
      p_new_category->>'color',
      '[]'::jsonb
    )
    RETURNING id INTO target;

    created := true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.categories WHERE id = target) THEN
    RAISE EXCEPTION 'Category % not found.', target;
  END IF;

  -- ── Merge in the new fields ───────────────────────────────
  -- Anything the category already inherits or defines is skipped: the
  -- whole point of mapping in the wizard is that an incoming `brand`
  -- column lands on the INHERITED brand rather than shadowing it, which
  -- the uniqueness trigger would reject anyway.
  SELECT COALESCE(array_agg(e->>'key'), ARRAY[]::TEXT[]) INTO chain_keys
  FROM jsonb_array_elements(public.get_effective_schema(target)) e;

  SELECT own_fields INTO existing FROM public.categories WHERE id = target;
  next_pos := COALESCE(jsonb_array_length(existing), 0);

  FOR fld IN SELECT value FROM jsonb_array_elements(COALESCE(p_own_fields, '[]'::jsonb))
  LOOP
    CONTINUE WHEN fld->>'key' = ANY(chain_keys);
    to_add := to_add || jsonb_build_array(
      fld || jsonb_build_object('position', next_pos)
    );
    chain_keys := array_append(chain_keys, fld->>'key');
    next_pos := next_pos + 1;
  END LOOP;

  IF jsonb_array_length(to_add) > 0 THEN
    UPDATE public.categories
       SET own_fields = COALESCE(existing, '[]'::jsonb) || to_add
     WHERE id = target;
  END IF;

  -- ── Resolve the schema ONCE, not per row ──────────────────
  schema_now := public.get_effective_schema(target);
  SELECT COALESCE(jsonb_object_agg(e->>'key', e->>'type'), '{}'::jsonb) INTO types
  FROM jsonb_array_elements(schema_now) e;

  SELECT COALESCE(MAX(version), 1) INTO version_now
  FROM public.schema_versions WHERE category_id = target;

  -- ── Rows ──────────────────────────────────────────────────
  FOR row_in IN SELECT value FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    row_no   := row_no + 1;
    data_out := '{}'::jsonb;

    FOR k IN SELECT key FROM jsonb_each_text(row_in)
    LOOP
      -- A column the schema does not have is silently ignored: the
      -- wizard's Skip action lands here, and so does any stray
      -- `_extra_N` the parser rescued from a ragged row.
      CONTINUE WHEN NOT (types ? k);

      raw := row_in->>k;
      CONTINUE WHEN COALESCE(btrim(raw), '') = '';

      coerced := public.coerce_import_value(raw, types->>k);

      IF coerced IS NULL THEN
        errors := errors || jsonb_build_array(jsonb_build_object(
          'row',     row_no,
          'key',     k,
          'value',   raw,
          'message', format('value "%s" is not a %s — imported as empty', raw, types->>k)
        ));
        CONTINUE;
      END IF;

      data_out := data_out || jsonb_build_object(k, coerced);
    END LOOP;

    INSERT INTO public.items (category_id, data, schema_version)
    VALUES (target, data_out, version_now);

    inserted := inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'category_id',    target,
    'created',        created,
    'fields_added',   jsonb_array_length(to_add),
    'items_inserted', inserted,
    -- Capped: an import of 5,000 rows with a bad column would otherwise
    -- return 5,000 identical messages and help nobody.
    'errors',         (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                       FROM (SELECT e FROM jsonb_array_elements(errors) e LIMIT 100) x),
    'error_count',    jsonb_array_length(errors)
  );
END;
$$;


-- ████████████████████████████████████████████████████████████
-- ██  supabase/onboarding.sql
-- ████████████████████████████████████████████████████████████

-- ============================================================
-- Zchema — Onboarding (Phase 7, Increment 3)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql
--                        → attributes.sql → search.sql → import.sql.
-- ============================================================


-- ============================================================
-- 1. profiles.onboarding_state
-- ------------------------------------------------------------
-- Which hints this user has dismissed and which milestones they have
-- passed. Per-user rather than global: two people sharing a catalog
-- have not both seen the tour.
--
-- Shape: { "dismissed": ["inherited-callout"], "done": ["first-import"] }
-- Deliberately schemaless — the set of hints changes every time the UI
-- does, and a column per hint would be a migration per hint.
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_state JSONB NOT NULL DEFAULT '{}'::jsonb;


-- ============================================================
-- 2. dismiss_onboarding_hint(key)
-- ------------------------------------------------------------
-- Append-only against the caller's OWN row. Written as a function
-- rather than a client-side UPDATE so a dismissal cannot be used to
-- write arbitrary JSON into a profile.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dismiss_onboarding_hint(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;
  IF p_key !~ '^[a-z][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'Invalid hint key.';
  END IF;

  UPDATE public.profiles p
     SET onboarding_state = jsonb_set(
           COALESCE(p.onboarding_state, '{}'::jsonb),
           '{dismissed}',
           (
             SELECT COALESCE(jsonb_agg(DISTINCT k), '[]'::jsonb)
             FROM (
               SELECT jsonb_array_elements_text(
                        COALESCE(p.onboarding_state->'dismissed', '[]'::jsonb)) AS k
               UNION SELECT p_key
             ) keys
           ),
           true)
   WHERE p.id = auth.uid()
   RETURNING onboarding_state INTO result;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;


-- ============================================================
-- 3. seed_sample_catalog(dataset)  → JSONB
-- ------------------------------------------------------------
-- The "load a ready catalog and poke at it" path.
--
-- REFUSES TO RUN IF ANY CATEGORY EXISTS. This is reachable from a
-- button in the UI, and a first-run helper that can wipe or muddle a
-- real catalog is a data-loss bug wearing a friendly hat. The seed
-- scripts in supabase/ truncate; this one declines.
--
-- Returns { category_id } pointing at the node that makes inheritance
-- self-evident — three levels deep, with an override — so the caller
-- can land the user on the one screen worth seeing first.
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_sample_catalog(p_dataset TEXT DEFAULT 'catalog')
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  root       UUID;
  mid        UUID;
  leaf       UUID;
  sibling    UUID;
  i          INT;
BEGIN
  PERFORM public.require_schema_admin();

  IF EXISTS (SELECT 1 FROM public.categories) THEN
    RAISE EXCEPTION
      'The sample catalog can only be loaded into an empty workspace — there are already categories here.';
  END IF;

  IF p_dataset = 'vehicles' THEN
    -- ── Vehicles ────────────────────────────────────────────
    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
    VALUES ('Vehicles', 'vehicles', NULL, 'Car', '#3b82f6', '[
      {"key":"make","label":"Make","type":"string","required":true,"position":0},
      {"key":"model_year","label":"Model Year","type":"number","required":true,"position":1},
      {"key":"fuel_type","label":"Fuel","type":"select","required":false,"position":2,
       "options":["Petrol","Diesel","Hybrid","Electric"]}
    ]'::jsonb) RETURNING id INTO root;

    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
    VALUES ('Cars', 'cars', root, 'Car', '#6366f1', '[
      {"key":"doors","label":"Doors","type":"number","required":false,"position":0},
      {"key":"transmission","label":"Transmission","type":"select","required":false,"position":1,
       "options":["Manual","Automatic"]}
    ]'::jsonb) RETURNING id INTO mid;

    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields, overrides)
    VALUES ('SUVs', 'suvs', mid, 'Truck', '#8b5cf6', '[
      {"key":"drivetrain","label":"Drivetrain","type":"select","required":false,"position":0,
       "options":["FWD","RWD","AWD","4WD"]},
      {"key":"ground_clearance_mm","label":"Ground Clearance","type":"number",
       "required":false,"position":1,"unit":"mm"}
    ]'::jsonb,
    '{"fuel_type":{"required":true,"label":"Fuel (required for SUVs)"}}'::jsonb)
    RETURNING id INTO leaf;

    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
    VALUES ('Motorcycles', 'motorcycles', root, 'Bike', '#ec4899', '[
      {"key":"engine_cc","label":"Engine","type":"number","required":false,"position":0,"unit":"cc"}
    ]'::jsonb) RETURNING id INTO sibling;

    FOR i IN 1..12 LOOP
      INSERT INTO public.items (category_id, data) VALUES (leaf, jsonb_build_object(
        'make',                (ARRAY['Toyota','Honda','Mazda','Subaru'])[1 + (i % 4)],
        'model_year',          2018 + (i % 7),
        'fuel_type',           (ARRAY['Petrol','Diesel','Hybrid'])[1 + (i % 3)],
        'doors',               5,
        'transmission',        (ARRAY['Manual','Automatic'])[1 + (i % 2)],
        'drivetrain',          (ARRAY['AWD','4WD','FWD'])[1 + (i % 3)],
        'ground_clearance_mm', 180 + (i * 5)
      ));
    END LOOP;

    FOR i IN 1..8 LOOP
      INSERT INTO public.items (category_id, data) VALUES (sibling, jsonb_build_object(
        'make',       (ARRAY['Yamaha','Kawasaki','Ducati'])[1 + (i % 3)],
        'model_year', 2019 + (i % 6),
        'fuel_type',  'Petrol',
        'engine_cc',  250 * (1 + (i % 4))
      ));
    END LOOP;

    RETURN jsonb_build_object('category_id', leaf, 'dataset', 'vehicles');
  END IF;

  -- ── Catalog (default) ─────────────────────────────────────
  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
  VALUES ('Electronics', 'electronics', NULL, 'Cpu', '#3b82f6', '[
    {"key":"brand","label":"Brand","type":"string","required":true,"position":0},
    {"key":"model_number","label":"Model Number","type":"string","required":false,"position":1},
    {"key":"warranty_months","label":"Warranty","type":"number","required":false,"position":2,
     "unit":"months"}
  ]'::jsonb) RETURNING id INTO root;

  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
  VALUES ('Laptops', 'laptops', root, 'Laptop', '#6366f1', '[
    {"key":"screen_size_in","label":"Screen Size","type":"number","required":false,"position":0,
     "unit":"in"},
    {"key":"ram_gb","label":"RAM","type":"number","required":false,"position":1,"unit":"GB"},
    {"key":"cpu","label":"CPU","type":"string","required":false,"position":2},
    {"key":"gpu","label":"GPU","type":"string","required":false,"position":3}
  ]'::jsonb) RETURNING id INTO mid;

  -- Three levels deep AND carrying an override: the single node that
  -- proves the whole model in one screenshot.
  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields, overrides)
  VALUES ('Gaming Laptops', 'gaming-laptops', mid, 'Gamepad2', '#8b5cf6', '[
    {"key":"refresh_rate_hz","label":"Refresh Rate","type":"number","required":false,
     "position":0,"unit":"Hz"},
    {"key":"has_rgb","label":"RGB Lighting","type":"boolean","required":false,"position":1}
  ]'::jsonb,
  '{"warranty_months":{"required":true,"label":"Warranty (months)"}}'::jsonb)
  RETURNING id INTO leaf;

  -- A sibling that shares the ancestor but NOT the Laptops fields —
  -- the other half of the demonstration.
  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
  VALUES ('Smartphones', 'smartphones', root, 'Smartphone', '#ec4899', '[
    {"key":"battery_mah","label":"Battery","type":"number","required":false,"position":0,
     "unit":"mAh"},
    {"key":"storage_gb","label":"Storage","type":"number","required":false,"position":1,
     "unit":"GB"},
    {"key":"has_5g","label":"5G","type":"boolean","required":false,"position":2}
  ]'::jsonb) RETURNING id INTO sibling;

  FOR i IN 1..14 LOOP
    -- jsonb_strip_nulls drops the deliberately-blank warranty rows: an
    -- ABSENT key and a key holding null mean different things to the
    -- completeness check, and only "absent" is honest here.
    INSERT INTO public.items (category_id, data) VALUES (leaf, jsonb_strip_nulls(jsonb_build_object(
      'brand',           (ARRAY['ASUS ROG','MSI','Alienware','Razer'])[1 + (i % 4)],
      'model_number',    'GL-' || (1000 + i),
      -- Left blank on a third of the rows so the "make this required"
      -- impact demo has something real to find.
      'warranty_months', CASE WHEN i % 3 = 0 THEN NULL ELSE 12 + (i % 3) * 12 END,
      'screen_size_in',  (ARRAY[15.6, 17.3, 14.0])[1 + (i % 3)],
      'ram_gb',          (ARRAY[16, 32, 64])[1 + (i % 3)],
      'cpu',             (ARRAY['Intel Core i7','Intel Core i9','AMD Ryzen 9'])[1 + (i % 3)],
      'gpu',             (ARRAY['RTX 4060','RTX 4070','RTX 4080'])[1 + (i % 3)],
      'refresh_rate_hz', (ARRAY[144, 165, 240])[1 + (i % 3)],
      'has_rgb',         i % 2 = 0
    )));
  END LOOP;

  FOR i IN 1..10 LOOP
    INSERT INTO public.items (category_id, data) VALUES (sibling, jsonb_build_object(
      'brand',           (ARRAY['Apple','Samsung','Google','OnePlus'])[1 + (i % 4)],
      'model_number',    'SP-' || (2000 + i),
      'warranty_months', 12,
      'battery_mah',     4000 + (i * 100),
      'storage_gb',      (ARRAY[128, 256, 512])[1 + (i % 3)],
      'has_5g',          true
    ));
  END LOOP;

  FOR i IN 1..6 LOOP
    INSERT INTO public.items (category_id, data) VALUES (mid, jsonb_build_object(
      'brand',           (ARRAY['Dell','HP','Lenovo'])[1 + (i % 3)],
      'model_number',    'NB-' || (3000 + i),
      'warranty_months', 24,
      'screen_size_in',  14.0,
      'ram_gb',          16,
      'cpu',             'Intel Core i5',
      'gpu',             'Integrated'
    ));
  END LOOP;

  RETURN jsonb_build_object('category_id', leaf, 'dataset', 'catalog');
END;
$$;

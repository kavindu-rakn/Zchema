-- ============================================================
-- SchemaShift — Database Schema (Phase 1: schema composition)
-- Run this in the Supabase SQL Editor (or via supabase db push).
--
-- MODEL: schema lives on the CATEGORY node and is composed down
-- the tree. A category owns `own_fields` and may `override` fields
-- it inherits from ancestors. Blueprints (formerly templates) are
-- demoted to optional starter presets — no live link.
--
-- Load order: schema.sql  →  functions.sql  (resolvers, Increment 2).
-- ============================================================

-- ============================================================
-- 0. Destructive rebuild
-- ------------------------------------------------------------
-- ⚠️  DESTRUCTIVE. This drops every application table and its
-- data. This is intentional for the Phase 1 overhaul — there is
-- no back-compat shim. Do NOT run against production data you
-- care about without a backup.
-- ============================================================
DROP TABLE IF EXISTS public.items          CASCADE;
DROP TABLE IF EXISTS public.schema_versions CASCADE;
DROP TABLE IF EXISTS public.attributes      CASCADE;
DROP TABLE IF EXISTS public.categories      CASCADE;
DROP TABLE IF EXISTS public.blueprints      CASCADE;
DROP TABLE IF EXISTS public.templates       CASCADE;  -- legacy, pre-overhaul
DROP TABLE IF EXISTS public.profiles        CASCADE;


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
CREATE TABLE public.profiles (
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
CREATE TABLE public.blueprints (
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
CREATE TABLE public.categories (
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
CREATE TABLE public.items (
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
CREATE TABLE public.schema_versions (
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
CREATE TABLE public.attributes (
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
CREATE INDEX idx_items_data_gin ON public.items USING gin (data);

-- Hierarchical category lookups.
CREATE INDEX idx_categories_parent ON public.categories (parent_id);

-- Category → blueprint provenance joins.
CREATE INDEX idx_categories_blueprint ON public.categories (blueprint_id);

-- Item → category joins.
CREATE INDEX idx_items_category ON public.items (category_id);

-- Slug uniqueness: unique within a parent, and unique among roots.
CREATE UNIQUE INDEX unique_category_slug_parent
  ON public.categories (parent_id, slug) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX unique_category_slug_root
  ON public.categories (slug) WHERE parent_id IS NULL;

-- GIN index over own_fields for field-key lookups.
CREATE INDEX idx_categories_own_fields ON public.categories USING gin (own_fields);

-- Schema version history lookups, newest first.
CREATE INDEX idx_schema_versions_category
  ON public.schema_versions (category_id, version DESC);


-- ============================================================
-- 8. updated_at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, role)
  VALUES (
    NEW.id,
    NEW.email,
    CASE
      WHEN NEW.email = 'admin@schemashift.lk'       THEN 'SCHEMA_ADMIN'
      WHEN NEW.email = 'editor@schemashift.lk' THEN 'DATA_EDITOR'
      ELSE 'VIEWER'
    END
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 10. Role update protection
-- ------------------------------------------------------------
-- Only a SCHEMA_ADMIN may change any profile's role.
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF (SELECT role FROM public.profiles WHERE id = auth.uid()) <> 'SCHEMA_ADMIN' THEN
      RAISE EXCEPTION 'Only SCHEMA_ADMIN can change roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_role_protection ON public.profiles;
CREATE TRIGGER ensure_role_protection
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_role_update();


-- ============================================================
-- 11. Cycle guard — a category must not become its own ancestor
-- ------------------------------------------------------------
-- Walks parent_id upward on INSERT / UPDATE OF parent_id and
-- rejects any move that would place a node under its own descendant.
-- ============================================================
CREATE OR REPLACE FUNCTION public.prevent_category_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
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

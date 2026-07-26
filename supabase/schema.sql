-- ============================================================
-- SchemaShift — Database Schema Migration
-- Run this in the Supabase SQL Editor (or via supabase db push)
-- ============================================================

-- ── 1. Profiles ─────────────────────────────────────────────
-- Mirrors auth.users with an application-level role.
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'VIEWER'
             CHECK (role IN ('TEMPLATE_ADMIN', 'DATA_CONTRIBUTOR', 'VIEWER')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Templates ────────────────────────────────────────────
-- Each template defines a reusable field schema for items.
-- `fields` is a JSONB array:
--   [{ "key": "brand", "label": "Brand", "type": "string", "required": true, "options": [] }]
CREATE TABLE IF NOT EXISTS public.templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Categories ───────────────────────────────────────────
-- Hierarchical tree: parent_id references self.
-- Each category is linked to exactly one template.
CREATE TABLE IF NOT EXISTS public.categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  parent_id   UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.templates(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 4. Items ────────────────────────────────────────────────
-- Dynamic item data stored as JSONB keyed to the template fields.
CREATE TABLE IF NOT EXISTS public.items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 5. Indexes ──────────────────────────────────────────────
-- GIN index for fast JSONB containment / key-exists queries.
CREATE INDEX IF NOT EXISTS idx_items_data_gin ON public.items USING gin (data);

-- Index for hierarchical category lookups.
CREATE INDEX IF NOT EXISTS idx_categories_parent ON public.categories (parent_id);

-- Index for category → template joins.
CREATE INDEX IF NOT EXISTS idx_categories_template ON public.categories (template_id);

-- Index for item → category joins.
CREATE INDEX IF NOT EXISTS idx_items_category ON public.items (category_id);


-- ============================================================
-- 6. Auto-create profile on signup (trigger)
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
    'VIEWER'
  );
  RETURN NEW;
END;
$$;

-- Drop existing trigger if present, then re-create.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- 7. Row Level Security (RLS) Policies
-- ============================================================

-- ── Enable RLS on all tables ────────────────────────────────
ALTER TABLE public.profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items      ENABLE ROW LEVEL SECURITY;

-- ── Helper: get current user's role ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;


-- ────────────────────────────────────────────────────────────
-- PROFILES policies
-- ────────────────────────────────────────────────────────────

-- All authenticated users can read their own profile.
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- TEMPLATE_ADMIN can read all profiles.
CREATE POLICY "profiles_select_admin"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'TEMPLATE_ADMIN');

-- DATA_CONTRIBUTOR can read all profiles (spec: SELECT on profiles).
CREATE POLICY "profiles_select_contributor"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'DATA_CONTRIBUTOR');

-- TEMPLATE_ADMIN can update any profile (e.g. role changes).
CREATE POLICY "profiles_update_admin"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'TEMPLATE_ADMIN');

-- Users can update their own profile (email, etc.).
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- ────────────────────────────────────────────────────────────
-- TEMPLATES policies
-- ────────────────────────────────────────────────────────────

-- Everyone can read templates.
CREATE POLICY "templates_select_all"
  ON public.templates FOR SELECT
  TO authenticated
  USING (true);

-- Only TEMPLATE_ADMIN can insert.
CREATE POLICY "templates_insert_admin"
  ON public.templates FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() = 'TEMPLATE_ADMIN');

-- Only TEMPLATE_ADMIN can update.
CREATE POLICY "templates_update_admin"
  ON public.templates FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'TEMPLATE_ADMIN');

-- Only TEMPLATE_ADMIN can delete.
CREATE POLICY "templates_delete_admin"
  ON public.templates FOR DELETE
  TO authenticated
  USING (public.get_user_role() = 'TEMPLATE_ADMIN');


-- ────────────────────────────────────────────────────────────
-- CATEGORIES policies
-- ────────────────────────────────────────────────────────────

-- Everyone can read categories.
CREATE POLICY "categories_select_all"
  ON public.categories FOR SELECT
  TO authenticated
  USING (true);

-- Only TEMPLATE_ADMIN can insert.
CREATE POLICY "categories_insert_admin"
  ON public.categories FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() = 'TEMPLATE_ADMIN');

-- Only TEMPLATE_ADMIN can update.
CREATE POLICY "categories_update_admin"
  ON public.categories FOR UPDATE
  TO authenticated
  USING (public.get_user_role() = 'TEMPLATE_ADMIN');

-- Only TEMPLATE_ADMIN can delete.
CREATE POLICY "categories_delete_admin"
  ON public.categories FOR DELETE
  TO authenticated
  USING (public.get_user_role() = 'TEMPLATE_ADMIN');


-- ────────────────────────────────────────────────────────────
-- ITEMS policies
-- ────────────────────────────────────────────────────────────

-- Everyone can read items.
CREATE POLICY "items_select_all"
  ON public.items FOR SELECT
  TO authenticated
  USING (true);

-- TEMPLATE_ADMIN and DATA_CONTRIBUTOR can insert.
CREATE POLICY "items_insert_contributor"
  ON public.items FOR INSERT
  TO authenticated
  WITH CHECK (public.get_user_role() IN ('TEMPLATE_ADMIN', 'DATA_CONTRIBUTOR'));

-- TEMPLATE_ADMIN and DATA_CONTRIBUTOR can update.
CREATE POLICY "items_update_contributor"
  ON public.items FOR UPDATE
  TO authenticated
  USING (public.get_user_role() IN ('TEMPLATE_ADMIN', 'DATA_CONTRIBUTOR'));

-- TEMPLATE_ADMIN and DATA_CONTRIBUTOR can delete.
CREATE POLICY "items_delete_contributor"
  ON public.items FOR DELETE
  TO authenticated
  USING (public.get_user_role() IN ('TEMPLATE_ADMIN', 'DATA_CONTRIBUTOR'));


-- ============================================================
-- 8. Triggers for updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_modified_column()
RETURNS TRIGGER AS \$\$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
\$\$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_modtime BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_templates_modtime BEFORE UPDATE ON public.templates FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_categories_modtime BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();
CREATE TRIGGER update_items_modtime BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.update_modified_column();

-- ============================================================
-- 9. Role Update Protection
-- ============================================================
CREATE OR REPLACE FUNCTION public.protect_role_update()
RETURNS TRIGGER AS \$\$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF (SELECT role FROM public.profiles WHERE id = auth.uid()) != 'TEMPLATE_ADMIN' THEN
      RAISE EXCEPTION 'Only TEMPLATE_ADMIN can change roles';
    END IF;
  END IF;
  RETURN NEW;
END;
\$\$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ensure_role_protection BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_role_update();

-- ============================================================
-- 10. Unique Indexes for Categories
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS unique_category_name_parent ON public.categories (parent_id, name) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_category_name_root ON public.categories (name) WHERE parent_id IS NULL;

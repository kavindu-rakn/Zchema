-- ============================================================
-- SchemaShift — Row Level Security (Phase 1, Increment 4)
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

-- SchemaShift requires a login: the anonymous role gets nothing back.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles   TO authenticated;
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
-- IUD    : own row; any row for SCHEMA_ADMIN
--
-- NOTE: a user may UPDATE their own row, which nominally includes
-- `role`. Privilege escalation is blocked by the protect_role_update()
-- trigger (schema.sql §10), which raises unless the caller is a
-- SCHEMA_ADMIN. Policy + trigger together, not policy alone.
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

CREATE POLICY profiles_insert_own   ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY profiles_insert_admin ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');

CREATE POLICY profiles_update_own   ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());
CREATE POLICY profiles_update_admin ON public.profiles FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN')
  WITH CHECK (public.get_user_role() = 'SCHEMA_ADMIN');

CREATE POLICY profiles_delete_own   ON public.profiles FOR DELETE TO authenticated
  USING (id = auth.uid());
CREATE POLICY profiles_delete_admin ON public.profiles FOR DELETE TO authenticated
  USING (public.get_user_role() = 'SCHEMA_ADMIN');


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

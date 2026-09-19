-- ============================================================
-- ⚠️  DEV ONLY — DESTROYS EVERY ROW OF APPLICATION DATA
-- ------------------------------------------------------------
-- Drops every Zchema table so the schema can be rebuilt from scratch.
-- Accounts in auth.users survive; their profiles (and so their roles)
-- do not, until schema.sql's backfill recreates them — and then only
-- the oldest account is SCHEMA_ADMIN.
--
-- Never run this against a database you care about. To change a live
-- database, add a migration in supabase/migrations/ instead.
--
-- Afterwards, rebuild with `npm run db:push` (or the supabase/*.sql
-- feature files in load order), then a seed. The trash goes too: this
-- is the one delete that does not land in it.
-- ============================================================
DROP TABLE IF EXISTS public.trash           CASCADE;
DROP SEQUENCE IF EXISTS public.trash_batch_seq;
DROP TABLE IF EXISTS public.items           CASCADE;
DROP TABLE IF EXISTS public.schema_versions CASCADE;
DROP TABLE IF EXISTS public.attributes      CASCADE;
DROP TABLE IF EXISTS public.categories      CASCADE;
DROP TABLE IF EXISTS public.blueprints      CASCADE;
DROP TABLE IF EXISTS public.templates       CASCADE;  -- legacy, pre-overhaul
DROP TABLE IF EXISTS public.profiles        CASCADE;

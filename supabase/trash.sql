-- ============================================================
-- Zchema — Trash: deleting never destroys data
-- Run AFTER onboarding.sql (load order: schema → functions →
-- triggers → policies → impact → attributes → search → import →
-- onboarding → trash).
--
-- The product's promise is that a value is never silently lost. Until
-- this file, deleting an item or a category broke it outright: a hard
-- DELETE, and a category took its whole subtree, every item in it and
-- its version history with it through ON DELETE CASCADE.
--
-- Now every deleted item, category and schema version is copied into
-- public.trash by a trigger, so it does not matter which route the
-- delete took — the UI, a direct API call, or a cascade. Rows deleted
-- together share a batch, and a batch restores as one.
--
-- The live tables only ever hold live rows, so no read path — search,
-- the Items tab, the dashboard, impact analysis — needs to know the
-- trash exists.
--
-- PRIVILEGE: the functions that read the trash are SECURITY DEFINER,
-- because clients hold no privilege on public.trash at all. Inside a
-- DEFINER function current_user is the owner, so require_schema_admin()
-- and require_data_editor() would wave a caller with no JWT through
-- their "direct database session" branch. What stops that is the grant:
-- EXECUTE is revoked from PUBLIC and anon, so only a signed-in caller —
-- who always has an auth.uid() — can reach them.
-- ============================================================


-- ============================================================
-- 1. Capture: every deleted row lands in the trash
-- ------------------------------------------------------------
-- AFTER DELETE, per row. A cascade deletes child rows as ordinary
-- deletes, so their triggers fire too: deleting a category captures its
-- descendants, their items and their schema versions in the same batch.
-- If the delete rolls back, so does the capture.
--
-- The batch lives in a transaction-local setting, zchema.trash_batch.
-- The first row captured draws a fresh number from trash_batch_seq and
-- every row after it — the rest of the statement, the cascade it set
-- off — joins that batch. start_trash_batch() clears the setting, so
-- delete_items() and delete_category_safely() are each an entry of
-- their own even when one transaction calls both. (The transaction id
-- was the first design; one transaction merged unrelated deletions.)
--
-- search_vector is a generated column; it is rebuilt on restore.
-- TRUNCATE fires no row triggers, which is why the seed files can reset
-- the catalog without filling the trash.
-- ============================================================
CREATE OR REPLACE FUNCTION public.capture_deleted_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch TEXT := NULLIF(current_setting('zchema.trash_batch', true), '');
BEGIN
  IF v_batch IS NULL THEN
    v_batch := nextval('public.trash_batch_seq')::text;
    PERFORM set_config('zchema.trash_batch', v_batch, true);
  END IF;

  INSERT INTO public.trash (batch, table_name, row_id, row_data, deleted_by)
  VALUES (v_batch::bigint, TG_TABLE_NAME, OLD.id, to_jsonb(OLD) - 'search_vector', auth.uid());
  RETURN OLD;
END;
$$;

-- Start a new trash entry: the next deleted row draws a fresh batch.
CREATE OR REPLACE FUNCTION public.start_trash_batch()
RETURNS VOID
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT set_config('zchema.trash_batch', '', true);
$$;

-- The entry this transaction's latest deletion landed in, or NULL.
CREATE OR REPLACE FUNCTION public.current_trash_batch()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('zchema.trash_batch', true), '');
$$;

DROP TRIGGER IF EXISTS items_to_trash ON public.items;
CREATE TRIGGER items_to_trash
  AFTER DELETE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.capture_deleted_row();

DROP TRIGGER IF EXISTS categories_to_trash ON public.categories;
CREATE TRIGGER categories_to_trash
  AFTER DELETE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.capture_deleted_row();

DROP TRIGGER IF EXISTS schema_versions_to_trash ON public.schema_versions;
CREATE TRIGGER schema_versions_to_trash
  AFTER DELETE ON public.schema_versions
  FOR EACH ROW EXECUTE FUNCTION public.capture_deleted_row();

REVOKE EXECUTE ON FUNCTION public.capture_deleted_row() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 2. member_email(user) → TEXT
-- ------------------------------------------------------------
-- Who deleted an entry, who added or last edited an item. profiles RLS
-- lets a member read only their own row (admins read all), so this is
-- DEFINER — and returns exactly one column, the email, for one id.
-- ============================================================
CREATE OR REPLACE FUNCTION public.member_email(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.email FROM public.profiles p WHERE p.id = p_user_id;
$$;


-- ============================================================
-- 3. delete_items(ids) → { deleted, trash_batch }
-- ------------------------------------------------------------
-- The same DELETE a client could send, plus the batch it landed in, so
-- the UI can offer Undo. INVOKER: RLS decides who may delete.
-- ============================================================
CREATE OR REPLACE FUNCTION public.delete_items(p_item_ids UUID[])
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  n INT;
BEGIN
  PERFORM public.require_data_editor();
  PERFORM public.start_trash_batch();
  DELETE FROM public.items WHERE id = ANY(COALESCE(p_item_ids, ARRAY[]::UUID[]));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object(
    'deleted',     n,
    'trash_batch', CASE WHEN n > 0 THEN public.current_trash_batch() END
  );
END;
$$;


-- ============================================================
-- 4. list_trash() → JSONB array, newest first
-- ------------------------------------------------------------
-- One entry per batch. The batch id is TEXT: a bigint does not survive
-- a JavaScript number.
--
--   categories / items   how many of each the entry holds
--   top_categories       names of the categories whose parent is NOT in
--                        the entry — "Laptops", not its eight children
--   item_samples         up to three items' data, for the UI to label
--   home_categories      where the items lived, for an items-only entry
--   blocked_by           why it cannot be restored yet, or null
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_trash()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- require_*'s own messages describe the schema or the import; say
  -- what was actually attempted.
  BEGIN
    PERFORM public.require_data_editor();
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'The trash is open to DATA_EDITORs and SCHEMA_ADMINs.';
  END;

  RETURN COALESCE((
    SELECT jsonb_agg(entry ORDER BY entry.deleted_at DESC)
    FROM (
      SELECT
        t.batch::text                                              AS batch,
        max(t.deleted_at)                                          AS deleted_at,
        public.member_email((array_agg(t.deleted_by) FILTER (WHERE t.deleted_by IS NOT NULL))[1])
                                                                   AS deleted_by,
        count(*) FILTER (WHERE t.table_name = 'categories')::int   AS categories,
        count(*) FILTER (WHERE t.table_name = 'items')::int        AS items,
        COALESCE((
          SELECT jsonb_agg(c.row_data->>'name' ORDER BY c.row_data->>'name')
          FROM public.trash c
          WHERE c.batch = t.batch AND c.table_name = 'categories'
            AND NOT EXISTS (
              SELECT 1 FROM public.trash p
              WHERE p.batch = t.batch AND p.table_name = 'categories'
                AND p.row_id = (c.row_data->>'parent_id')::uuid
            )
        ), '[]'::jsonb)                                            AS top_categories,
        COALESCE((
          SELECT jsonb_agg(s.row_data->'data')
          FROM (
            SELECT i.row_data FROM public.trash i
            WHERE i.batch = t.batch AND i.table_name = 'items'
            ORDER BY i.row_data->>'created_at', i.row_id
            LIMIT 3
          ) s
        ), '[]'::jsonb)                                            AS item_samples,
        COALESCE((
          SELECT jsonb_agg(DISTINCT COALESCE(live.name, gone.row_data->>'name'))
          FROM public.trash i
          LEFT JOIN public.categories live ON live.id = (i.row_data->>'category_id')::uuid
          LEFT JOIN LATERAL (
            SELECT g.row_data FROM public.trash g
            WHERE g.table_name = 'categories' AND g.row_id = (i.row_data->>'category_id')::uuid
            LIMIT 1
          ) gone ON true
          WHERE i.batch = t.batch AND i.table_name = 'items'
        ), '[]'::jsonb)                                            AS home_categories,
        public.trash_blocked_by(t.batch)                           AS blocked_by
      FROM public.trash t
      GROUP BY t.batch
    ) entry
  ), '[]'::jsonb);
END;
$$;


-- ============================================================
-- 5. trash_blocked_by(batch) → TEXT or NULL
-- ------------------------------------------------------------
-- A batch can only go back where it came from. A category needs its
-- parent, and an item its category — either live, or in the same batch.
-- The usual reason for neither: the parent was deleted later, in an
-- entry of its own, which has to be restored first. If that entry has
-- since been emptied, there is nowhere left to go back to.
-- ============================================================
CREATE OR REPLACE FUNCTION public.trash_blocked_by(p_batch BIGINT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH batch_categories AS (
    SELECT row_id FROM public.trash WHERE batch = p_batch AND table_name = 'categories'
  ),
  missing AS (
    SELECT '“' || (t.row_data->>'name') || '”' AS subject,
           (t.row_data->>'parent_id')::uuid    AS needed
    FROM public.trash t
    WHERE t.batch = p_batch AND t.table_name = 'categories'
      AND t.row_data->>'parent_id' IS NOT NULL
    UNION ALL
    SELECT 'an item in this entry', (t.row_data->>'category_id')::uuid
    FROM public.trash t
    WHERE t.batch = p_batch AND t.table_name = 'items'
  )
  SELECT CASE
    WHEN parent.name IS NOT NULL
      THEN format('Restore “%s” first — %s belonged under it.', parent.name, m.subject)
    ELSE format('%s belonged under a category that has since been deleted for good, so it has nowhere to go back to.',
                CASE WHEN m.subject = 'an item in this entry' THEN 'An item in this entry' ELSE m.subject END)
  END
  FROM missing m
  LEFT JOIN LATERAL (
    SELECT g.row_data->>'name' AS name FROM public.trash g
    WHERE g.table_name = 'categories' AND g.row_id = m.needed
    LIMIT 1
  ) parent ON true
  WHERE m.needed NOT IN (SELECT row_id FROM batch_categories)
    AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = m.needed)
  LIMIT 1;
$$;


-- ============================================================
-- 6. restore_trash(batch) → { categories, items, versions, orphaned_values }
-- ------------------------------------------------------------
-- Puts a batch back, all or nothing, then removes it from the trash.
--
--   * Categories go in parents-first, under their original ids, slugs
--     and schemas. The usual insert triggers run, so a restore that
--     would now break the rules — a field key an ancestor has since
--     taken, a slug someone has since used — fails with the reason
--     instead of half-restoring.
--   * Schema versions come back with them: history is not lost either.
--   * Items come back under their original ids and authors. Their data
--     is reconciled with their category's CURRENT schema exactly as
--     move_items() does it: a value whose field no longer exists moves
--     to __orphaned, never away. schema_version is kept as it was, so
--     an item written against an older schema still says so.
--   * A creator or deleter whose account has since gone is recorded as
--     unknown rather than failing the foreign key.
--
-- A batch holding categories needs a SCHEMA_ADMIN; an items-only batch
-- needs a DATA_EDITOR — the same line the live tables draw.
-- ============================================================
CREATE OR REPLACE FUNCTION public.restore_trash(p_batch TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch    BIGINT;
  blocked    TEXT;
  n_cats     INT := 0;
  n_items    INT := 0;
  n_versions INT := 0;
  n_orphaned INT := 0;
  n_round    INT;
  cat        RECORD;
  stranded   TEXT;
BEGIN
  IF p_batch IS NULL OR p_batch !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'That is not a trash entry.';
  END IF;
  v_batch := p_batch::bigint;

  IF NOT EXISTS (SELECT 1 FROM public.trash WHERE batch = v_batch) THEN
    RAISE EXCEPTION 'That trash entry no longer exists — it may already have been restored or emptied.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.trash WHERE batch = v_batch AND table_name = 'categories') THEN
    BEGIN
      PERFORM public.require_schema_admin();
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Only a SCHEMA_ADMIN can restore a deleted category.';
    END;
  ELSE
    BEGIN
      PERFORM public.require_data_editor();
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Restoring items needs the DATA_EDITOR or SCHEMA_ADMIN role.';
    END;
  END IF;

  blocked := public.trash_blocked_by(v_batch);
  IF blocked IS NOT NULL THEN
    RAISE EXCEPTION '%', blocked;
  END IF;

  -- Rows go back exactly as they were: stamp_item_authors() leaves the
  -- authors alone for the rest of this transaction, even where they are
  -- unknown, rather than crediting the items to whoever restored them.
  PERFORM set_config('zchema.restoring', 'on', true);

  -- ── Categories, parents first ─────────────────────────────
  -- Each round restores the categories whose parent is now live. The
  -- tree is finite and blocked_by has vouched for every parent, so this
  -- ends; the round cap is a guard, not a limit anyone will meet.
  FOR pass IN 1..1000 LOOP
    n_round := 0;
    FOR cat IN
      SELECT r.*
      FROM public.trash t,
           jsonb_populate_record(NULL::public.categories, t.row_data) r
      WHERE t.batch = v_batch AND t.table_name = 'categories'
        AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = r.id)
        AND (r.parent_id IS NULL
             OR EXISTS (SELECT 1 FROM public.categories c WHERE c.id = r.parent_id))
    LOOP
      BEGIN
        INSERT INTO public.categories (
          id, name, slug, description, parent_id, blueprint_id,
          own_fields, overrides, icon, color, position, created_at, updated_at
        ) VALUES (
          cat.id, cat.name, cat.slug, cat.description, cat.parent_id,
          -- Provenance only: a blueprint deleted since is simply forgotten.
          (SELECT b.id FROM public.blueprints b WHERE b.id = cat.blueprint_id),
          cat.own_fields, cat.overrides, cat.icon, cat.color, cat.position,
          cat.created_at, cat.updated_at
        );
      EXCEPTION
        WHEN unique_violation THEN
          RAISE EXCEPTION 'Could not restore “%”: another category in the same place now uses the address “%”. Rename that one, then restore.',
            cat.name, cat.slug;
        WHEN OTHERS THEN
          RAISE EXCEPTION 'Could not restore “%”: %', cat.name, SQLERRM;
      END;
      n_round := n_round + 1;
    END LOOP;
    n_cats := n_cats + n_round;
    EXIT WHEN n_round = 0;
  END LOOP;

  SELECT t.row_data->>'name' INTO stranded
  FROM public.trash t
  WHERE t.batch = v_batch AND t.table_name = 'categories'
    AND NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.id = t.row_id)
  LIMIT 1;
  IF stranded IS NOT NULL THEN
    RAISE EXCEPTION 'Could not restore “%”: its parent did not come back.', stranded;
  END IF;

  -- ── Their history ─────────────────────────────────────────
  INSERT INTO public.schema_versions (
    id, category_id, version, snapshot, authored, change_summary, changed_by, created_at
  )
  SELECT r.id, r.category_id, r.version, r.snapshot, r.authored, r.change_summary,
         (SELECT u.id FROM auth.users u WHERE u.id = r.changed_by), r.created_at
  FROM public.trash t,
       jsonb_populate_record(NULL::public.schema_versions, t.row_data) r
  WHERE t.batch = v_batch AND t.table_name = 'schema_versions';
  GET DIAGNOSTICS n_versions = ROW_COUNT;

  -- ── Items, reconciled with today's schema ─────────────────
  WITH trashed AS (
    SELECT r.*
    FROM public.trash t,
         jsonb_populate_record(NULL::public.items, t.row_data) r
    WHERE t.batch = v_batch AND t.table_name = 'items'
  ),
  live_keys AS (
    SELECT c.category_id,
           COALESCE(array_agg(e->>'key') FILTER (WHERE e IS NOT NULL), ARRAY[]::TEXT[]) AS keys
    FROM (SELECT DISTINCT category_id FROM trashed) c
    LEFT JOIN LATERAL jsonb_array_elements(public.get_effective_schema(c.category_id)) e ON true
    GROUP BY c.category_id
  ),
  refit AS (
    SELECT t.*,
           COALESCE((SELECT jsonb_object_agg(x.k, x.v) FROM jsonb_each(t.data) x(k, v)
                     WHERE x.k = ANY(lk.keys)), '{}'::jsonb) AS kept,
           COALESCE(t.data->'__orphaned', '{}'::jsonb)
             || COALESCE((SELECT jsonb_object_agg(x.k, x.v) FROM jsonb_each(t.data) x(k, v)
                          WHERE x.k <> '__orphaned' AND NOT (x.k = ANY(lk.keys))), '{}'::jsonb)
             AS orphans,
           (SELECT count(*) FROM jsonb_each(t.data) x(k, v)
            WHERE x.k <> '__orphaned' AND NOT (x.k = ANY(lk.keys)))::int AS newly_orphaned
    FROM trashed t JOIN live_keys lk ON lk.category_id = t.category_id
  ),
  restored AS (
    INSERT INTO public.items (
      id, category_id, data, schema_version, created_at, updated_at, created_by, updated_by
    )
    SELECT r.id, r.category_id,
           r.kept || CASE WHEN r.orphans = '{}'::jsonb THEN '{}'::jsonb
                          ELSE jsonb_build_object('__orphaned', r.orphans) END,
           r.schema_version, r.created_at, r.updated_at,
           (SELECT u.id FROM auth.users u WHERE u.id = r.created_by),
           (SELECT u.id FROM auth.users u WHERE u.id = r.updated_by)
    FROM refit r
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM restored), COALESCE((SELECT sum(newly_orphaned) FROM refit), 0)
  INTO n_items, n_orphaned;

  DELETE FROM public.trash WHERE batch = v_batch;
  PERFORM set_config('zchema.restoring', 'off', true);

  RETURN jsonb_build_object(
    'categories',      n_cats,
    'items',           n_items,
    'versions',        n_versions,
    'orphaned_values', n_orphaned
  );
END;
$$;


-- ============================================================
-- 7. purge_trash(batch, confirm) → { purged }
-- ------------------------------------------------------------
-- The one way out of the trash that does not lead back. Like the
-- `discard` remediation, it is never a default: it needs a SCHEMA_ADMIN
-- and a separate confirm = true.
-- ============================================================
CREATE OR REPLACE FUNCTION public.purge_trash(p_batch TEXT, p_confirm BOOLEAN DEFAULT false)
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
    RAISE EXCEPTION 'Only a SCHEMA_ADMIN can empty the trash.';
  END;

  IF p_confirm IS NOT TRUE THEN
    RAISE EXCEPTION 'Emptying a trash entry destroys it for good. Confirm to proceed.';
  END IF;
  IF p_batch IS NULL OR p_batch !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'That is not a trash entry.';
  END IF;

  DELETE FROM public.trash WHERE batch = p_batch::bigint;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RAISE EXCEPTION 'That trash entry no longer exists — it may already have been restored or emptied.';
  END IF;

  RETURN jsonb_build_object('purged', n);
END;
$$;


-- ============================================================
-- 8. Grants
-- ------------------------------------------------------------
-- Signed-in callers only — see PRIVILEGE at the top of this file.
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.member_email(UUID)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_items(UUID[])           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.list_trash()                   FROM PUBLIC, anon;
-- Internal to list_trash() and restore_trash(), which run as the owner.
REVOKE EXECUTE ON FUNCTION public.trash_blocked_by(BIGINT)       FROM PUBLIC, anon, authenticated;
-- Called from delete_items() and delete_category_safely(), as the caller.
REVOKE EXECUTE ON FUNCTION public.start_trash_batch()            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_trash_batch()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_trash_batch()            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.current_trash_batch()          TO authenticated;
REVOKE EXECUTE ON FUNCTION public.restore_trash(TEXT)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.purge_trash(TEXT, BOOLEAN)     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.member_email(UUID)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_items(UUID[])            TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_trash()                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_trash(TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_trash(TEXT, BOOLEAN)      TO authenticated;

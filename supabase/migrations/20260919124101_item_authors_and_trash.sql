-- ============================================================
-- Item authorship, and a trash that every delete lands in
-- ------------------------------------------------------------
-- * items.created_by / updated_by, stamped by stamp_item_authors()
--   from the session — never from what the client sent.
-- * public.trash, and a trigger on items, categories and
--   schema_versions that copies every deleted row into it, so a delete
--   by any route can be undone. Rows deleted together share a batch.
--   list_trash(), restore_trash() and purge_trash() are the only way
--   in: clients hold no privilege on the table itself.
-- * delete_items() returns the batch it made, for Undo;
--   delete_category_safely() now returns its batch too.
-- * query_items() returns who created and last edited each row.
-- The functions themselves are documented in supabase/trash.sql.
-- ============================================================

-- ── Columns, the trash table and its sequence (schema.sql) ──
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.trash (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch      BIGINT NOT NULL,
  table_name TEXT NOT NULL CHECK (table_name IN ('categories', 'items', 'schema_versions')),
  row_id     UUID NOT NULL,
  row_data   JSONB NOT NULL,
  deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.trash_batch_seq;

CREATE INDEX IF NOT EXISTS idx_trash_batch ON public.trash (batch);
CREATE INDEX IF NOT EXISTS idx_trash_row ON public.trash (row_id);

CREATE OR REPLACE FUNCTION public.stamp_item_authors()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  from_client CONSTANT BOOLEAN := current_user IN ('anon', 'authenticated');
BEGIN
  IF NOT from_client AND current_setting('zchema.restoring', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF from_client OR NEW.created_by IS NULL THEN
      NEW.created_by := auth.uid();
    END IF;
    IF from_client OR NEW.updated_by IS NULL THEN
      NEW.updated_by := NEW.created_by;
    END IF;
  ELSE
    NEW.created_by := OLD.created_by;
    NEW.updated_by := COALESCE(auth.uid(), CASE WHEN from_client THEN NULL ELSE NEW.updated_by END);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS items_stamp_authors ON public.items;
CREATE TRIGGER items_stamp_authors
  BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_item_authors();

REVOKE EXECUTE ON FUNCTION public.stamp_item_authors() FROM PUBLIC, anon, authenticated;

-- ── The trash is reached only through functions (policies.sql) ──
ALTER TABLE public.trash ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.trash FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.trash_batch_seq FROM anon, authenticated;

-- ── Capture, list, restore, purge (trash.sql) ───────────────
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

-- ── Category deletes are one entry, and say which (impact.sql) ──
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
  -- This deletion is one trash entry of its own (trash.sql).
  PERFORM public.start_trash_batch();

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
    'deleted_items',      n_items - n_moved,
    'trash_batch',        public.current_trash_batch()
  );
END;
$$;

-- ── Authors on every Items-tab row (functions.sql) ──────────
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

    -- A range may carry only an upper bound (value2); every other operator
    -- needs `value`. Range used to fall into this CONTINUE too, so "at most
    -- 15" with no minimum filtered nothing at all.
    ELSIF fop <> 'range' AND (fval IS NULL OR fval = '') THEN
      CONTINUE;

    ELSIF fop = 'contains' THEN
      -- LIKE metacharacters escaped, as search_items does: filtering for
      -- "50%" means that string, not "anything containing 50".
      where_sql := where_sql || format(
        ' AND i.data->>%L ILIKE %L ESCAPE %L',
        fkey,
        '%' || replace(replace(replace(fval, '\', '\\'), '%', '\%'), '_', '\_') || '%',
        '\'
      );

    ELSIF fop = 'eq' THEN
      where_sql := where_sql || format(' AND i.data->>%L = %L', fkey, fval);

    ELSIF fop = 'bool' THEN
      -- An unreadable filter value is ignored, like an unrecognised key; an
      -- unreadable stored value simply does not match. The bare ::boolean
      -- this replaces aborted the whole Items tab on one "maybe".
      CONTINUE WHEN public.try_boolean(fval) IS NULL;
      where_sql := where_sql || format(
        ' AND public.try_boolean(i.data->>%L) = %L::boolean',
        fkey, public.try_boolean(fval)::text
      );

    ELSIF fop = 'in' THEN
      -- `value` is a comma-separated list of allowed values.
      where_sql := where_sql || format(
        ' AND i.data->>%L = ANY (string_to_array(%L, %L))', fkey, fval, ','
      );

    ELSIF fop = 'range' THEN
      -- try_numeric on both sides. It used to be a regex check followed by
      -- a ::numeric cast in the same AND chain — not a guard at all, since
      -- Postgres may evaluate the cast first. A bound that is not a number
      -- is ignored; a range with no usable bound is ignored entirely.
      CONTINUE WHEN public.try_numeric(fval) IS NULL AND public.try_numeric(fval2) IS NULL;
      IF public.try_numeric(fval) IS NOT NULL THEN
        where_sql := where_sql || format(
          ' AND public.try_numeric(i.data->>%L) >= %L::numeric',
          fkey, public.try_numeric(fval)::text
        );
      END IF;
      IF public.try_numeric(fval2) IS NOT NULL THEN
        where_sql := where_sql || format(
          ' AND public.try_numeric(i.data->>%L) <= %L::numeric',
          fkey, public.try_numeric(fval2)::text
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
  -- Every order ends in i.id. Paging with LIMIT/OFFSET is only correct
  -- over a TOTAL order, and ties are common: an import or a seed writes
  -- all its rows in one statement, so they share one created_at. Among
  -- ties Postgres promises no order, so without the tiebreaker a page
  -- may repeat a row from the last one and skip another. The default
  -- order matches idx_items_category_created exactly.
  IF p_sort_key IS NULL OR p_sort_key = '' THEN
    order_sql := 'i.created_at DESC, i.id';
  ELSIF p_sort_key = 'created_at' OR p_sort_key = 'updated_at' THEN
    order_sql := format('i.%I %s, i.id', p_sort_key, dir);
  ELSIF p_sort_key !~ key_re THEN
    order_sql := 'i.created_at DESC, i.id';
  ELSE
    -- The typed read is what makes 8 sort before 16, and 2024-02 before
    -- 2024-10. The try_* helpers turn a stray unreadable value into a
    -- NULL, which sorts last, instead of aborting the whole query. (The
    -- date sort used to admit "2024-02-30" through its regex and then
    -- fail on the cast.)
    cast_expr := CASE p_sort_type
      WHEN 'number'  THEN format('public.try_numeric(i.data->>%L)', p_sort_key)
      WHEN 'date'    THEN format('public.try_date(i.data->>%L)', p_sort_key)
      WHEN 'boolean' THEN format('public.try_boolean(i.data->>%L)', p_sort_key)
      ELSE format('lower(i.data->>%L)', p_sort_key)
    END;
    order_sql := format('%s %s NULLS LAST, i.created_at DESC, i.id', cast_expr, dir);
  END IF;

  -- ── Count, then page ──────────────────────────────────────
  EXECUTE format(
    '%s SELECT count(*)::int FROM public.items i %s WHERE %s AND %s %s',
    health_cte, health_join, scope_sql, where_sql, health_where
  ) INTO total;

  EXECUTE format(
    '%s SELECT COALESCE(jsonb_agg(rw ORDER BY rw.ord), %L::jsonb) FROM ('
    || 'SELECT row_number() OVER (ORDER BY %s) AS ord, i.id, i.category_id, i.data, '
    || 'i.schema_version, i.created_at, i.updated_at, c.name AS category_name, '
    || 'public.member_email(i.created_by) AS created_by_email, '
    || 'public.member_email(i.updated_by) AS updated_by_email '
    || 'FROM public.items i JOIN public.categories c ON c.id = i.category_id %s '
    || 'WHERE %s AND %s %s ORDER BY %s LIMIT %s OFFSET %s'
    || ') rw',
    health_cte, '[]', order_sql, health_join, scope_sql, where_sql, health_where, order_sql,
    GREATEST(COALESCE(p_limit, 50), 1), GREATEST(COALESCE(p_offset, 0), 0)
  ) INTO rows_json;

  RETURN jsonb_build_object('total', COALESCE(total, 0), 'rows', COALESCE(rows_json, '[]'::jsonb));
END;
$$;


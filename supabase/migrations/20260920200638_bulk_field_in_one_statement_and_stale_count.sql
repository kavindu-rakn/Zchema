-- ============================================================
-- 12. set_item_field(p_items, p_key, p_value, p_force)  → JSONB
-- ------------------------------------------------------------
-- Set one field to one value across many items, in ONE statement.
--
-- Was a read followed by an UPDATE per row: 200 selected items meant
-- 201 round trips, and the reads were stale by the time the writes
-- landed, so a bulk edit silently overwrote whatever anyone else had
-- saved in between.
--
-- `p_items` carries the `updated_at` each row had when the user
-- selected it — the same optimistic token an item save sends. A row
-- that has moved on since is left alone and reported back, so the
-- caller can name what it skipped and offer to apply to those too
-- (p_force, which is the deliberate overwrite, never the default).
--
-- Each row is stamped with ITS OWN category's current schema version.
-- Selecting across a subtree means several categories, and stamping
-- them all with the one the page happens to be showing would record a
-- version those items were never written against.
--
-- A JSON `null` value clears the key rather than storing null — the
-- convention `data` already follows, where absent means empty.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_item_field(
  p_items JSONB,
  p_key   TEXT,
  p_value JSONB,
  p_force BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated    INT;
  v_conflicted UUID[];
BEGIN
  -- RLS would refuse the writes anyway, but silently: a VIEWER would
  -- hear "0 updated, 12 conflicted" and go looking for a colleague who
  -- never touched anything.
  PERFORM public.require_data_editor();

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('updated', 0, 'conflicted', '[]'::jsonb);
  END IF;

  -- The key is written as JSONB data and never as SQL, so this is not
  -- an injection guard — it keeps a key that no schema could define
  -- out of `data`, where it would read as orphaned forever.
  IF p_key !~ '^[a-z][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Not a valid field key: %', p_key USING ERRCODE = 'PT400';
  END IF;

  WITH wanted AS (
    SELECT (e->>'id')::UUID          AS id,
           (e->>'updated_at')::TIMESTAMPTZ AS seen
    FROM jsonb_array_elements(p_items) e
  ),
  -- One lookup per category involved, not per item.
  versions AS (
    SELECT sv.category_id, MAX(sv.version) AS version
    FROM public.schema_versions sv
    WHERE sv.category_id IN (
      SELECT i.category_id FROM public.items i JOIN wanted w ON w.id = i.id
    )
    GROUP BY sv.category_id
  ),
  changed AS (
    UPDATE public.items i
       SET data = CASE
                    WHEN p_value IS NULL OR jsonb_typeof(p_value) = 'null'
                      THEN i.data - p_key
                    ELSE jsonb_set(i.data, ARRAY[p_key], p_value, true)
                  END,
           schema_version = COALESCE(
             (SELECT v.version FROM versions v WHERE v.category_id = i.category_id),
             i.schema_version
           )
      FROM wanted w
     WHERE i.id = w.id
       AND (p_force OR w.seen IS NULL OR i.updated_at = w.seen)
    RETURNING i.id
  )
  SELECT (SELECT count(*) FROM changed)::INT,
         COALESCE(
           (SELECT array_agg(w.id) FROM wanted w
             WHERE w.id NOT IN (SELECT c.id FROM changed c)),
           ARRAY[]::UUID[]
         )
    INTO v_updated, v_conflicted;

  RETURN jsonb_build_object(
    'updated',    v_updated,
    'conflicted', to_jsonb(v_conflicted)
  );
END;
$$;


-- ============================================================
-- 13. get_stale_items(p_category_id)  → JSONB
-- ------------------------------------------------------------
-- How far a category's item data has drifted behind its schema.
--
-- `items.schema_version` is only bumped on items a migration actually
-- TOUCHED, which is what makes this meaningful: an item still on v3
-- was written against v3 and no remediation has needed to visit it
-- since.
--
-- Counted here rather than in the application, which read every item's
-- version into memory to count them — unbounded in the one place a
-- large category is most likely.
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_stale_items(p_category_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH current AS (
    SELECT COALESCE(MAX(sv.version), 0) AS version
    FROM public.schema_versions sv
    WHERE sv.category_id = p_category_id
  )
  SELECT jsonb_build_object(
    'current_version', c.version,
    'stale_count',     count(i.id)::int,
    'oldest_version',  min(i.schema_version)
  )
  FROM current c
  LEFT JOIN public.items i
    ON i.category_id = p_category_id
   AND i.schema_version < c.version
  GROUP BY c.version;
$$;

-- ============================================================
-- Refuse a schema save that would overwrite someone else's change
-- ------------------------------------------------------------
-- Two admins editing one schema was last-writer-wins: the second save
-- replaced the whole own_fields/overrides, and the first admin's change
-- vanished without a word. apply_schema_change() now takes
-- p_expected_version — the version the editor loaded — locks the
-- category row, and refuses with SQLSTATE PT409 (HTTP 409 through
-- PostgREST) if the category has been versioned since. NULL skips the
-- check, so rollback_schema_version() and other internal callers are
-- unchanged.
--
-- The new parameter changes the signature, so the old one is dropped
-- first; leaving both would make every PostgREST call ambiguous.
-- ============================================================

DROP FUNCTION IF EXISTS public.apply_schema_change(UUID, JSONB, JSONB, JSONB, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.apply_schema_change(
  p_category_id      UUID,
  p_new_own_fields   JSONB,
  p_new_overrides    JSONB,
  p_remediations     JSONB DEFAULT '{}'::jsonb,
  p_changed_by       UUID  DEFAULT NULL,
  -- Prepended to change_summary when the caller is not a plain edit.
  -- rollback_schema_version() uses it to mark its forward version.
  p_origin           JSONB DEFAULT NULL,
  p_expected_version INT   DEFAULT NULL
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
  current_ver  INT;
BEGIN
  PERFORM public.require_schema_admin();

  -- ── 0. Nobody changed this schema since the editor loaded it ──
  -- The row lock comes first, so two saves cannot both pass the check
  -- and then both apply: the second waits here until the first commits,
  -- then sees its version and stops.
  PERFORM 1 FROM public.categories WHERE id = p_category_id FOR UPDATE;
  IF p_expected_version IS NOT NULL THEN
    SELECT COALESCE(max(v.version), 0) INTO current_ver
    FROM public.schema_versions v WHERE v.category_id = p_category_id;
    IF current_ver <> p_expected_version THEN
      RAISE EXCEPTION 'This schema changed while you were editing it: it is at v% now, and you started from v%.',
        current_ver, p_expected_version
        USING ERRCODE = 'PT409',
              HINT = 'Reload to see the change. Your draft stays; saving again reviews it against the new schema.';
    END IF;
  END IF;

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


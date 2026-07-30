-- ============================================================
-- SchemaShift — reparent & delete through impact analysis
-- (Phase 5, Increment 5)
--
-- Run AFTER impact.sql is applied. Builds its own sandbox tree and
-- tears it down, so seed data is untouched and the counts are exact.
--
-- Covers:
--   * analyze_category_move classifies LOST inherited fields as
--     destructive and counts the items holding them
--   * a move with no remediation is REFUSED, exactly like a schema edit
--   * `orphan` on a move preserves the stranded values
--   * a key collision with the new parent BLOCKS the move
--   * moving a category under its own descendant BLOCKS
--   * an override the new parent cannot supply BLOCKS
--   * preview_category_delete reports what a move-to-parent would
--     carry and what it would orphan
--   * delete_category_safely(move) rescues the items instead of
--     cascading them, and cascade actually deletes them
--
-- Expected: 14 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _struct_results;
CREATE TEMP TABLE _struct_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DO $$
DECLARE
  a      UUID := 'bb000000-0000-0000-0000-0000000000a1';  -- root A
  b      UUID := 'bb000000-0000-0000-0000-0000000000b1';  -- root B
  clash  UUID := 'bb000000-0000-0000-0000-0000000000c9';  -- root that collides
  kid    UUID := 'bb000000-0000-0000-0000-0000000000d1';  -- child of A
  i1     UUID := 'bb000000-0000-0000-0000-0000000000e1';
  i2     UUID := 'bb000000-0000-0000-0000-0000000000e2';
  i3     UUID := 'bb000000-0000-0000-0000-0000000000e3';

  res    JSONB;
  ch     JSONB;
  d      JSONB;
  ok     BOOLEAN;
  msg    TEXT;
BEGIN
  -- ── Sandbox ───────────────────────────────────────────────
  DELETE FROM public.categories
   WHERE id IN (a, b, clash)
      OR (parent_id IS NULL AND slug IN ('zz-struct-a','zz-struct-b','zz-struct-clash'));

  INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
  (a, 'ZZ Struct A', 'zz-struct-a', NULL, '[
     {"key":"zz_shared","label":"Shared","type":"string","required":false,"position":0},
     {"key":"zz_a_only","label":"A Only","type":"string","required":false,"position":1}
   ]'::jsonb),
  (b, 'ZZ Struct B', 'zz-struct-b', NULL, '[
     {"key":"zz_shared","label":"Shared","type":"string","required":false,"position":0},
     {"key":"zz_b_only","label":"B Only","type":"string","required":false,"position":1}
   ]'::jsonb),
  (clash, 'ZZ Struct Clash', 'zz-struct-clash', NULL, '[
     {"key":"zz_kid_own","label":"Kid Own","type":"string","required":false,"position":0}
   ]'::jsonb),
  (kid, 'ZZ Struct Kid', 'zz-struct-kid', a, '[
     {"key":"zz_kid_own","label":"Kid Own","type":"string","required":false,"position":0}
   ]'::jsonb);

  INSERT INTO public.items (id, category_id, data) VALUES
  (i1, kid, '{"zz_shared":"S1","zz_a_only":"A1","zz_kid_own":"K1"}'::jsonb),
  (i2, kid, '{"zz_shared":"S2","zz_a_only":"A2","zz_kid_own":"K2"}'::jsonb),
  (i3, kid, '{"zz_shared":"S3","zz_a_only":"A3","zz_kid_own":"K3"}'::jsonb);

  -- ── 1. The lost inherited field is DESTRUCTIVE ────────────
  res := public.analyze_category_move(kid, b);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'zz_a_only' AND c->>'kind' = 'remove_field';

  INSERT INTO _struct_results VALUES (1,
    'Moving away from A: "zz_a_only" is DESTRUCTIVE and counts the 3 items holding it',
    ch->>'severity' = 'destructive' AND (ch->>'affected_item_count')::int = 3,
    format('sev=%s affected=%s samples=%s',
      ch->>'severity', ch->>'affected_item_count',
      COALESCE(ch->'sample_values','[]'::jsonb)::text));

  -- ── 2. The gained field is SAFE, the shared one is silent ─
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'zz_b_only';

  INSERT INTO _struct_results VALUES (2,
    'The gained optional field is SAFE, and the field both parents share reports nothing',
    ch->>'severity' = 'safe'
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(res->'changes') c
                       WHERE c->>'field_key' = 'zz_shared'),
    format('b_only=%s changes=%s', ch->>'severity',
      (SELECT string_agg(c->>'field_key' || ':' || (c->>'kind'), ', ')
         FROM jsonb_array_elements(res->'changes') c)));

  INSERT INTO _struct_results VALUES (3,
    'The moved category''s OWN field travels with it and is not reported as lost',
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(res->'changes') c
                 WHERE c->>'field_key' = 'zz_kid_own'),
    (res->>'max_severity'));

  -- ── 4. A move with no remediation is REFUSED ──────────────
  BEGIN
    PERFORM public.apply_category_move(kid, b, '{}'::jsonb, NULL);
    ok := false; msg := '(no exception raised)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;
  INSERT INTO _struct_results VALUES (4,
    'A move that strands values with NO remediation is REFUSED', ok, msg);

  INSERT INTO _struct_results VALUES (5,
    'The refusal left the tree untouched — the category never moved',
    (SELECT parent_id FROM public.categories WHERE id = kid) = a,
    format('parent=%s', (SELECT parent_id FROM public.categories WHERE id = kid)));

  -- ── 6. Colliding with the new parent BLOCKS ───────────────
  res := public.analyze_category_move(kid, clash);
  INSERT INTO _struct_results VALUES (6,
    'A key defined in the subtree AND inherited from the new parent BLOCKS the move',
    (res->>'blocked')::boolean = true AND res->>'blocked_reason' ILIKE '%zz_kid_own%',
    format('blocked=%s reason=%s', res->>'blocked', res->>'blocked_reason'));

  -- ── 7. Moving a parent under its own child BLOCKS ─────────
  res := public.analyze_category_move(a, kid);
  INSERT INTO _struct_results VALUES (7,
    'Moving a category into its own subtree BLOCKS (cycle)',
    (res->>'blocked')::boolean = true,
    format('blocked=%s reason=%s', res->>'blocked', res->>'blocked_reason'));

  -- ── 8. An override the new parent cannot supply BLOCKS ────
  UPDATE public.categories
     SET overrides = '{"zz_a_only":{"label":"Renamed Here"}}'::jsonb
   WHERE id = kid;

  res := public.analyze_category_move(kid, b);
  INSERT INTO _struct_results VALUES (8,
    'An override targeting a field the new parent lacks BLOCKS rather than being dropped',
    (res->>'blocked')::boolean = true AND res->>'blocked_reason' ILIKE '%zz_a_only%',
    format('blocked=%s reason=%s', res->>'blocked', res->>'blocked_reason'));

  UPDATE public.categories SET overrides = '{}'::jsonb WHERE id = kid;

  -- ── 9. Apply the move with `orphan` ───────────────────────
  res := public.apply_category_move(
    kid, b, '{"zz_a_only":{"strategy":"orphan"}}'::jsonb, NULL);

  INSERT INTO _struct_results VALUES (9,
    'The move applies, reconciling all 3 items and orphaning their stranded values',
    (res->>'items_updated')::int = 3 AND (res->>'items_orphaned')::int = 3,
    format('updated=%s orphaned=%s version=%s',
      res->>'items_updated', res->>'items_orphaned', res->>'version'));

  SELECT data INTO d FROM public.items WHERE id = i1;
  INSERT INTO _struct_results VALUES (10,
    'Nothing was lost: "A1" is preserved as orphaned data and the key is gone from data',
    d->'__orphaned'->>'zz_a_only' = 'A1'
      AND NOT (d ? 'zz_a_only')
      AND d->>'zz_shared' = 'S1'
      AND (SELECT parent_id FROM public.categories WHERE id = kid) = b,
    d::text);

  INSERT INTO _struct_results VALUES (11,
    'The move is recorded in the audit trail as a reparent',
    (SELECT change_summary->0->>'kind' FROM public.schema_versions
      WHERE category_id = kid ORDER BY version DESC LIMIT 1) = 'reparent',
    (SELECT (change_summary->0)::text FROM public.schema_versions
      WHERE category_id = kid ORDER BY version DESC LIMIT 1));

  -- ── 12. preview_category_delete is honest about the move ──
  res := public.preview_category_delete(kid);
  INSERT INTO _struct_results VALUES (12,
    'Delete preview: 3 items, rescuable to B, carrying only the fields both schemas share',
    (res->>'item_count')::int = 3
      AND (res->>'can_move_to_parent')::boolean = true
      AND res->'carried_keys' @> '["zz_shared"]'::jsonb
      AND res->'orphaned_keys' @> '["zz_kid_own"]'::jsonb,
    format('items=%s carried=%s orphaned=%s',
      res->>'item_count', res->'carried_keys'::text, res->'orphaned_keys'::text));

  -- ── 13. Delete, rescuing the items to the parent ──────────
  res := public.delete_category_safely(kid, true);
  INSERT INTO _struct_results VALUES (13,
    'delete_category_safely(move): the category goes, the 3 items survive on B',
    (res->>'moved_items')::int = 3
      AND (res->>'deleted_items')::int = 0
      AND NOT EXISTS (SELECT 1 FROM public.categories WHERE id = kid)
      AND (SELECT count(*)::int FROM public.items WHERE category_id = b) = 3,
    format('moved=%s deleted_items=%s on_B=%s',
      res->>'moved_items', res->>'deleted_items',
      (SELECT count(*) FROM public.items WHERE category_id = b)));

  -- ── 14. Cascade really does delete ────────────────────────
  res := public.delete_category_safely(b, false);
  INSERT INTO _struct_results VALUES (14,
    'delete_category_safely(cascade): the items are destroyed with the category',
    (res->>'deleted_items')::int = 3
      AND (res->>'moved_items')::int = 0
      AND NOT EXISTS (SELECT 1 FROM public.items WHERE id IN (i1, i2, i3)),
    format('deleted_items=%s surviving=%s',
      res->>'deleted_items',
      (SELECT count(*) FROM public.items WHERE id IN (i1, i2, i3))));

  -- ── Tear down ─────────────────────────────────────────────
  DELETE FROM public.categories WHERE id IN (a, b, clash);
END $$;

-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _struct_results
ORDER BY n;

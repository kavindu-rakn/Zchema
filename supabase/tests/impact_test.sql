-- ============================================================
-- SchemaShift — impact analysis severity suite (Phase 5, Inc 6)
--
-- Impact analysis that is WRONG is worse than none: it manufactures
-- confidence immediately before a destructive act. So every row of the
-- Increment 1 severity table gets an assertion here, plus the awkward
-- cases that a naive implementation gets wrong.
--
-- WHY A SANDBOX RATHER THAN THE SEED DATA
-- The plan suggested asserting against seedAmazon. A purpose-built
-- tree is used instead because these assertions turn on EXACT counts —
-- "removing this option strands exactly 3 items", "2 of these 8 values
-- will not cast". Pinning those to seed data makes the suite silently
-- wrong the day someone adds a row to the seed, and a test that stops
-- meaning what it says is worse than no test. The tree below is built,
-- asserted against, and torn down, so seed data is never touched and
-- the file is re-runnable.
--
-- Companion files:
--   impact_smoke_test.sql        — shape + the read-only proof
--   apply_schema_change_test.sql — strategy round-trips + atomicity
--   structural_ops_test.sql      — reparent + delete
--
-- Expected: 22 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _sev_results;
CREATE TEMP TABLE _sev_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DO $$
DECLARE
  root UUID := 'cc000000-0000-0000-0000-00000000a001';
  kid  UUID := 'cc000000-0000-0000-0000-00000000a002';
  leaf UUID := 'cc000000-0000-0000-0000-00000000a003';

  own   JSONB;   -- root's own_fields, re-read as it changes
  res   JSONB;
  ch    JSONB;
  d     JSONB;
  ok    BOOLEAN;
  msg   TEXT;

  items_before  BIGINT;
  digest_before TEXT;
BEGIN
  -- ── Sandbox ───────────────────────────────────────────────
  DELETE FROM public.categories
   WHERE id = root OR (parent_id IS NULL AND slug = 'zz-sev-root');

  INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
  (root, 'ZZ Sev Root', 'zz-sev-root', NULL, '[
     {"key":"s_text","label":"Text","type":"string","required":false,"position":0},
     {"key":"s_num","label":"Number","type":"number","required":false,"position":1},
     {"key":"s_months","label":"Months","type":"string","required":false,"position":2},
     {"key":"s_color","label":"Colour","type":"select","required":false,"position":3,
      "options":["red","green","blue"]},
     {"key":"s_opt","label":"Optional","type":"string","required":false,"position":4}
   ]'::jsonb),
  (kid,  'ZZ Sev Kid',  'zz-sev-kid',  root, '[
     {"key":"kid_field","label":"Kid Field","type":"string","required":false,"position":0}
   ]'::jsonb),
  (leaf, 'ZZ Sev Leaf', 'zz-sev-leaf', kid,  '[
     {"key":"leaf_field","label":"Leaf Field","type":"string","required":false,"position":0}
   ]'::jsonb);

  -- 5 items on the root, 3 on the kid, 0 on the leaf.
  --   s_color   : red x3, green x2, blue x3
  --   s_months  : two values that CANNOT become numbers, six that can
  --   s_opt     : blank on one item, absent on another
  INSERT INTO public.items (id, category_id, data) VALUES
  ('cc000000-0000-0000-0000-00000000b001', root,
   '{"s_text":"T1","s_num":10,"s_months":"12 months","s_color":"red","s_opt":"O1"}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b002', root,
   '{"s_text":"T2","s_num":20,"s_months":"6 months","s_color":"red","s_opt":""}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b003', root,
   '{"s_text":"T3","s_num":30,"s_months":"24","s_color":"red","s_opt":"O3"}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b004', root,
   '{"s_text":"T4","s_num":40,"s_months":"36","s_color":"green"}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b005', root,
   '{"s_text":"T5","s_num":50,"s_months":"48","s_color":"blue","s_opt":"O5"}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b006', kid,
   '{"s_text":"T6","s_num":60,"s_months":"60","s_color":"blue","s_opt":"O6","kid_field":"K6"}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b007', kid,
   '{"s_text":"T7","s_num":70,"s_months":"72","s_color":"blue","s_opt":"O7","kid_field":"K7"}'::jsonb),
  ('cc000000-0000-0000-0000-00000000b008', kid,
   '{"s_text":"T8","s_num":80,"s_months":"84","s_color":"green","s_opt":"O8","kid_field":"K8"}'::jsonb);

  SELECT own_fields INTO own FROM public.categories WHERE id = root;

  SELECT count(*) INTO items_before FROM public.items;
  SELECT md5(string_agg(i.id::text || i.data::text, '|' ORDER BY i.id))
    INTO digest_before FROM public.items i;

  -- ══ SEVERITY TABLE ═══════════════════════════════════════

  -- ── 1. Add optional field → SAFE, 0 affected ──────────────
  res := public.analyze_schema_change(root,
    own || '[{"key":"n_optional","label":"New Optional","type":"string",
              "required":false,"position":9}]'::jsonb, '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'n_optional';
  INSERT INTO _sev_results VALUES (1,
    'Add optional field → SAFE, 0 affected items',
    ch->>'severity' = 'safe' AND (ch->>'affected_item_count')::int = 0
      AND res->>'max_severity' = 'safe',
    format('sev=%s affected=%s max=%s',
      ch->>'severity', ch->>'affected_item_count', res->>'max_severity'));

  -- ── 2. Add required field → WARNING, every item lacks it ──
  -- This is also the "descendants hold the items" case: 5 live on the
  -- root, 3 on the kid, and all 8 must be counted.
  res := public.analyze_schema_change(root,
    own || '[{"key":"n_required","label":"New Required","type":"string",
              "required":true,"position":9}]'::jsonb, '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'n_required';
  INSERT INTO _sev_results VALUES (2,
    'Add required field → WARNING, counting all 8 items across the subtree',
    ch->>'severity' = 'warning' AND (ch->>'affected_item_count')::int = 8
      AND (res->>'total_affected_items')::int = 8
      AND jsonb_array_length(res->'affected_categories') = 3,
    format('sev=%s affected=%s total=%s categories=%s',
      ch->>'severity', ch->>'affected_item_count', res->>'total_affected_items',
      jsonb_array_length(res->'affected_categories')));

  -- ── 3. Remove field → DESTRUCTIVE, holders counted + samples ─
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(own) e WHERE e->>'key' <> 's_text'),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_text' AND c->>'kind' = 'remove_field';
  INSERT INTO _sev_results VALUES (3,
    'Remove field → DESTRUCTIVE, 8 holders, at most 5 sample values',
    ch->>'severity' = 'destructive'
      AND (ch->>'affected_item_count')::int = 8
      AND jsonb_array_length(ch->'sample_values') BETWEEN 1 AND 5,
    format('sev=%s affected=%s samples=%s',
      ch->>'severity', ch->>'affected_item_count', (ch->'sample_values')::text));

  -- ── 4. Retype number → string: every value casts (lossy 0) ─
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_num'
                           THEN e || '{"type":"string"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_num' AND c->>'kind' = 'retype_field';
  INSERT INTO _sev_results VALUES (4,
    'Retype number→string → DESTRUCTIVE but lossy_item_count = 0',
    ch->>'severity' = 'destructive'
      AND (ch->>'affected_item_count')::int = 8
      AND (ch->>'lossy_item_count')::int = 0,
    format('sev=%s affected=%s lossy=%s',
      ch->>'severity', ch->>'affected_item_count', ch->>'lossy_item_count'));

  -- ── 5. Retype string → number: "12 months" cannot cast ────
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_months'
                           THEN e || '{"type":"number"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_months' AND c->>'kind' = 'retype_field';
  INSERT INTO _sev_results VALUES (5,
    'Retype string→number → exactly 2 of 8 are lossy ("12 months", "6 months")',
    (ch->>'affected_item_count')::int = 8
      AND (ch->>'lossy_item_count')::int = 2,
    format('affected=%s lossy=%s samples=%s',
      ch->>'affected_item_count', ch->>'lossy_item_count', (ch->'sample_values')::text));

  INSERT INTO _sev_results VALUES (6,
    'The lossy samples are the values that actually fail, not an arbitrary five',
    ch->'sample_values' @> '["12 months"]'::jsonb
      AND ch->'sample_values' @> '["6 months"]'::jsonb
      AND jsonb_array_length(ch->'sample_values') = 2,
    (ch->'sample_values')::text);

  -- ── 7. Optional → required → WARNING, only the blanks ─────
  -- Item 2 holds "" and item 4 has no key at all. Both count; the six
  -- that hold a value must not.
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_opt'
                           THEN e || '{"required":true}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_opt' AND c->>'kind' = 'require_field';
  INSERT INTO _sev_results VALUES (7,
    'Optional→required → WARNING, counting only the 2 blank/missing items',
    ch->>'severity' = 'warning' AND (ch->>'affected_item_count')::int = 2,
    format('sev=%s affected=%s', ch->>'severity', ch->>'affected_item_count'));

  -- ── 8. Required → optional → SAFE, 0 ──────────────────────
  UPDATE public.categories
     SET own_fields = (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_opt'
                                             THEN e || '{"required":true}'::jsonb ELSE e END)
                       FROM jsonb_array_elements(own) e)
   WHERE id = root;

  res := public.analyze_schema_change(root, own, '{}'::jsonb);   -- back to optional
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_opt' AND c->>'kind' = 'unrequire_field';
  INSERT INTO _sev_results VALUES (8,
    'Required→optional → SAFE, 0 affected (relaxing cannot invalidate stored data)',
    ch->>'severity' = 'safe' AND (ch->>'affected_item_count')::int = 0,
    format('sev=%s affected=%s', ch->>'severity', ch->>'affected_item_count'));

  UPDATE public.categories SET own_fields = own WHERE id = root;

  -- ── 9. Remove a select option 3 items hold → DESTRUCTIVE ──
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_color'
                           THEN e || '{"options":["green","blue"]}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_color' AND c->>'kind' = 'change_options';
  INSERT INTO _sev_results VALUES (9,
    'Remove a select option → DESTRUCTIVE, counting the 3 items holding "red"',
    ch->>'severity' = 'destructive' AND (ch->>'affected_item_count')::int = 3
      AND ch->'sample_values' @> '["red"]'::jsonb,
    format('sev=%s affected=%s removed=%s',
      ch->>'severity', ch->>'affected_item_count', (ch->'sample_values')::text));

  -- ── 10. Add a select option → SAFE, 0 ─────────────────────
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_color'
                           THEN e || '{"options":["red","green","blue","purple"]}'::jsonb
                           ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_color' AND c->>'kind' = 'change_options';
  INSERT INTO _sev_results VALUES (10,
    'Add a select option → SAFE, 0 affected',
    ch->>'severity' = 'safe' AND (ch->>'affected_item_count')::int = 0
      AND res->>'max_severity' = 'safe',
    format('sev=%s affected=%s max=%s',
      ch->>'severity', ch->>'affected_item_count', res->>'max_severity'));

  -- ── 11. Label change → SAFE, 0 ────────────────────────────
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_text'
                           THEN e || '{"label":"Renamed Text"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_text' AND c->>'kind' = 'rename_label';
  INSERT INTO _sev_results VALUES (11,
    'Label change → SAFE, 0 affected, and nothing else is reported',
    ch->>'severity' = 'safe' AND (ch->>'affected_item_count')::int = 0
      AND jsonb_array_length(res->'changes') = 1,
    format('sev=%s changes=%s', ch->>'severity', jsonb_array_length(res->'changes')));

  -- ── 12. Help-text change → SAFE, but REPORTED ─────────────
  -- It must be reported even though no item value can notice: the
  -- impact dialog disables its apply button on an empty analysis, so
  -- an unreported change is one the user cannot save.
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_text'
                           THEN e || '{"help_text":"Some guidance"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e), '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_text' AND c->>'kind' = 'change_help_text';
  INSERT INTO _sev_results VALUES (12,
    'Help-text change → SAFE with 0 affected, and still reported so it can be applied',
    ch->>'severity' = 'safe' AND (ch->>'affected_item_count')::int = 0
      AND jsonb_array_length(res->'changes') = 1
      AND res->>'max_severity' = 'safe',
    format('sev=%s changes=%s max=%s',
      ch->>'severity', jsonb_array_length(res->'changes'), res->>'max_severity'));

  -- ── 13. Override that changes `required` → WARNING ────────
  res := public.analyze_schema_change(kid,
    (SELECT own_fields FROM public.categories WHERE id = kid),
    '{"s_opt":{"required":true}}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_opt' AND c->>'kind' = 'add_override';
  INSERT INTO _sev_results VALUES (13,
    'Override that flips `required` → WARNING',
    ch->>'severity' = 'warning',
    format('sev=%s changes=%s', ch->>'severity',
      (SELECT string_agg(c->>'kind' || ':' || (c->>'severity'), ', ')
         FROM jsonb_array_elements(res->'changes') c)));

  INSERT INTO _sev_results VALUES (14,
    'That override also reports the require_field consequence with real counts',
    EXISTS (SELECT 1 FROM jsonb_array_elements(res->'changes') c
             WHERE c->>'kind' = 'require_field' AND c->>'field_key' = 's_opt'),
    (SELECT (c)::text FROM jsonb_array_elements(res->'changes') c
      WHERE c->>'kind' = 'require_field' LIMIT 1));

  -- ── 15. Override that only changes a label → SAFE ─────────
  res := public.analyze_schema_change(kid,
    (SELECT own_fields FROM public.categories WHERE id = kid),
    '{"s_text":{"label":"Kid Label"}}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'kind' = 'add_override';
  INSERT INTO _sev_results VALUES (15,
    'Override that only changes a label → SAFE',
    ch->>'severity' = 'safe' AND res->>'max_severity' = 'safe',
    format('sev=%s max=%s', ch->>'severity', res->>'max_severity'));

  -- ══ AWKWARD CASES ════════════════════════════════════════

  -- ── 16. A change on a leaf with ZERO items ────────────────
  res := public.analyze_schema_change(leaf,
    (SELECT own_fields FROM public.categories WHERE id = leaf)
      || '[{"key":"leaf_new","label":"Leaf New","type":"string",
            "required":true,"position":9}]'::jsonb,
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'leaf_new';
  INSERT INTO _sev_results VALUES (16,
    'A required field on an EMPTY leaf → still valid, every count 0',
    (res->>'blocked')::boolean = false
      AND (res->>'total_affected_items')::int = 0
      AND (ch->>'affected_item_count')::int = 0
      AND ch->>'severity' = 'warning',
    format('blocked=%s total=%s affected=%s sev=%s',
      res->>'blocked', res->>'total_affected_items',
      ch->>'affected_item_count', ch->>'severity'));

  -- ── 17. Removing a field a leaf cannot see ────────────────
  -- s_months is inherited by the leaf, but no leaf item holds it, so
  -- the leaf contributes 0 to the count while the root contributes 8.
  res := public.analyze_schema_change(root,
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(own) e WHERE e->>'key' <> 's_months'),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 's_months';
  INSERT INTO _sev_results VALUES (17,
    'Item counts come from real rows, not from category membership',
    (ch->>'affected_item_count')::int = 8
      AND (res->>'total_affected_items')::int = 8,
    format('holders=%s subtree_items=%s',
      ch->>'affected_item_count', res->>'total_affected_items'));

  -- ── 18. A no-op change reports nothing ────────────────────
  res := public.analyze_schema_change(root, own, '{}'::jsonb);
  INSERT INTO _sev_results VALUES (18,
    'Re-submitting the saved schema → zero changes, SAFE',
    jsonb_array_length(res->'changes') = 0 AND res->>'max_severity' = 'safe',
    format('changes=%s max=%s', jsonb_array_length(res->'changes'), res->>'max_severity'));

  -- ── 19. Nothing above wrote anything ──────────────────────
  INSERT INTO _sev_results VALUES (19,
    'Eighteen analyses later, not one item value has changed',
    (SELECT count(*) FROM public.items) = items_before
      AND (SELECT md5(string_agg(i.id::text || i.data::text, '|' ORDER BY i.id))
             FROM public.items i) IS NOT DISTINCT FROM digest_before,
    format('items %s→%s digest_match=%s',
      items_before, (SELECT count(*) FROM public.items),
      ((SELECT md5(string_agg(i.id::text || i.data::text, '|' ORDER BY i.id))
          FROM public.items i) IS NOT DISTINCT FROM digest_before)::text));

  -- ══ APPLY: the strategy not yet covered elsewhere ════════

  -- ── 20. `leave` writes a version but touches no data ──────
  res := public.apply_schema_change(root,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 's_opt'
                           THEN e || '{"required":true}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e),
    '{}'::jsonb,
    '{"s_opt":{"strategy":"leave"}}'::jsonb,
    NULL);

  INSERT INTO _sev_results VALUES (20,
    'Strategy "leave": no item is written, but the 2 blanks are now reported incomplete',
    (res->>'items_updated')::int = 0
      AND (res->>'items_orphaned')::int = 0
      AND (res->>'items_incomplete')::int = 2,
    format('updated=%s orphaned=%s incomplete=%s version=%s',
      res->>'items_updated', res->>'items_orphaned',
      res->>'items_incomplete', res->>'version'));

  SELECT data INTO d FROM public.items WHERE id = 'cc000000-0000-0000-0000-00000000b002';
  INSERT INTO _sev_results VALUES (21,
    '"leave" really left it: the blank value is untouched, not backfilled or orphaned',
    d->>'s_opt' = '' AND NOT (d ? '__orphaned'),
    d::text);

  INSERT INTO _sev_results VALUES (22,
    'A version row was still written for the root AND both descendants',
    (SELECT count(*)::int FROM public.schema_versions
      WHERE category_id IN (root, kid, leaf) AND version = 1) = 3,
    format('v1 rows=%s',
      (SELECT count(*) FROM public.schema_versions
        WHERE category_id IN (root, kid, leaf) AND version = 1)));

  -- ── Tear down ─────────────────────────────────────────────
  DELETE FROM public.categories WHERE id = root;
END $$;

-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _sev_results
ORDER BY n;

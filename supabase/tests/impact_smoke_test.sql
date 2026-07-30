-- ============================================================
-- SchemaShift — analyze_schema_change smoke test (Phase 5, Inc 1)
-- ------------------------------------------------------------
-- Run AFTER seedAmazon.sql, and after impact.sql is applied.
--
-- Covers Increment 1's own stated verification:
--   * the function returns the documented shape
--   * severities classify correctly for the headline cases
--   * try_cast actually distinguishes castable from lossy values
--   * IT WRITES NOTHING (row counts and a data checksum are compared
--     before and after)
--
-- The full severity-table suite lands in Increment 6.
-- Expected: 12 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _impact_results;
CREATE TEMP TABLE _impact_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DO $$
DECLARE
  laptops  UUID := 'e0000000-0000-0000-0000-000000000002';
  gaming   UUID := 'e0000000-0000-0000-0000-000000000003';
  own      JSONB;
  res      JSONB;
  ch       JSONB;

  items_before   BIGINT;
  items_after    BIGINT;
  cats_before    BIGINT;
  cats_after     BIGINT;
  digest_before  TEXT;
  digest_after   TEXT;
BEGIN
  SELECT own_fields INTO own FROM public.categories WHERE id = laptops;

  -- Snapshot for the read-only proof.
  SELECT count(*) INTO items_before FROM public.items;
  SELECT count(*) INTO cats_before  FROM public.categories;
  SELECT md5(string_agg(i.id::text || i.data::text, '|' ORDER BY i.id))
    INTO digest_before FROM public.items i;

  -- ── 1. No-op change ───────────────────────────────────────
  res := public.analyze_schema_change(laptops, own, '{}'::jsonb);
  INSERT INTO _impact_results VALUES (1,
    'No-op change reports zero changes and safe severity',
    jsonb_array_length(res->'changes') = 0 AND res->>'max_severity' = 'safe'
      AND (res->>'blocked')::boolean = false,
    format('changes=%s sev=%s blocked=%s',
           jsonb_array_length(res->'changes'), res->>'max_severity', res->>'blocked'));

  -- ── 2. Documented shape ───────────────────────────────────
  INSERT INTO _impact_results VALUES (2,
    'Returns category_id, versions, affected_categories and totals',
    res ? 'category_id' AND res ? 'current_version' AND res ? 'next_version'
      AND res ? 'affected_categories' AND res ? 'total_affected_items'
      AND res ? 'changes' AND res ? 'max_severity' AND res ? 'blocked',
    format('next_version=%s affected=%s items=%s',
           res->>'next_version',
           jsonb_array_length(res->'affected_categories'),
           res->>'total_affected_items'));

  -- ── 3. Subtree is the affected set ────────────────────────
  -- Laptops + Gaming Laptops = 2 categories, 20 + 8 = 28 items.
  INSERT INTO _impact_results VALUES (3,
    'Affected set is the subtree (Laptops + Gaming Laptops, 28 items)',
    jsonb_array_length(res->'affected_categories') = 2
      AND (res->>'total_affected_items')::int = 28,
    format('categories=%s items=%s',
           jsonb_array_length(res->'affected_categories'), res->>'total_affected_items'));

  -- ── 4. Removing a field is destructive, and counts holders ─
  res := public.analyze_schema_change(
    laptops,
    (SELECT jsonb_agg(e) FROM jsonb_array_elements(own) e WHERE e->>'key' <> 'gpu'),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'gpu' AND c->>'kind' = 'remove_field';
  INSERT INTO _impact_results VALUES (4,
    'Removing "gpu" is DESTRUCTIVE and counts the 28 items holding it',
    ch->>'severity' = 'destructive' AND (ch->>'affected_item_count')::int = 28,
    format('sev=%s affected=%s samples=%s',
           ch->>'severity', ch->>'affected_item_count',
           jsonb_array_length(COALESCE(ch->'sample_values', '[]'::jsonb))));

  -- ── 5. Sample values are provided for the destructive case ─
  INSERT INTO _impact_results VALUES (5,
    'Removal reports up to 5 sample values so the user sees what is at stake',
    jsonb_array_length(COALESCE(ch->'sample_values', '[]'::jsonb)) BETWEEN 1 AND 5,
    COALESCE(ch->'sample_values', '[]'::jsonb)::text);

  -- ── 6. Adding a REQUIRED field is a warning ───────────────
  res := public.analyze_schema_change(
    laptops,
    own || jsonb_build_array(jsonb_build_object(
      'key','test_required','label','Test Required','type','string',
      'required',true,'position',9)),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'test_required';
  INSERT INTO _impact_results VALUES (6,
    'Adding a REQUIRED field is WARNING and flags all 28 items as lacking it',
    ch->>'severity' = 'warning' AND (ch->>'affected_item_count')::int = 28,
    format('sev=%s affected=%s', ch->>'severity', ch->>'affected_item_count'));

  -- ── 7. Adding an OPTIONAL field is safe ───────────────────
  res := public.analyze_schema_change(
    laptops,
    own || jsonb_build_array(jsonb_build_object(
      'key','test_optional','label','Test Optional','type','string',
      'required',false,'position',9)),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'test_optional';
  INSERT INTO _impact_results VALUES (7,
    'Adding an OPTIONAL field is SAFE with zero affected items',
    ch->>'severity' = 'safe' AND (ch->>'affected_item_count')::int = 0
      AND res->>'max_severity' = 'safe',
    format('sev=%s affected=%s max=%s',
           ch->>'severity', ch->>'affected_item_count', res->>'max_severity'));

  -- ── 8. Retype number → string: castable, so lossy = 0 ─────
  res := public.analyze_schema_change(
    laptops,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 'ram_gb'
                           THEN e || '{"type":"string"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'ram_gb' AND c->>'kind' = 'retype_field';
  INSERT INTO _impact_results VALUES (8,
    'Retype number->string: DESTRUCTIVE but lossy_item_count = 0 (all cast cleanly)',
    ch->>'severity' = 'destructive' AND (ch->>'lossy_item_count')::int = 0,
    format('sev=%s affected=%s lossy=%s',
           ch->>'severity', ch->>'affected_item_count', ch->>'lossy_item_count'));

  -- ── 9. Retype string → number: NOT castable, lossy > 0 ────
  -- cpu holds values like "Intel Core i7", which cannot become numbers.
  res := public.analyze_schema_change(
    laptops,
    (SELECT jsonb_agg(CASE WHEN e->>'key' = 'cpu'
                           THEN e || '{"type":"number"}'::jsonb ELSE e END)
     FROM jsonb_array_elements(own) e),
    '{}'::jsonb);
  SELECT c INTO ch FROM jsonb_array_elements(res->'changes') c
   WHERE c->>'field_key' = 'cpu' AND c->>'kind' = 'retype_field';
  INSERT INTO _impact_results VALUES (9,
    'Retype string->number on "cpu": lossy_item_count > 0 with failing samples',
    (ch->>'lossy_item_count')::int > 0
      AND jsonb_array_length(COALESCE(ch->'sample_values','[]'::jsonb)) > 0,
    format('lossy=%s of %s samples=%s',
           ch->>'lossy_item_count', ch->>'affected_item_count',
           COALESCE(ch->'sample_values','[]'::jsonb)::text));

  -- ── 10. Colliding with an ancestor key is BLOCKED ─────────
  res := public.analyze_schema_change(
    laptops,
    own || jsonb_build_array(jsonb_build_object(
      'key','brand','label','Brand Again','type','string',
      'required',false,'position',9)),
    '{}'::jsonb);
  INSERT INTO _impact_results VALUES (10,
    'Redefining an ancestor key is BLOCKED with an actionable reason',
    (res->>'blocked')::boolean = true AND res->>'blocked_reason' ILIKE '%brand%',
    format('blocked=%s reason=%s', res->>'blocked', res->>'blocked_reason'));

  -- ── 11. Optional -> required on an inherited field ────────
  -- Gaming Laptops already overrides warranty_months to required, so
  -- reverting the override and re-applying exercises the warning path.
  res := public.analyze_schema_change(
    gaming,
    (SELECT own_fields FROM public.categories WHERE id = gaming),
    '{"warranty_months":{"required":true}}'::jsonb);
  INSERT INTO _impact_results VALUES (11,
    'Analysis on a category with an override runs without error',
    res IS NOT NULL AND (res->>'blocked')::boolean = false,
    format('changes=%s blocked=%s',
           jsonb_array_length(res->'changes'), res->>'blocked'));

  -- ── 12. THE READ-ONLY PROOF ───────────────────────────────
  SELECT count(*) INTO items_after FROM public.items;
  SELECT count(*) INTO cats_after  FROM public.categories;
  SELECT md5(string_agg(i.id::text || i.data::text, '|' ORDER BY i.id))
    INTO digest_after FROM public.items i;

  INSERT INTO _impact_results VALUES (12,
    'analyze_schema_change wrote NOTHING (row counts and data checksum unchanged)',
    items_before = items_after AND cats_before = cats_after
      AND digest_before IS NOT DISTINCT FROM digest_after,
    format('items %s->%s cats %s->%s digest_match=%s',
           items_before, items_after, cats_before, cats_after,
           digest_before IS NOT DISTINCT FROM digest_after));
END $$;

-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _impact_results
ORDER BY n;

-- ============================================================
-- Zchema — Effective Schema resolver tests (Phase 1, Increment 2)
-- ------------------------------------------------------------
-- Built for the Supabase SQL editor: it returns a PASS/FAIL table
-- as its FINAL statement (the editor only displays the last result).
--
-- NON-DESTRUCTIVE & IDEMPOTENT:
--   * uses fixed test UUIDs (11111111.. .. 44444444..)
--   * deletes any leftovers before AND after
--   * the whole script runs as one implicit transaction in the
--     editor, so any error rolls the fixtures back automatically.
--
-- Run AFTER schema.sql and functions.sql have been applied.
-- Expected result: 5 rows, all showing PASS.
-- ============================================================

-- Result sink (session-temp; harmless if it lingers).
DROP TABLE IF EXISTS _es_test_results;
CREATE TEMP TABLE _es_test_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

-- Clean any leftovers from a prior run (cascade removes descendants).
DELETE FROM public.categories WHERE id IN (
  '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');

-- ── Fixtures (parents before children) ──────────────────────
INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
 ('11111111-1111-1111-1111-111111111111', 'Electronics', 'electronics', NULL,
  '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
    {"key":"warranty_months","label":"Warranty","type":"number","required":false,"position":1}]'::jsonb);

INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
 ('22222222-2222-2222-2222-222222222222', 'Laptops', 'laptops', '11111111-1111-1111-1111-111111111111',
  '[{"key":"screen_size","label":"Screen Size","type":"number","required":false,"position":0},
    {"key":"gpu","label":"GPU","type":"string","required":false,"position":1}]'::jsonb),
 ('33333333-3333-3333-3333-333333333333', 'Smartphones', 'smartphones', '11111111-1111-1111-1111-111111111111',
  '[{"key":"battery_mah","label":"Battery","type":"number","required":false,"position":0}]'::jsonb);

INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
 ('44444444-4444-4444-4444-444444444444', 'Gaming Laptops', 'gaming-laptops', '22222222-2222-2222-2222-222222222222',
  '[{"key":"refresh_rate_hz","label":"Refresh Rate","type":"number","required":false,"position":0},
    {"key":"has_rgb","label":"Has RGB","type":"boolean","required":false,"position":1}]'::jsonb);

-- ── Assertions (compute booleans; never throw) ──────────────
DO $$
DECLARE
  elec_id  UUID := '11111111-1111-1111-1111-111111111111';
  lap_id   UUID := '22222222-2222-2222-2222-222222222222';
  phone_id UUID := '33333333-3333-3333-3333-333333333333';
  game_id  UUID := '44444444-4444-4444-4444-444444444444';
  eff JSONB; f JSONB; fb JSONB; fw JSONB; fs JSONB; fg JSONB;
  depths INT[]; ok BOOLEAN;
BEGIN
  -- A1: Electronics → 2 fields, all inherited=false
  eff := public.get_effective_schema(elec_id);
  ok := COALESCE(jsonb_array_length(eff) = 2
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(eff) e WHERE (e->>'inherited')::bool), false);
  INSERT INTO _es_test_results VALUES
    (1, 'Electronics -> 2 own fields, none inherited', ok,
     format('effective_length=%s', jsonb_array_length(eff)));

  -- A2: Laptops → 4 fields; brand/warranty inherited depth1 Electronics; screen_size/gpu depth0
  eff := public.get_effective_schema(lap_id);
  fb := (SELECT e FROM jsonb_array_elements(eff) e WHERE e->>'key'='brand');
  fw := (SELECT e FROM jsonb_array_elements(eff) e WHERE e->>'key'='warranty_months');
  fs := (SELECT e FROM jsonb_array_elements(eff) e WHERE e->>'key'='screen_size');
  fg := (SELECT e FROM jsonb_array_elements(eff) e WHERE e->>'key'='gpu');
  ok := COALESCE(jsonb_array_length(eff)=4
        AND (fb->>'inherited')::bool AND (fb->>'depth')::int=1 AND fb->>'source_category_name'='Electronics'
        AND (fw->>'inherited')::bool AND (fw->>'depth')::int=1 AND fw->>'source_category_name'='Electronics'
        AND (fs->>'depth')::int=0 AND NOT (fs->>'inherited')::bool
        AND (fg->>'depth')::int=0, false);
  INSERT INTO _es_test_results VALUES
    (2, 'Laptops -> 4 fields; brand+warranty inherited(depth1,Electronics); screen_size+gpu own(depth0)', ok,
     format('length=%s brand.depth=%s warranty.src=%s screen.depth=%s',
            jsonb_array_length(eff), fb->>'depth', fw->>'source_category_name', fs->>'depth'));

  -- A3: Smartphones → 3 fields, no screen_size leak from sibling
  eff := public.get_effective_schema(phone_id);
  ok := COALESCE(jsonb_array_length(eff)=3
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(eff) e WHERE e->>'key'='screen_size'), false);
  INSERT INTO _es_test_results VALUES
    (3, 'Smartphones -> 3 fields, no screen_size leak from sibling', ok,
     format('length=%s has_screen_size=%s', jsonb_array_length(eff),
            EXISTS (SELECT 1 FROM jsonb_array_elements(eff) e WHERE e->>'key'='screen_size')));

  -- A5: three-level chain resolves root→leaf (depths non-increasing)
  eff := public.get_effective_schema(game_id);
  SELECT array_agg((e->>'depth')::int ORDER BY ord) INTO depths
  FROM jsonb_array_elements(eff) WITH ORDINALITY AS t(e, ord);
  ok := COALESCE(jsonb_array_length(eff)=6
        AND (SELECT bool_and(depths[i] >= depths[i+1])
             FROM generate_subscripts(depths,1) i WHERE i < array_length(depths,1))
        AND (eff->0->>'source_category_name')='Electronics', false);
  INSERT INTO _es_test_results VALUES
    (5, 'Gaming Laptops (3-level) -> 6 fields, depths root->leaf, first from Electronics', ok,
     format('length=%s depths=%s first_src=%s', jsonb_array_length(eff), depths, eff->0->>'source_category_name'));

  -- A4: override on Laptops (mutating; discarded by final cleanup)
  UPDATE public.categories
     SET overrides = '{"warranty_months":{"required":true,"label":"Warranty (months)"}}'::jsonb
   WHERE id = lap_id;
  fw := (SELECT e FROM jsonb_array_elements(public.get_effective_schema(lap_id)) e WHERE e->>'key'='warranty_months');
  f  := (SELECT e FROM jsonb_array_elements(public.get_effective_schema(elec_id)) e WHERE e->>'key'='warranty_months');
  ok := COALESCE(fw->>'label'='Warranty (months)'
        AND (fw->>'required')::bool
        AND fw->'overridden_by' = jsonb_build_array(lap_id::text)
        AND f->>'label'='Warranty' AND NOT (f->>'required')::bool, false);
  INSERT INTO _es_test_results VALUES
    (4, 'Laptops override warranty_months (label+required+overridden_by); Electronics unaffected', ok,
     format('laptops.label=%s required=%s overridden_by=%s | electronics.label=%s required=%s',
            fw->>'label', fw->>'required', fw->'overridden_by', f->>'label', f->>'required'));
END $$;

-- ── Cleanup fixtures (cascade removes descendants) ──────────
DELETE FROM public.categories WHERE id IN (
  '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444');

-- ── FINAL RESULT (this is what the editor displays) ─────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _es_test_results
ORDER BY n;

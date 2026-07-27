-- ============================================================
-- SchemaShift — Phase 1 Definition-of-Done verification
-- ------------------------------------------------------------
-- Run AFTER seedAmazon.sql. Checks the Phase 1 acceptance list
-- end-to-end against real seeded data, including the cycle guard
-- (which the Increment 3 test did not cover).
--
-- NON-DESTRUCTIVE: every negative case runs inside its own
-- BEGIN/EXCEPTION block, so the raise rolls that statement back and
-- the seed data is left exactly as it was.
--
-- Expected: 10 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _dod_results;
CREATE TEMP TABLE _dod_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DO $$
DECLARE
  electronics UUID := 'e0000000-0000-0000-0000-000000000001';
  laptops     UUID := 'e0000000-0000-0000-0000-000000000002';
  gaming      UUID := 'e0000000-0000-0000-0000-000000000003';
  phones      UUID := 'e0000000-0000-0000-0000-000000000004';
  eff  JSONB;
  f    JSONB;
  c    INT;
  ok   BOOLEAN;
BEGIN
  -- 1. THE HEADLINE: Gaming Laptops resolves to 9 effective fields
  eff := public.get_effective_schema(gaming);
  INSERT INTO _dod_results VALUES
    (1, 'Gaming Laptops = 9 effective fields (3 Electronics + 4 Laptops + 2 own)',
     jsonb_array_length(eff) = 9, format('got %s', jsonb_array_length(eff)));

  -- 2. Depth provenance is correct across three levels
  SELECT count(*) INTO c FROM jsonb_array_elements(eff) e WHERE (e->>'depth')::int = 2;
  ok := c = 3;
  SELECT count(*) INTO c FROM jsonb_array_elements(eff) e WHERE (e->>'depth')::int = 1;
  ok := ok AND c = 4;
  SELECT count(*) INTO c FROM jsonb_array_elements(eff) e WHERE (e->>'depth')::int = 0;
  ok := ok AND c = 2;
  INSERT INTO _dod_results VALUES
    (2, 'Gaming Laptops depth split is 3 / 4 / 2 (root → own)', ok,
     format('depth0=%s', c));

  -- 3. The override reaches the resolved schema
  f := (SELECT e FROM jsonb_array_elements(eff) e WHERE e->>'key' = 'warranty_months');
  INSERT INTO _dod_results VALUES
    (3, 'Gaming Laptops override: warranty_months relabelled + required',
     f->>'label' = 'Warranty (months)' AND (f->>'required')::bool
       AND f->'overridden_by' = jsonb_build_array(gaming::text),
     format('label=%s required=%s by=%s', f->>'label', f->>'required', f->'overridden_by'));

  -- 4. …and Electronics itself is untouched by it
  f := (SELECT e FROM jsonb_array_elements(public.get_effective_schema(electronics)) e
        WHERE e->>'key' = 'warranty_months');
  INSERT INTO _dod_results VALUES
    (4, 'Electronics warranty_months unaffected by the descendant override',
     f->>'label' = 'Warranty' AND NOT (f->>'required')::bool,
     format('label=%s required=%s', f->>'label', f->>'required'));

  -- 5. Sibling isolation — the original bug this whole phase fixes
  eff := public.get_effective_schema(phones);
  INSERT INTO _dod_results VALUES
    (5, 'Smartphones sees NO laptop field (sibling isolation)',
     jsonb_array_length(eff) = 6
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(eff) e
                       WHERE e->>'key' IN ('screen_size_in','ram_gb','cpu','gpu','refresh_rate_hz','has_rgb')),
     format('fields=%s', jsonb_array_length(eff)));

  -- 6. Duplicate field key against an ANCESTOR is rejected
  BEGIN
    UPDATE public.categories
       SET own_fields = own_fields || '[{"key":"brand","label":"Dup","type":"string","required":false,"position":9}]'::jsonb
     WHERE id = laptops;
    INSERT INTO _dod_results VALUES (6, 'Duplicate key vs ancestor rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _dod_results VALUES (6, 'Duplicate key vs ancestor rejected', true, SQLERRM);
  END;

  -- 7. Override on a NON-inherited key is rejected
  BEGIN
    UPDATE public.categories SET overrides = '{"not_a_real_field":{"label":"x"}}'::jsonb
     WHERE id = laptops;
    INSERT INTO _dod_results VALUES (7, 'Override on non-inherited key rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _dod_results VALUES (7, 'Override on non-inherited key rejected', true, SQLERRM);
  END;

  -- 8. CYCLE GUARD: reparent a category under its own descendant
  BEGIN
    UPDATE public.categories SET parent_id = gaming WHERE id = electronics;
    INSERT INTO _dod_results VALUES (8, 'Reparent under own descendant rejected (cycle guard)', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _dod_results VALUES (8, 'Reparent under own descendant rejected (cycle guard)', true, SQLERRM);
  END;

  -- 9. A category cannot become its own parent
  BEGIN
    UPDATE public.categories SET parent_id = laptops WHERE id = laptops;
    INSERT INTO _dod_results VALUES (9, 'Category cannot be its own parent', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _dod_results VALUES (9, 'Category cannot be its own parent', true, SQLERRM);
  END;

  -- 10. Blueprints are seeded as unlinked presets
  SELECT count(*) INTO c FROM public.blueprints;
  ok := c >= 3 AND NOT EXISTS (SELECT 1 FROM public.categories WHERE blueprint_id IS NOT NULL);
  INSERT INTO _dod_results VALUES
    (10, 'Blueprints exist as presets with no category linked to them', ok,
     format('%s blueprints, %s categories linked', c,
            (SELECT count(*) FROM public.categories WHERE blueprint_id IS NOT NULL)));
END $$;

-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _dod_results
ORDER BY n;

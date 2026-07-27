-- ============================================================
-- SchemaShift — Integrity trigger tests (Phase 1, Increment 3)
-- ------------------------------------------------------------
-- Built for the Supabase SQL editor: returns a PASS/FAIL table as
-- its FINAL statement. NON-DESTRUCTIVE & IDEMPOTENT (fixed test
-- UUIDs + zz-prefixed names, cleaned before and after).
--
-- Negative cases pass when the trigger RAISES (caught + recorded);
-- positive cases pass when the operation is accepted.
--
-- Run AFTER schema.sql + functions.sql + triggers.sql are applied.
-- Expected result: 14 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _v_test_results;
CREATE TEMP TABLE _v_test_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DELETE FROM public.categories
 WHERE id IN (
   'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000006',
   'a0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000008')
    OR name LIKE 'ZZ %';   -- also sweep any stray negative-case rows

-- ── Persistent fixtures: valid root + child (must succeed) ──
INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'ZZ Val Root', 'zz-val-root', NULL,
  '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
    {"key":"warranty_months","label":"Warranty","type":"number","required":false,"position":1}]'::jsonb);

INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
 ('a0000000-0000-0000-0000-000000000002', 'ZZ Val Child', 'zz-val-child', 'a0000000-0000-0000-0000-000000000001',
  '[{"key":"screen_size","label":"Screen Size","type":"number","required":false,"position":0},
    {"key":"gpu","label":"GPU","type":"string","required":false,"position":1}]'::jsonb);

DO $$
DECLARE
  e_id UUID := 'a0000000-0000-0000-0000-000000000001';
  l_id UUID := 'a0000000-0000-0000-0000-000000000002';
  c_id UUID := 'a0000000-0000-0000-0000-000000000003';
  d1   UUID := 'a0000000-0000-0000-0000-000000000004';
  d2   UUID := 'a0000000-0000-0000-0000-000000000005';
  ma_id UUID := 'a0000000-0000-0000-0000-000000000006';
  mm_id UUID := 'a0000000-0000-0000-0000-000000000007';
  md_id UUID := 'a0000000-0000-0000-0000-000000000008';
  got  TEXT;
BEGIN
  -- 1. valid root + child inserted successfully
  INSERT INTO _v_test_results VALUES
    (1, 'Valid root + child categories insert successfully',
     (SELECT count(*) FROM public.categories WHERE id IN (e_id, l_id)) = 2,
     format('found %s of 2', (SELECT count(*) FROM public.categories WHERE id IN (e_id, l_id))));

  -- 2. duplicate key vs ANCESTOR rejected
  BEGIN
    INSERT INTO public.categories (name, slug, parent_id, own_fields) VALUES
      ('ZZ Neg2', 'zz-neg2', e_id,
       '[{"key":"brand","label":"B","type":"string","required":false,"position":0}]'::jsonb);
    INSERT INTO _v_test_results VALUES (2, 'Duplicate key vs ancestor rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (2, 'Duplicate key vs ancestor rejected', true, SQLERRM);
  END;

  -- 3. duplicate key vs DESCENDANT rejected (add screen_size to root, child already has it)
  BEGIN
    UPDATE public.categories SET own_fields =
      '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
        {"key":"warranty_months","label":"Warranty","type":"number","required":false,"position":1},
        {"key":"screen_size","label":"X","type":"number","required":false,"position":2}]'::jsonb
     WHERE id = e_id;
    INSERT INTO _v_test_results VALUES (3, 'Duplicate key vs descendant rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (3, 'Duplicate key vs descendant rejected', true, SQLERRM);
  END;

  -- 4. duplicate key WITHIN own_fields rejected
  BEGIN
    INSERT INTO public.categories (name, slug, parent_id, own_fields) VALUES
      ('ZZ Neg4', 'zz-neg4', NULL,
       '[{"key":"brand","label":"B","type":"string","required":false,"position":0},
         {"key":"brand","label":"B2","type":"string","required":false,"position":1}]'::jsonb);
    INSERT INTO _v_test_results VALUES (4, 'Duplicate key within own_fields rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (4, 'Duplicate key within own_fields rejected', true, SQLERRM);
  END;

  -- 5. invalid key format rejected
  BEGIN
    INSERT INTO public.categories (name, slug, parent_id, own_fields) VALUES
      ('ZZ Neg5', 'zz-neg5', NULL,
       '[{"key":"Bad Key","label":"B","type":"string","required":false,"position":0}]'::jsonb);
    INSERT INTO _v_test_results VALUES (5, 'Invalid field key format rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (5, 'Invalid field key format rejected', true, SQLERRM);
  END;

  -- 6. invalid type rejected
  BEGIN
    INSERT INTO public.categories (name, slug, parent_id, own_fields) VALUES
      ('ZZ Neg6', 'zz-neg6', NULL,
       '[{"key":"x","label":"X","type":"foo","required":false,"position":0}]'::jsonb);
    INSERT INTO _v_test_results VALUES (6, 'Invalid field type rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (6, 'Invalid field type rejected', true, SQLERRM);
  END;

  -- 7. select with no options rejected
  BEGIN
    INSERT INTO public.categories (name, slug, parent_id, own_fields) VALUES
      ('ZZ Neg7', 'zz-neg7', NULL,
       '[{"key":"x","label":"X","type":"select","required":false,"position":0}]'::jsonb);
    INSERT INTO _v_test_results VALUES (7, 'select field with no options rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (7, 'select field with no options rejected', true, SQLERRM);
  END;

  -- 8. non-integer position rejected
  BEGIN
    INSERT INTO public.categories (name, slug, parent_id, own_fields) VALUES
      ('ZZ Neg8', 'zz-neg8', NULL,
       '[{"key":"x","label":"X","type":"string","required":false,"position":1.5}]'::jsonb);
    INSERT INTO _v_test_results VALUES (8, 'Non-integer position rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (8, 'Non-integer position rejected', true, SQLERRM);
  END;

  -- 9. override on NON-inherited key rejected
  BEGIN
    UPDATE public.categories SET overrides = '{"not_a_field":{"label":"x"}}'::jsonb WHERE id = l_id;
    INSERT INTO _v_test_results VALUES (9, 'Override on non-inherited key rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (9, 'Override on non-inherited key rejected', true, SQLERRM);
  END;

  -- 10. override patch containing "type" rejected (brand IS inherited)
  BEGIN
    UPDATE public.categories SET overrides = '{"brand":{"type":"number"}}'::jsonb WHERE id = l_id;
    INSERT INTO _v_test_results VALUES (10, 'Override patch containing type/key rejected', false, 'no error raised');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (10, 'Override patch containing type/key rejected', true, SQLERRM);
  END;

  -- 11. valid override on inherited key accepted
  BEGIN
    UPDATE public.categories SET overrides = '{"warranty_months":{"required":true,"label":"Warranty (months)"}}'::jsonb WHERE id = l_id;
    INSERT INTO _v_test_results VALUES (11, 'Valid override on inherited key accepted', true, 'accepted');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (11, 'Valid override on inherited key accepted', false, SQLERRM);
  END;

  -- 12. slug auto-generated from name
  BEGIN
    INSERT INTO public.categories (id, name, parent_id) VALUES (c_id, 'ZZ Slug Demo & Test', NULL);
    SELECT slug INTO got FROM public.categories WHERE id = c_id;
    INSERT INTO _v_test_results VALUES
      (12, 'Slug auto-generated (ZZ Slug Demo & Test -> zz-slug-demo-test)', got = 'zz-slug-demo-test', format('slug=%s', got));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (12, 'Slug auto-generated (ZZ Slug Demo & Test -> zz-slug-demo-test)', false, SQLERRM);
  END;

  -- 13. slug collision within same parent appends -2
  BEGIN
    INSERT INTO public.categories (id, name, parent_id) VALUES (d1, 'ZZ Dup Slug', NULL);
    INSERT INTO public.categories (id, name, parent_id) VALUES (d2, 'ZZ Dup Slug', NULL);
    SELECT slug INTO got FROM public.categories WHERE id = d2;
    INSERT INTO _v_test_results VALUES
      (13, 'Slug collision within same parent appends -2', got = 'zz-dup-slug-2', format('second slug=%s', got));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (13, 'Slug collision within same parent appends -2', false, SQLERRM);
  END;

  -- 14. re-parent that would push an inherited key onto an EXISTING descendant is rejected
  --     (Move Mid has no own fields; Move Desc(child) defines 'movekey'; Move Anc also
  --      defines 'movekey'. Moving Mid under Anc would make Desc redefine inherited 'movekey'.)
  BEGIN
    INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
      (ma_id, 'ZZ Move Anc', 'zz-move-anc', NULL,
       '[{"key":"movekey","label":"Move Key","type":"string","required":false,"position":0}]'::jsonb);
    INSERT INTO public.categories (id, name, slug, parent_id) VALUES
      (mm_id, 'ZZ Move Mid', 'zz-move-mid', NULL);
    INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
      (md_id, 'ZZ Move Desc', 'zz-move-desc', mm_id,
       '[{"key":"movekey","label":"Move Key","type":"string","required":false,"position":0}]'::jsonb);
    BEGIN
      UPDATE public.categories SET parent_id = ma_id WHERE id = mm_id;
      INSERT INTO _v_test_results VALUES (14, 'Re-parent pushing an inherited key onto a descendant rejected', false, 'no error raised');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _v_test_results VALUES (14, 'Re-parent pushing an inherited key onto a descendant rejected', true, SQLERRM);
    END;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _v_test_results VALUES (14, 'Re-parent pushing an inherited key onto a descendant rejected', false, 'setup failed: ' || SQLERRM);
  END;
END $$;

-- ── Cleanup fixtures ────────────────────────────────────────
DELETE FROM public.categories
 WHERE id IN (
   'a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004',
   'a0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000006',
   'a0000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000008')
    OR name LIKE 'ZZ %';   -- also sweep any stray negative-case rows

-- ── FINAL RESULT (what the editor displays) ─────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _v_test_results
ORDER BY n;

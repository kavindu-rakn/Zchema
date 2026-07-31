-- ============================================================
-- SchemaShift — Onboarding (Phase 7, Increment 3)
-- Source AFTER schema.sql → functions.sql → triggers.sql → impact.sql
--                        → attributes.sql → search.sql → import.sql.
-- ============================================================


-- ============================================================
-- 1. profiles.onboarding_state
-- ------------------------------------------------------------
-- Which hints this user has dismissed and which milestones they have
-- passed. Per-user rather than global: two people sharing a catalog
-- have not both seen the tour.
--
-- Shape: { "dismissed": ["inherited-callout"], "done": ["first-import"] }
-- Deliberately schemaless — the set of hints changes every time the UI
-- does, and a column per hint would be a migration per hint.
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS onboarding_state JSONB NOT NULL DEFAULT '{}'::jsonb;


-- ============================================================
-- 2. dismiss_onboarding_hint(key)
-- ------------------------------------------------------------
-- Append-only against the caller's OWN row. Written as a function
-- rather than a client-side UPDATE so a dismissal cannot be used to
-- write arbitrary JSON into a profile.
-- ============================================================
CREATE OR REPLACE FUNCTION public.dismiss_onboarding_hint(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  result JSONB;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.';
  END IF;
  IF p_key !~ '^[a-z][a-z0-9-]*$' THEN
    RAISE EXCEPTION 'Invalid hint key.';
  END IF;

  UPDATE public.profiles p
     SET onboarding_state = jsonb_set(
           COALESCE(p.onboarding_state, '{}'::jsonb),
           '{dismissed}',
           (
             SELECT COALESCE(jsonb_agg(DISTINCT k), '[]'::jsonb)
             FROM (
               SELECT jsonb_array_elements_text(
                        COALESCE(p.onboarding_state->'dismissed', '[]'::jsonb)) AS k
               UNION SELECT p_key
             ) keys
           ),
           true)
   WHERE p.id = auth.uid()
   RETURNING onboarding_state INTO result;

  RETURN COALESCE(result, '{}'::jsonb);
END;
$$;


-- ============================================================
-- 3. seed_sample_catalog(dataset)  → JSONB
-- ------------------------------------------------------------
-- The "load a ready catalog and poke at it" path.
--
-- REFUSES TO RUN IF ANY CATEGORY EXISTS. This is reachable from a
-- button in the UI, and a first-run helper that can wipe or muddle a
-- real catalog is a data-loss bug wearing a friendly hat. The seed
-- scripts in supabase/ truncate; this one declines.
--
-- Returns { category_id } pointing at the node that makes inheritance
-- self-evident — three levels deep, with an override — so the caller
-- can land the user on the one screen worth seeing first.
-- ============================================================
CREATE OR REPLACE FUNCTION public.seed_sample_catalog(p_dataset TEXT DEFAULT 'catalog')
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  root       UUID;
  mid        UUID;
  leaf       UUID;
  sibling    UUID;
  i          INT;
BEGIN
  PERFORM public.require_schema_admin();

  IF EXISTS (SELECT 1 FROM public.categories) THEN
    RAISE EXCEPTION
      'The sample catalog can only be loaded into an empty workspace — there are already categories here.';
  END IF;

  IF p_dataset = 'vehicles' THEN
    -- ── Vehicles ────────────────────────────────────────────
    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
    VALUES ('Vehicles', 'vehicles', NULL, 'Car', '#3b82f6', '[
      {"key":"make","label":"Make","type":"string","required":true,"position":0},
      {"key":"model_year","label":"Model Year","type":"number","required":true,"position":1},
      {"key":"fuel_type","label":"Fuel","type":"select","required":false,"position":2,
       "options":["Petrol","Diesel","Hybrid","Electric"]}
    ]'::jsonb) RETURNING id INTO root;

    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
    VALUES ('Cars', 'cars', root, 'Car', '#6366f1', '[
      {"key":"doors","label":"Doors","type":"number","required":false,"position":0},
      {"key":"transmission","label":"Transmission","type":"select","required":false,"position":1,
       "options":["Manual","Automatic"]}
    ]'::jsonb) RETURNING id INTO mid;

    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields, overrides)
    VALUES ('SUVs', 'suvs', mid, 'Truck', '#8b5cf6', '[
      {"key":"drivetrain","label":"Drivetrain","type":"select","required":false,"position":0,
       "options":["FWD","RWD","AWD","4WD"]},
      {"key":"ground_clearance_mm","label":"Ground Clearance","type":"number",
       "required":false,"position":1,"unit":"mm"}
    ]'::jsonb,
    '{"fuel_type":{"required":true,"label":"Fuel (required for SUVs)"}}'::jsonb)
    RETURNING id INTO leaf;

    INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
    VALUES ('Motorcycles', 'motorcycles', root, 'Bike', '#ec4899', '[
      {"key":"engine_cc","label":"Engine","type":"number","required":false,"position":0,"unit":"cc"}
    ]'::jsonb) RETURNING id INTO sibling;

    FOR i IN 1..12 LOOP
      INSERT INTO public.items (category_id, data) VALUES (leaf, jsonb_build_object(
        'make',                (ARRAY['Toyota','Honda','Mazda','Subaru'])[1 + (i % 4)],
        'model_year',          2018 + (i % 7),
        'fuel_type',           (ARRAY['Petrol','Diesel','Hybrid'])[1 + (i % 3)],
        'doors',               5,
        'transmission',        (ARRAY['Manual','Automatic'])[1 + (i % 2)],
        'drivetrain',          (ARRAY['AWD','4WD','FWD'])[1 + (i % 3)],
        'ground_clearance_mm', 180 + (i * 5)
      ));
    END LOOP;

    FOR i IN 1..8 LOOP
      INSERT INTO public.items (category_id, data) VALUES (sibling, jsonb_build_object(
        'make',       (ARRAY['Yamaha','Kawasaki','Ducati'])[1 + (i % 3)],
        'model_year', 2019 + (i % 6),
        'fuel_type',  'Petrol',
        'engine_cc',  250 * (1 + (i % 4))
      ));
    END LOOP;

    RETURN jsonb_build_object('category_id', leaf, 'dataset', 'vehicles');
  END IF;

  -- ── Catalog (default) ─────────────────────────────────────
  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
  VALUES ('Electronics', 'electronics', NULL, 'Cpu', '#3b82f6', '[
    {"key":"brand","label":"Brand","type":"string","required":true,"position":0},
    {"key":"model_number","label":"Model Number","type":"string","required":false,"position":1},
    {"key":"warranty_months","label":"Warranty","type":"number","required":false,"position":2,
     "unit":"months"}
  ]'::jsonb) RETURNING id INTO root;

  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
  VALUES ('Laptops', 'laptops', root, 'Laptop', '#6366f1', '[
    {"key":"screen_size_in","label":"Screen Size","type":"number","required":false,"position":0,
     "unit":"in"},
    {"key":"ram_gb","label":"RAM","type":"number","required":false,"position":1,"unit":"GB"},
    {"key":"cpu","label":"CPU","type":"string","required":false,"position":2},
    {"key":"gpu","label":"GPU","type":"string","required":false,"position":3}
  ]'::jsonb) RETURNING id INTO mid;

  -- Three levels deep AND carrying an override: the single node that
  -- proves the whole model in one screenshot.
  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields, overrides)
  VALUES ('Gaming Laptops', 'gaming-laptops', mid, 'Gamepad2', '#8b5cf6', '[
    {"key":"refresh_rate_hz","label":"Refresh Rate","type":"number","required":false,
     "position":0,"unit":"Hz"},
    {"key":"has_rgb","label":"RGB Lighting","type":"boolean","required":false,"position":1}
  ]'::jsonb,
  '{"warranty_months":{"required":true,"label":"Warranty (months)"}}'::jsonb)
  RETURNING id INTO leaf;

  -- A sibling that shares the ancestor but NOT the Laptops fields —
  -- the other half of the demonstration.
  INSERT INTO public.categories (name, slug, parent_id, icon, color, own_fields)
  VALUES ('Smartphones', 'smartphones', root, 'Smartphone', '#ec4899', '[
    {"key":"battery_mah","label":"Battery","type":"number","required":false,"position":0,
     "unit":"mAh"},
    {"key":"storage_gb","label":"Storage","type":"number","required":false,"position":1,
     "unit":"GB"},
    {"key":"has_5g","label":"5G","type":"boolean","required":false,"position":2}
  ]'::jsonb) RETURNING id INTO sibling;

  FOR i IN 1..14 LOOP
    -- jsonb_strip_nulls drops the deliberately-blank warranty rows: an
    -- ABSENT key and a key holding null mean different things to the
    -- completeness check, and only "absent" is honest here.
    INSERT INTO public.items (category_id, data) VALUES (leaf, jsonb_strip_nulls(jsonb_build_object(
      'brand',           (ARRAY['ASUS ROG','MSI','Alienware','Razer'])[1 + (i % 4)],
      'model_number',    'GL-' || (1000 + i),
      -- Left blank on a third of the rows so the "make this required"
      -- impact demo has something real to find.
      'warranty_months', CASE WHEN i % 3 = 0 THEN NULL ELSE 12 + (i % 3) * 12 END,
      'screen_size_in',  (ARRAY[15.6, 17.3, 14.0])[1 + (i % 3)],
      'ram_gb',          (ARRAY[16, 32, 64])[1 + (i % 3)],
      'cpu',             (ARRAY['Intel Core i7','Intel Core i9','AMD Ryzen 9'])[1 + (i % 3)],
      'gpu',             (ARRAY['RTX 4060','RTX 4070','RTX 4080'])[1 + (i % 3)],
      'refresh_rate_hz', (ARRAY[144, 165, 240])[1 + (i % 3)],
      'has_rgb',         i % 2 = 0
    )));
  END LOOP;

  FOR i IN 1..10 LOOP
    INSERT INTO public.items (category_id, data) VALUES (sibling, jsonb_build_object(
      'brand',           (ARRAY['Apple','Samsung','Google','OnePlus'])[1 + (i % 4)],
      'model_number',    'SP-' || (2000 + i),
      'warranty_months', 12,
      'battery_mah',     4000 + (i * 100),
      'storage_gb',      (ARRAY[128, 256, 512])[1 + (i % 3)],
      'has_5g',          true
    ));
  END LOOP;

  FOR i IN 1..6 LOOP
    INSERT INTO public.items (category_id, data) VALUES (mid, jsonb_build_object(
      'brand',           (ARRAY['Dell','HP','Lenovo'])[1 + (i % 3)],
      'model_number',    'NB-' || (3000 + i),
      'warranty_months', 24,
      'screen_size_in',  14.0,
      'ram_gb',          16,
      'cpu',             'Intel Core i5',
      'gpu',             'Integrated'
    ));
  END LOOP;

  RETURN jsonb_build_object('category_id', leaf, 'dataset', 'catalog');
END;
$$;

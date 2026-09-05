-- ============================================================
-- Zchema — Vehicle fleet seed (second, non-commerce domain)
-- Run AFTER schema.sql → functions.sql → triggers.sql → policies.sql
--
-- ⚠️  DESTRUCTIVE: the TRUNCATE below deletes ALL blueprints,
-- categories, items and schema versions. Profiles/auth users are
-- untouched. Re-running is safe and idempotent.
--
-- ⚠️  This is an ALTERNATIVE to seedAmazon.sql, not an addition —
-- each script truncates first. Run one or the other.
--
-- WHY THIS FILE EXISTS
-- The answer to "isn't this just another e-commerce platform?".
-- Same engine, a fleet/compliance domain, and it exercises two
-- override styles the Amazon seed does not:
--   * SUVs          tighten an inherited field  (condition → required)
--   * Motorcycles   narrow an inherited field's OPTIONS + relabel it
-- It also puts items on a NON-leaf node (Cars), so item_count and
-- subtree_item_count differ and the counting functions are visible.
--
--   Vehicles              own: vin, make, model, year, condition (select)   → 5 fields
--   ├── Cars              own: doors, transmission, fuel_type, mileage_km   → 9   |  6 items
--   │   ├── Sedans        own: trunk_capacity_l, has_sunroof                → 11  | 18 items
--   │   └── SUVs          own: drivetrain, ground_clearance_mm, seats       → 12  | 14 items
--   │       override: condition → required
--   └── Motorcycles       own: engine_cc, has_abs, bike_type                → 8   | 12 items
--       override: condition → narrowed options + new label
-- ============================================================

TRUNCATE public.items, public.schema_versions, public.categories, public.blueprints CASCADE;


-- ============================================================
-- 1. Blueprints — presets ONLY (no category is linked to them)
-- ============================================================
INSERT INTO public.blueprints (id, name, description, fields) VALUES
('b2000000-0000-0000-0000-000000000001', 'Registration Details',
 'Paperwork fields common to any registered asset.',
 '[{"key":"registration_no","label":"Registration No.","type":"string","required":true,"position":0},
   {"key":"registered_on","label":"Registered On","type":"date","required":false,"position":1},
   {"key":"registered_state","label":"State / Province","type":"string","required":false,"position":2}]'::jsonb),

('b2000000-0000-0000-0000-000000000002', 'Inspection Record',
 'Roadworthiness and compliance checks.',
 '[{"key":"last_inspected_on","label":"Last Inspected","type":"date","required":false,"position":0},
   {"key":"inspection_passed","label":"Passed","type":"boolean","required":false,"position":1},
   {"key":"inspector_notes","label":"Inspector Notes","type":"text","required":false,"position":2}]'::jsonb),

('b2000000-0000-0000-0000-000000000003', 'Ownership',
 'Chain-of-custody fields for resale.',
 '[{"key":"owner_name","label":"Current Owner","type":"string","required":false,"position":0},
   {"key":"previous_owners","label":"Previous Owners","type":"number","required":false,"position":1},
   {"key":"service_history_url","label":"Service History","type":"url","required":false,"position":2}]'::jsonb);


-- ============================================================
-- 2. Categories
-- ============================================================

-- ── Vehicles (root) ─────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('11100000-0000-0000-0000-000000000001', 'Vehicles', 'vehicles',
 'Every asset in the fleet, whatever it rides on.', NULL,
 '[{"key":"vin","label":"VIN","type":"string","required":true,"position":0},
   {"key":"make","label":"Make","type":"string","required":true,"position":1},
   {"key":"model","label":"Model","type":"string","required":true,"position":2},
   {"key":"year","label":"Year","type":"number","required":true,"position":3},
   {"key":"condition","label":"Condition","type":"select","required":false,"options":["New","Used","Certified Pre-Owned","Salvage"],"position":4}]'::jsonb,
 'car-front', '#22d3ee', 0);

-- ── Cars (level 2, and carries items of its own) ────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('11100000-0000-0000-0000-000000000002', 'Cars', 'cars',
 'Four-wheeled passenger vehicles. Holds hatchbacks directly, so this node has items AND descendants.',
 '11100000-0000-0000-0000-000000000001',
 '[{"key":"doors","label":"Doors","type":"number","required":false,"position":0},
   {"key":"transmission","label":"Transmission","type":"select","required":false,"options":["Manual","Automatic","CVT","Dual-Clutch"],"position":1},
   {"key":"fuel_type","label":"Fuel Type","type":"select","required":true,"options":["Petrol","Diesel","Hybrid","Electric"],"position":2},
   {"key":"mileage_km","label":"Mileage","type":"number","required":false,"unit":"km","position":3}]'::jsonb,
 'car', '#38bdf8', 0);

-- ── Motorcycles (level 2) — narrows an inherited field's OPTIONS ──
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, overrides, icon, color, position) VALUES
('11100000-0000-0000-0000-000000000003', 'Motorcycles', 'motorcycles',
 'Two-wheelers. Certified Pre-Owned does not apply here, so the inherited condition field is narrowed and relabelled.',
 '11100000-0000-0000-0000-000000000001',
 '[{"key":"engine_cc","label":"Engine Displacement","type":"number","required":false,"unit":"cc","position":0},
   {"key":"has_abs","label":"ABS","type":"boolean","required":false,"position":1},
   {"key":"bike_type","label":"Bike Type","type":"select","required":false,"options":["Cruiser","Sport","Touring","Adventure","Naked"],"position":2}]'::jsonb,
 '{"condition":{"label":"Condition (bike grading)","options":["New","Used","Salvage"]}}'::jsonb,
 'bike', '#a78bfa', 1);

-- ── Sedans (level 3) ────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('11100000-0000-0000-0000-000000000004', 'Sedans', 'sedans',
 'Three-box saloons — inherits 5 from Vehicles + 4 from Cars.',
 '11100000-0000-0000-0000-000000000002',
 '[{"key":"trunk_capacity_l","label":"Trunk Capacity","type":"number","required":false,"unit":"L","position":0},
   {"key":"has_sunroof","label":"Sunroof","type":"boolean","required":false,"position":1}]'::jsonb,
 'car-taxi-front', '#60a5fa', 0);

-- ── SUVs (level 3) — tightens an inherited field ────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, overrides, icon, color, position) VALUES
('11100000-0000-0000-0000-000000000005', 'SUVs', 'suvs',
 'Sport-utility vehicles. Fleet policy demands a graded condition on every SUV, so the inherited field is made required here and nowhere else.',
 '11100000-0000-0000-0000-000000000002',
 '[{"key":"drivetrain","label":"Drivetrain","type":"select","required":false,"options":["FWD","RWD","AWD","4WD"],"position":0},
   {"key":"ground_clearance_mm","label":"Ground Clearance","type":"number","required":false,"unit":"mm","position":1},
   {"key":"seating_capacity","label":"Seats","type":"number","required":false,"position":2}]'::jsonb,
 '{"condition":{"required":true}}'::jsonb,
 'truck', '#818cf8', 1);


-- ============================================================
-- 3. Items
-- ============================================================

-- ── Cars → 6 items directly on a NON-leaf node (9 fields) ───
INSERT INTO public.items (category_id, data)
SELECT '11100000-0000-0000-0000-000000000002', jsonb_build_object(
  'vin',          'WVW' || (10000000 + i * 137),
  'make',         (ARRAY['Volkswagen','Honda','Toyota','Renault','Kia','Mazda'])[1 + (i % 6)],
  'model',        (ARRAY['Golf','Jazz','Yaris','Clio','Rio','Mazda2'])[1 + (i % 6)],
  'year',         2018 + (i % 7),
  'condition',    (ARRAY['New','Used','Certified Pre-Owned'])[1 + (i % 3)],
  'doors',        (ARRAY[3,5])[1 + (i % 2)],
  'transmission', (ARRAY['Manual','Automatic','CVT'])[1 + (i % 3)],
  'fuel_type',    (ARRAY['Petrol','Diesel','Hybrid','Electric'])[1 + (i % 4)],
  'mileage_km',   12000 + (i * 8400) % 90000
) FROM generate_series(0, 5) AS i;

-- ── Sedans → 18 items (11 effective fields) ─────────────────
INSERT INTO public.items (category_id, data)
SELECT '11100000-0000-0000-0000-000000000004', jsonb_build_object(
  'vin',              'JTD' || (20000000 + i * 211),
  'make',             (ARRAY['Toyota','Honda','BMW','Mercedes-Benz','Audi','Hyundai'])[1 + (i % 6)],
  'model',            (ARRAY['Camry','Accord','3 Series','C-Class','A4','Elantra'])[1 + (i % 6)],
  'year',             2016 + (i % 9),
  'condition',        (ARRAY['New','Used','Certified Pre-Owned','Salvage'])[1 + (i % 4)],
  'doors',            4,
  'transmission',     (ARRAY['Automatic','CVT','Dual-Clutch'])[1 + (i % 3)],
  'fuel_type',        (ARRAY['Petrol','Diesel','Hybrid','Electric'])[1 + (i % 4)],
  'mileage_km',       8000 + (i * 7300) % 140000,
  'trunk_capacity_l', (ARRAY[425,480,510,560])[1 + (i % 4)],
  'has_sunroof',      (i % 3) <> 0
) FROM generate_series(0, 17) AS i;

-- ── SUVs → 14 items (12 effective fields) ───────────────────
-- `condition` is REQUIRED here via the override, so every row has it.
INSERT INTO public.items (category_id, data)
SELECT '11100000-0000-0000-0000-000000000005', jsonb_build_object(
  'vin',                 '5UX' || (30000000 + i * 173),
  'make',                (ARRAY['Toyota','Land Rover','Volvo','Subaru','Jeep','Kia','BMW'])[1 + (i % 7)],
  'model',               (ARRAY['RAV4','Discovery','XC90','Forester','Wrangler','Sportage','X5'])[1 + (i % 7)],
  'year',                2017 + (i % 8),
  'condition',           (ARRAY['New','Used','Certified Pre-Owned'])[1 + (i % 3)],
  'doors',               5,
  'transmission',        (ARRAY['Automatic','Dual-Clutch'])[1 + (i % 2)],
  'fuel_type',           (ARRAY['Petrol','Diesel','Hybrid','Electric'])[1 + (i % 4)],
  'mileage_km',          15000 + (i * 9100) % 120000,
  'drivetrain',          (ARRAY['FWD','AWD','4WD'])[1 + (i % 3)],
  'ground_clearance_mm', (ARRAY[180,200,220,240])[1 + (i % 4)],
  'seating_capacity',    (ARRAY[5,7])[1 + (i % 2)]
) FROM generate_series(0, 13) AS i;

-- ── Motorcycles → 12 items (8 effective fields) ─────────────
-- `condition` values stay inside the NARROWED option set.
INSERT INTO public.items (category_id, data)
SELECT '11100000-0000-0000-0000-000000000003', jsonb_build_object(
  'vin',       'JH2' || (40000000 + i * 251),
  'make',      (ARRAY['Honda','Yamaha','Kawasaki','Ducati','Triumph','Royal Enfield'])[1 + (i % 6)],
  'model',     (ARRAY['CB500','MT-07','Ninja 400','Monster','Bonneville','Interceptor'])[1 + (i % 6)],
  'year',      2018 + (i % 7),
  'condition', (ARRAY['New','Used','Salvage'])[1 + (i % 3)],
  'engine_cc', (ARRAY[350,400,500,650,900,1200])[1 + (i % 6)],
  'has_abs',   (i % 4) <> 0,
  'bike_type', (ARRAY['Cruiser','Sport','Touring','Adventure','Naked'])[1 + (i % 5)]
) FROM generate_series(0, 11) AS i;


-- ============================================================
-- 4. Verification (this is what the SQL editor displays)
-- ------------------------------------------------------------
-- Expected effective_fields: Vehicles 5, Cars 9, Motorcycles 8,
-- Sedans 11, SUVs 12.
-- Expected items / subtree: Cars holds 6 directly but 38 across its
-- subtree — proof that count_subtree_items walks descendants.
-- ============================================================
SELECT
  c.name                                                          AS category,
  jsonb_array_length(public.get_effective_schema(c.id))           AS effective_fields,
  jsonb_array_length(c.own_fields)                                AS own_fields,
  (SELECT count(*) FROM jsonb_array_elements(public.get_effective_schema(c.id)) e
    WHERE (e->>'inherited')::boolean)                             AS inherited_fields,
  (SELECT count(*) FROM public.items i WHERE i.category_id = c.id) AS items,
  public.count_subtree_items(c.id)                                AS subtree_items
FROM public.categories c
ORDER BY c.name;

-- ============================================================
-- Zchema — Minimal seed
-- Run AFTER schema.sql → functions.sql → triggers.sql → policies.sql
--
-- ⚠️  DESTRUCTIVE: the TRUNCATE below deletes ALL blueprints,
-- categories, items and schema versions. Profiles/auth users are
-- untouched. Re-running is safe and idempotent.
--
-- ⚠️  ALTERNATIVE to seedAmazon.sql / seedVehicle.sql, not an
-- addition — each script truncates first. Run exactly one.
--
-- The smallest tree that still proves the model: two levels, one
-- inherited field set, one override. Use this for a quick dev start;
-- use seedAmazon.sql for the full demo.
--
--   Products              own: sku, name, price_usd            → 3 fields
--   ├── Electronics       own: brand, warranty_months          → 5   | 4 items
--   │   └── Laptops       own: screen_size_in, ram_gb          → 7   | 4 items
--   │       override: warranty_months → required + relabelled
--   └── Accessories       own: is_bundled                      → 4   | 3 items
-- ============================================================

TRUNCATE public.items, public.schema_versions, public.categories, public.blueprints CASCADE;


-- ── 1. One blueprint, unlinked (presets are optional) ───────
INSERT INTO public.blueprints (id, name, description, fields) VALUES
('b0000000-0000-0000-0000-000000000001', 'Basic Product',
 'Minimal commerce fields — apply to any category to copy these in.',
 '[{"key":"sku","label":"SKU","type":"string","required":true,"position":0},
   {"key":"price_usd","label":"Price","type":"number","required":true,"unit":"USD","position":1},
   {"key":"in_stock","label":"In Stock","type":"boolean","required":false,"position":2}]'::jsonb);


-- ── 2. Categories ───────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('d0000000-0000-0000-0000-000000000001', 'Products', 'products',
 'Root of the demo catalogue.', NULL,
 '[{"key":"sku","label":"SKU","type":"string","required":true,"position":0},
   {"key":"name","label":"Name","type":"string","required":true,"position":1},
   {"key":"price_usd","label":"Price","type":"number","required":false,"unit":"USD","position":2}]'::jsonb,
 'package', '#38bdf8', 0);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('d0000000-0000-0000-0000-000000000002', 'Electronics', 'electronics',
 'Inherits the 3 product fields and adds 2 of its own.',
 'd0000000-0000-0000-0000-000000000001',
 '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
   {"key":"warranty_months","label":"Warranty","type":"number","required":false,"unit":"months","position":1}]'::jsonb,
 'cpu', '#60a5fa', 0),

('d0000000-0000-0000-0000-000000000004', 'Accessories', 'accessories',
 'Sibling of Electronics — cannot see brand or warranty_months.',
 'd0000000-0000-0000-0000-000000000001',
 '[{"key":"is_bundled","label":"Sold as Bundle","type":"boolean","required":false,"position":0}]'::jsonb,
 'cable', '#f472b6', 1);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, overrides, icon, color, position) VALUES
('d0000000-0000-0000-0000-000000000003', 'Laptops', 'laptops',
 'Three levels deep, and tightens an inherited field.',
 'd0000000-0000-0000-0000-000000000002',
 '[{"key":"screen_size_in","label":"Screen Size","type":"number","required":false,"unit":"in","position":0},
   {"key":"ram_gb","label":"RAM","type":"number","required":false,"unit":"GB","position":1}]'::jsonb,
 '{"warranty_months":{"label":"Warranty (months)","required":true}}'::jsonb,
 'laptop', '#818cf8', 0);


-- ── 3. Items ────────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'd0000000-0000-0000-0000-000000000002', jsonb_build_object(
  'sku',             'EL-' || (100 + i),
  'name',            (ARRAY['Wireless Mouse','Mechanical Keyboard','27" Monitor','USB-C Hub'])[1 + (i % 4)],
  'price_usd',       (ARRAY[29.99,89.00,249.00,59.50])[1 + (i % 4)],
  'brand',           (ARRAY['Logitech','Keychron','Dell','Anker'])[1 + (i % 4)],
  'warranty_months', (ARRAY[12,24])[1 + (i % 2)]
) FROM generate_series(0, 3) AS i;

-- warranty_months is REQUIRED here because of the override.
INSERT INTO public.items (category_id, data)
SELECT 'd0000000-0000-0000-0000-000000000003', jsonb_build_object(
  'sku',             'LP-' || (200 + i),
  'name',            (ARRAY['UltraBook 14','ProBook 15','WorkStation 16','TravelMate 13'])[1 + (i % 4)],
  'price_usd',       (ARRAY[999.00,1299.00,2199.00,749.00])[1 + (i % 4)],
  'brand',           (ARRAY['Dell','HP','Lenovo','Apple'])[1 + (i % 4)],
  'warranty_months', (ARRAY[24,36])[1 + (i % 2)],
  'screen_size_in',  (ARRAY[13.3,14.0,15.6,16.0])[1 + (i % 4)],
  'ram_gb',          (ARRAY[8,16,32,64])[1 + (i % 4)]
) FROM generate_series(0, 3) AS i;

INSERT INTO public.items (category_id, data)
SELECT 'd0000000-0000-0000-0000-000000000004', jsonb_build_object(
  'sku',        'AC-' || (300 + i),
  'name',       (ARRAY['Laptop Sleeve','Screen Cleaner','Cable Tidy'])[1 + (i % 3)],
  'price_usd',  (ARRAY[19.99,7.50,12.00])[1 + (i % 3)],
  'is_bundled', (i % 2) = 0
) FROM generate_series(0, 2) AS i;


-- ============================================================
-- 4. Assigning roles to real users
-- ------------------------------------------------------------
-- handle_new_user() auto-creates a profile on signup and maps the two
-- seed emails automatically:
--     admin@zchema.com  → SCHEMA_ADMIN
--     editor@zchema.com → DATA_EDITOR
-- Everyone else defaults to VIEWER. To promote another account after
-- it signs up, run (as a SCHEMA_ADMIN or from this editor):
--
--   UPDATE public.profiles SET role = 'SCHEMA_ADMIN' WHERE email = 'you@example.com';
--   UPDATE public.profiles SET role = 'DATA_EDITOR'  WHERE email = 'them@example.com';
-- ============================================================


-- ── 5. Verification (what the SQL editor displays) ──────────
-- Expected: Products 3, Accessories 4, Electronics 5, Laptops 7.
SELECT
  c.name                                                          AS category,
  jsonb_array_length(public.get_effective_schema(c.id))           AS effective_fields,
  jsonb_array_length(c.own_fields)                                AS own_fields,
  (SELECT count(*) FROM public.items i WHERE i.category_id = c.id) AS items,
  public.count_subtree_items(c.id)                                AS subtree_items
FROM public.categories c
ORDER BY c.name;

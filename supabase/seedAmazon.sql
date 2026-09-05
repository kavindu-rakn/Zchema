-- ============================================================
-- Zchema — Amazon-style seed (multi-level inheritance demo)
-- Run AFTER schema.sql → functions.sql → triggers.sql → policies.sql
--
-- ⚠️  DESTRUCTIVE: the TRUNCATE below deletes ALL blueprints,
-- categories, items and schema versions. Profiles/auth users are
-- untouched. Re-running is safe and idempotent.
--
-- THE POINT OF THIS FILE
-- `Gaming Laptops` sits three levels deep AND carries an override.
-- It inherits 3 fields from Electronics and 4 from Laptops, adds 2 of
-- its own — 9 effective fields — while its sibling Smartphones cannot
-- see a single laptop field. That is the whole model in one screenshot.
--
--   Electronics                own: brand, model_number, warranty_months
--   ├── Laptops                own: screen_size_in, ram_gb, cpu, gpu      → 20 items
--   │   └── Gaming Laptops     own: refresh_rate_hz, has_rgb              →  8 items
--   │       override: warranty_months → label "Warranty (months)", required
--   └── Smartphones            own: battery_mah, storage_gb, has_5g       → 20 items
--   Clothing, Shoes & Jewelry  own: brand, material, care_instructions
--   ├── Mens Clothing          own: size (select), fit                    → 15 items
--   └── Womens Clothing        own: size (select), fit, is_maternity      → 15 items
--   Books                      own: author, isbn, page_count, language
--   ├── Fiction                own: genre (select), is_series             → 15 items
--   └── Non-Fiction            own: subject, has_index                    → 15 items
--   Home & Kitchen             own: brand, material, dimensions_cm
--   ├── Furniture              own: assembly_required, weight_kg          → 10 items
--   └── Kitchen Appliances     own: wattage, is_dishwasher_safe           → 10 items
-- ============================================================

TRUNCATE public.items, public.schema_versions, public.categories, public.blueprints CASCADE;


-- ============================================================
-- 1. Blueprints — presets ONLY
-- ------------------------------------------------------------
-- Deliberately NOT linked to any category. Blueprints are optional
-- accelerators now: applying one COPIES its fields into a category's
-- own_fields, leaving no live link behind.
-- ============================================================
INSERT INTO public.blueprints (id, name, description, fields) VALUES
('b1000000-0000-0000-0000-000000000001', 'Basic Product',
 'Minimal commerce fields — a starting point for any sellable item.',
 '[{"key":"sku","label":"SKU","type":"string","required":true,"position":0},
   {"key":"price_usd","label":"Price","type":"number","required":true,"unit":"USD","position":1},
   {"key":"in_stock","label":"In Stock","type":"boolean","required":false,"position":2}]'::jsonb),

('b1000000-0000-0000-0000-000000000002', 'Media Item',
 'Fields common to books, film and music.',
 '[{"key":"title","label":"Title","type":"string","required":true,"position":0},
   {"key":"creator","label":"Creator","type":"string","required":false,"position":1},
   {"key":"release_date","label":"Release Date","type":"date","required":false,"position":2},
   {"key":"runtime_min","label":"Runtime","type":"number","required":false,"unit":"min","position":3}]'::jsonb),

('b1000000-0000-0000-0000-000000000003', 'Physical Goods',
 'Shipping and handling attributes.',
 '[{"key":"weight_kg","label":"Weight","type":"number","required":false,"unit":"kg","position":0},
   {"key":"dimensions_cm","label":"Dimensions","type":"string","required":false,"unit":"cm","position":1},
   {"key":"is_fragile","label":"Fragile","type":"boolean","required":false,"position":2}]'::jsonb);


-- ============================================================
-- 2. Categories — schema lives on the node
-- ============================================================

-- ── Electronics ─────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('e0000000-0000-0000-0000-000000000001', 'Electronics', 'electronics',
 'Consumer electronics and computing hardware.', NULL,
 '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
   {"key":"model_number","label":"Model Number","type":"string","required":false,"position":1},
   {"key":"warranty_months","label":"Warranty","type":"number","required":false,"unit":"months","position":2}]'::jsonb,
 'cpu', '#38bdf8', 0);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('e0000000-0000-0000-0000-000000000002', 'Laptops', 'laptops',
 'Portable computers.', 'e0000000-0000-0000-0000-000000000001',
 '[{"key":"screen_size_in","label":"Screen Size","type":"number","required":false,"unit":"in","position":0},
   {"key":"ram_gb","label":"RAM","type":"number","required":false,"unit":"GB","position":1},
   {"key":"cpu","label":"CPU","type":"string","required":false,"position":2},
   {"key":"gpu","label":"GPU","type":"string","required":false,"position":3}]'::jsonb,
 'laptop', '#60a5fa', 0),

('e0000000-0000-0000-0000-000000000004', 'Smartphones', 'smartphones',
 'Mobile phones — cannot see a single Laptops field.', 'e0000000-0000-0000-0000-000000000001',
 '[{"key":"battery_mah","label":"Battery","type":"number","required":false,"unit":"mAh","position":0},
   {"key":"storage_gb","label":"Storage","type":"number","required":false,"unit":"GB","position":1},
   {"key":"has_5g","label":"5G","type":"boolean","required":false,"position":2}]'::jsonb,
 'smartphone', '#818cf8', 1);

-- Three levels deep AND overriding an inherited field: the money node.
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, overrides, icon, color, position) VALUES
('e0000000-0000-0000-0000-000000000003', 'Gaming Laptops', 'gaming-laptops',
 'High-refresh machines. Inherits 3 fields from Electronics + 4 from Laptops, adds 2, and tightens the inherited warranty field.',
 'e0000000-0000-0000-0000-000000000002',
 '[{"key":"refresh_rate_hz","label":"Refresh Rate","type":"number","required":false,"unit":"Hz","position":0},
   {"key":"has_rgb","label":"RGB Lighting","type":"boolean","required":false,"position":1}]'::jsonb,
 '{"warranty_months":{"label":"Warranty (months)","required":true}}'::jsonb,
 'gamepad-2', '#a78bfa', 0);

-- ── Clothing, Shoes & Jewelry ───────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('c0000000-0000-0000-0000-000000000001', 'Clothing, Shoes & Jewelry', 'clothing-shoes-jewelry',
 'Apparel and accessories.', NULL,
 '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
   {"key":"material","label":"Material","type":"string","required":false,"position":1},
   {"key":"care_instructions","label":"Care Instructions","type":"text","required":false,"position":2}]'::jsonb,
 'shirt', '#f472b6', 1);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('c0000000-0000-0000-0000-000000000002', 'Mens Clothing', 'mens-clothing',
 'Menswear.', 'c0000000-0000-0000-0000-000000000001',
 '[{"key":"size","label":"Size","type":"select","required":true,"options":["XS","S","M","L","XL","XXL"],"position":0},
   {"key":"fit","label":"Fit","type":"string","required":false,"position":1}]'::jsonb,
 'shirt', '#fb7185', 0),

('c0000000-0000-0000-0000-000000000003', 'Womens Clothing', 'womens-clothing',
 'Womenswear — defines its own `size`, which siblings may legitimately reuse.', 'c0000000-0000-0000-0000-000000000001',
 '[{"key":"size","label":"Size","type":"select","required":true,"options":["XS","S","M","L","XL","XXL"],"position":0},
   {"key":"fit","label":"Fit","type":"string","required":false,"position":1},
   {"key":"is_maternity","label":"Maternity","type":"boolean","required":false,"position":2}]'::jsonb,
 'shirt', '#f9a8d4', 1);

-- ── Books ───────────────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('40000000-0000-0000-0000-000000000001', 'Books', 'books',
 'Printed and digital books.', NULL,
 '[{"key":"author","label":"Author","type":"string","required":true,"position":0},
   {"key":"isbn","label":"ISBN","type":"string","required":false,"position":1},
   {"key":"page_count","label":"Pages","type":"number","required":false,"position":2},
   {"key":"language","label":"Language","type":"string","required":false,"position":3}]'::jsonb,
 'book-open', '#fbbf24', 2);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('40000000-0000-0000-0000-000000000002', 'Fiction', 'fiction',
 'Novels and short stories.', '40000000-0000-0000-0000-000000000001',
 '[{"key":"genre","label":"Genre","type":"select","required":false,"options":["Fantasy","Science Fiction","Mystery","Romance","Thriller","Literary"],"position":0},
   {"key":"is_series","label":"Part of a Series","type":"boolean","required":false,"position":1}]'::jsonb,
 'book', '#fcd34d', 0),

('40000000-0000-0000-0000-000000000003', 'Non-Fiction', 'non-fiction',
 'Reference and factual works.', '40000000-0000-0000-0000-000000000001',
 '[{"key":"subject","label":"Subject","type":"string","required":false,"position":0},
   {"key":"has_index","label":"Has Index","type":"boolean","required":false,"position":1}]'::jsonb,
 'graduation-cap', '#fde68a', 1);

-- ── Home & Kitchen ──────────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('40000000-0000-0000-0000-000000000011', 'Home & Kitchen', 'home-kitchen',
 'Furnishings and household appliances.', NULL,
 '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
   {"key":"material","label":"Material","type":"string","required":false,"position":1},
   {"key":"dimensions_cm","label":"Dimensions","type":"string","required":false,"unit":"cm","position":2}]'::jsonb,
 'house', '#34d399', 3);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('40000000-0000-0000-0000-000000000012', 'Furniture', 'furniture',
 'Tables, chairs and storage.', '40000000-0000-0000-0000-000000000011',
 '[{"key":"assembly_required","label":"Assembly Required","type":"boolean","required":false,"position":0},
   {"key":"weight_kg","label":"Weight","type":"number","required":false,"unit":"kg","position":1}]'::jsonb,
 'sofa', '#6ee7b7', 0),

('40000000-0000-0000-0000-000000000013', 'Kitchen Appliances', 'kitchen-appliances',
 'Small and large kitchen electricals.', '40000000-0000-0000-0000-000000000011',
 '[{"key":"wattage","label":"Wattage","type":"number","required":false,"unit":"W","position":0},
   {"key":"is_dishwasher_safe","label":"Dishwasher Safe","type":"boolean","required":false,"position":1}]'::jsonb,
 'cooking-pot', '#a7f3d0', 1);


-- ============================================================
-- 3. Items
-- ------------------------------------------------------------
-- Every item carries the FULL effective schema of its category:
-- inherited fields plus its own. Values cycle through realistic
-- arrays so the data varies without a thousand literal rows.
-- ============================================================

-- ── Laptops → 20 items (7 effective fields) ─────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000002', jsonb_build_object(
  'brand',            (ARRAY['Dell','HP','Lenovo','Apple','ASUS'])[1 + (i % 5)],
  'model_number',     'LP-' || (1000 + i),
  'warranty_months',  (ARRAY[12,24,36])[1 + (i % 3)],
  'screen_size_in',   (ARRAY[13.3,14.0,15.6,16.0])[1 + (i % 4)],
  'ram_gb',           (ARRAY[8,16,32,64])[1 + (i % 4)],
  'cpu',              (ARRAY['Intel Core i5','Intel Core i7','AMD Ryzen 5','AMD Ryzen 7','Apple M3'])[1 + (i % 5)],
  'gpu',              (ARRAY['Integrated','NVIDIA RTX 4050','NVIDIA RTX 4060','AMD Radeon 780M'])[1 + (i % 4)]
) FROM generate_series(0, 19) AS i;

-- ── Gaming Laptops → 8 items (9 effective fields) ───────────
-- warranty_months is REQUIRED here because of the override, so every
-- row carries it — the override reaching the data layer, visibly.
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000003', jsonb_build_object(
  'brand',            (ARRAY['ASUS ROG','MSI','Alienware','Razer'])[1 + (i % 4)],
  'model_number',     'GL-' || (2000 + i),
  'warranty_months',  (ARRAY[24,36])[1 + (i % 2)],
  'screen_size_in',   (ARRAY[15.6,16.0,17.3])[1 + (i % 3)],
  'ram_gb',           (ARRAY[16,32,64])[1 + (i % 3)],
  'cpu',              (ARRAY['Intel Core i9','AMD Ryzen 9','Intel Core i7'])[1 + (i % 3)],
  'gpu',              (ARRAY['NVIDIA RTX 4070','NVIDIA RTX 4080','NVIDIA RTX 4090'])[1 + (i % 3)],
  'refresh_rate_hz',  (ARRAY[144,165,240,360])[1 + (i % 4)],
  'has_rgb',          (i % 3) <> 0
) FROM generate_series(0, 7) AS i;

-- ── Smartphones → 20 items (6 effective fields) ─────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000004', jsonb_build_object(
  'brand',            (ARRAY['Apple','Samsung','Google','OnePlus','Xiaomi'])[1 + (i % 5)],
  'model_number',     'SP-' || (3000 + i),
  'warranty_months',  (ARRAY[12,24])[1 + (i % 2)],
  'battery_mah',      (ARRAY[3200,4000,4500,5000])[1 + (i % 4)],
  'storage_gb',       (ARRAY[128,256,512,1024])[1 + (i % 4)],
  'has_5g',           (i % 5) <> 0
) FROM generate_series(0, 19) AS i;

-- ── Mens Clothing → 15 items (5 effective fields) ───────────
INSERT INTO public.items (category_id, data)
SELECT 'c0000000-0000-0000-0000-000000000002', jsonb_build_object(
  'brand',             (ARRAY['Levi''s','Uniqlo','H&M','Zara','Nike'])[1 + (i % 5)],
  'material',          (ARRAY['Cotton','Denim','Wool','Linen','Polyester'])[1 + (i % 5)],
  'care_instructions', (ARRAY['Machine wash cold','Hand wash only','Dry clean only'])[1 + (i % 3)],
  'size',              (ARRAY['XS','S','M','L','XL','XXL'])[1 + (i % 6)],
  'fit',               (ARRAY['Slim','Regular','Relaxed'])[1 + (i % 3)]
) FROM generate_series(0, 14) AS i;

-- ── Womens Clothing → 15 items (6 effective fields) ─────────
INSERT INTO public.items (category_id, data)
SELECT 'c0000000-0000-0000-0000-000000000003', jsonb_build_object(
  'brand',             (ARRAY['Zara','Mango','H&M','COS','Uniqlo'])[1 + (i % 5)],
  'material',          (ARRAY['Cotton','Silk','Wool','Viscose','Linen'])[1 + (i % 5)],
  'care_instructions', (ARRAY['Machine wash cold','Hand wash only','Dry clean only'])[1 + (i % 3)],
  'size',              (ARRAY['XS','S','M','L','XL','XXL'])[1 + (i % 6)],
  'fit',               (ARRAY['Fitted','Regular','Oversized'])[1 + (i % 3)],
  'is_maternity',      (i % 5) = 0
) FROM generate_series(0, 14) AS i;

-- ── Fiction → 15 items (6 effective fields) ─────────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000002', jsonb_build_object(
  'author',     (ARRAY['Ursula K. Le Guin','N. K. Jemisin','Kazuo Ishiguro','Donna Tartt','Neil Gaiman'])[1 + (i % 5)],
  'isbn',       '978-0-' || (100000 + i * 7),
  'page_count', 220 + (i * 23) % 400,
  'language',   (ARRAY['English','Spanish','French'])[1 + (i % 3)],
  'genre',      (ARRAY['Fantasy','Science Fiction','Mystery','Romance','Thriller','Literary'])[1 + (i % 6)],
  'is_series',  (i % 3) = 0
) FROM generate_series(0, 14) AS i;

-- ── Non-Fiction → 15 items (6 effective fields) ─────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000003', jsonb_build_object(
  'author',     (ARRAY['Yuval Noah Harari','Mary Roach','Bill Bryson','Michelle Alexander','Oliver Sacks'])[1 + (i % 5)],
  'isbn',       '978-1-' || (200000 + i * 11),
  'page_count', 180 + (i * 31) % 450,
  'language',   (ARRAY['English','German','Japanese'])[1 + (i % 3)],
  'subject',    (ARRAY['History','Science','Biography','Economics','Psychology'])[1 + (i % 5)],
  'has_index',  (i % 4) <> 0
) FROM generate_series(0, 14) AS i;

-- ── Furniture → 10 items (5 effective fields) ───────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000012', jsonb_build_object(
  'brand',             (ARRAY['IKEA','Herman Miller','West Elm','Muji'])[1 + (i % 4)],
  'material',          (ARRAY['Oak','Pine','Steel','Walnut','Rattan'])[1 + (i % 5)],
  'dimensions_cm',     (ARRAY['120x60x75','180x90x75','60x60x45','200x100x80'])[1 + (i % 4)],
  'assembly_required', (i % 3) <> 0,
  'weight_kg',         (ARRAY[8.5,14.0,22.5,35.0])[1 + (i % 4)]
) FROM generate_series(0, 9) AS i;

-- ── Kitchen Appliances → 10 items (5 effective fields) ──────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000013', jsonb_build_object(
  'brand',              (ARRAY['Bosch','Philips','KitchenAid','Ninja'])[1 + (i % 4)],
  'material',           (ARRAY['Stainless Steel','Plastic','Glass','Ceramic'])[1 + (i % 4)],
  'dimensions_cm',      (ARRAY['30x20x25','45x35x40','25x25x30'])[1 + (i % 3)],
  'wattage',            (ARRAY[600,900,1200,1800])[1 + (i % 4)],
  'is_dishwasher_safe', (i % 2) = 0
) FROM generate_series(0, 9) AS i;


-- ============================================================
-- 4. Verification (this is what the SQL editor displays)
-- ------------------------------------------------------------
-- `Gaming Laptops` MUST show 9 effective fields:
--   3 inherited from Electronics + 4 from Laptops + 2 of its own.
-- `Smartphones` must show 6 and contain NO laptop field.
-- ============================================================
SELECT
  c.name                                                          AS category,
  jsonb_array_length(public.get_effective_schema(c.id))           AS effective_fields,
  jsonb_array_length(c.own_fields)                                AS own_fields,
  (SELECT count(*) FROM jsonb_array_elements(public.get_effective_schema(c.id)) e
    WHERE (e->>'inherited')::boolean)                             AS inherited_fields,
  (SELECT count(*) FROM public.items i WHERE i.category_id = c.id) AS items
FROM public.categories c
ORDER BY c.name;

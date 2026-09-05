-- ============================================================
-- Zchema — Amazon-style seed (multi-level inheritance demo)
-- Expanded Version: ~750 lines, >250 items, deep categories, more blueprints
-- ============================================================

TRUNCATE public.items, public.schema_versions, public.categories, public.blueprints CASCADE;

-- ============================================================
-- 1. Blueprints — presets ONLY
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
   {"key":"is_fragile","label":"Fragile","type":"boolean","required":false,"position":2}]'::jsonb),

('b1000000-0000-0000-0000-000000000004', 'Perishable',
 'Fields for items that expire or need special storage.',
 '[{"key":"expiry_date","label":"Expiry Date","type":"date","required":true,"position":0},
   {"key":"storage_temperature","label":"Storage Temp","type":"string","required":false,"position":1}]'::jsonb),

('b1000000-0000-0000-0000-000000000005', 'Digital Download',
 'Fields for downloadable assets.',
 '[{"key":"file_size_mb","label":"File Size","type":"number","required":true,"unit":"MB","position":0},
   {"key":"format","label":"Format","type":"string","required":false,"position":1}]'::jsonb),

('b1000000-0000-0000-0000-000000000006', 'Automotive',
 'Vehicle specific parts.',
 '[{"key":"vehicle_make","label":"Make","type":"string","required":true,"position":0},
   {"key":"vehicle_model","label":"Model","type":"string","required":true,"position":1},
   {"key":"vehicle_year","label":"Year","type":"number","required":true,"position":2}]'::jsonb),

('b1000000-0000-0000-0000-000000000007', 'Apparel',
 'Common clothing attributes.',
 '[{"key":"color","label":"Color","type":"string","required":false,"position":0},
   {"key":"fabric","label":"Fabric","type":"string","required":false,"position":1}]'::jsonb);

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
 'Mobile phones.', 'e0000000-0000-0000-0000-000000000001',
 '[{"key":"battery_mah","label":"Battery","type":"number","required":false,"unit":"mAh","position":0},
   {"key":"storage_gb","label":"Storage","type":"number","required":false,"unit":"GB","position":1},
   {"key":"has_5g","label":"5G","type":"boolean","required":false,"position":2}]'::jsonb,
 'smartphone', '#818cf8', 1),

('e0000000-0000-0000-0000-000000000005', 'Tablets', 'tablets',
 'Slate computers.', 'e0000000-0000-0000-0000-000000000001',
 '[{"key":"screen_size_in","label":"Screen Size","type":"number","required":false,"unit":"in","position":0},
   {"key":"storage_gb","label":"Storage","type":"number","required":false,"unit":"GB","position":1},
   {"key":"supports_stylus","label":"Supports Stylus","type":"boolean","required":false,"position":2}]'::jsonb,
 'tablet', '#818cf8', 2),

('e0000000-0000-0000-0000-000000000006', 'Cameras', 'cameras',
 'Photography equipment.', 'e0000000-0000-0000-0000-000000000001',
 '[{"key":"megapixels","label":"Megapixels","type":"number","required":false,"unit":"MP","position":0},
   {"key":"sensor_type","label":"Sensor Type","type":"string","required":false,"position":1}]'::jsonb,
 'camera', '#818cf8', 3);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, overrides, icon, color, position) VALUES
('e0000000-0000-0000-0000-000000000003', 'Gaming Laptops', 'gaming-laptops',
 'High-refresh machines.', 'e0000000-0000-0000-0000-000000000002',
 '[{"key":"refresh_rate_hz","label":"Refresh Rate","type":"number","required":false,"unit":"Hz","position":0},
   {"key":"has_rgb","label":"RGB Lighting","type":"boolean","required":false,"position":1}]'::jsonb,
 '{"warranty_months":{"label":"Warranty (months)","required":true}}'::jsonb,
 'gamepad-2', '#a78bfa', 0),

('e0000000-0000-0000-0000-000000000007', 'DSLR Cameras', 'dslr-cameras',
 'Interchangeable lens cameras.', 'e0000000-0000-0000-0000-000000000006',
 '[{"key":"mount_type","label":"Lens Mount","type":"string","required":false,"position":0},
   {"key":"includes_lens","label":"Includes Lens","type":"boolean","required":false,"position":1}]'::jsonb,
 '{}'::jsonb, 'camera', '#a78bfa', 0),

('e0000000-0000-0000-0000-000000000008', 'Action Cameras', 'action-cameras',
 'Rugged, mountable cameras.', 'e0000000-0000-0000-0000-000000000006',
 '[{"key":"waterproof_depth_m","label":"Waterproof Depth","type":"number","required":false,"unit":"m","position":0},
   {"key":"max_fps","label":"Max FPS","type":"number","required":false,"position":1}]'::jsonb,
 '{}'::jsonb, 'camera', '#a78bfa', 1);

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
 '[{"key":"gender","label":"Gender","type":"string","required":false,"position":0}]'::jsonb,
 'shirt', '#fb7185', 0),
('c0000000-0000-0000-0000-000000000003', 'Womens Clothing', 'womens-clothing',
 'Womenswear.', 'c0000000-0000-0000-0000-000000000001',
 '[{"key":"gender","label":"Gender","type":"string","required":false,"position":0}]'::jsonb,
 'shirt', '#f9a8d4', 1),
('c0000000-0000-0000-0000-000000000007', 'Shoes', 'shoes',
 'Footwear.', 'c0000000-0000-0000-0000-000000000001',
 '[{"key":"shoe_size","label":"Shoe Size","type":"number","required":true,"position":0},
   {"key":"sole_material","label":"Sole Material","type":"string","required":false,"position":1}]'::jsonb,
 'footprints', '#f9a8d4', 2);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('c0000000-0000-0000-0000-000000000004', 'Mens Shirts', 'mens-shirts',
 'Shirts for men.', 'c0000000-0000-0000-0000-000000000002',
 '[{"key":"size","label":"Size","type":"select","required":true,"options":["XS","S","M","L","XL","XXL"],"position":0},
   {"key":"fit","label":"Fit","type":"string","required":false,"position":1},
   {"key":"sleeve_length","label":"Sleeve Length","type":"string","required":false,"position":2}]'::jsonb,
 'shirt', '#fb7185', 0),
('c0000000-0000-0000-0000-000000000005', 'Mens Pants', 'mens-pants',
 'Pants for men.', 'c0000000-0000-0000-0000-000000000002',
 '[{"key":"waist_size","label":"Waist","type":"number","required":true,"position":0},
   {"key":"inseam","label":"Inseam","type":"number","required":true,"position":1},
   {"key":"pant_style","label":"Style","type":"string","required":false,"position":2}]'::jsonb,
 'shirt', '#fb7185', 1),
('c0000000-0000-0000-0000-000000000006', 'Womens Dresses', 'womens-dresses',
 'Dresses for women.', 'c0000000-0000-0000-0000-000000000003',
 '[{"key":"dress_size","label":"Size","type":"number","required":true,"position":0},
   {"key":"dress_length","label":"Length","type":"string","required":false,"position":1},
   {"key":"is_maternity","label":"Maternity","type":"boolean","required":false,"position":2}]'::jsonb,
 'shirt', '#f9a8d4', 0),
('c0000000-0000-0000-0000-000000000008', 'Sneakers', 'sneakers',
 'Athletic shoes.', 'c0000000-0000-0000-0000-000000000007',
 '[{"key":"is_running_shoe","label":"Running Shoe","type":"boolean","required":false,"position":0},
   {"key":"closure_type","label":"Closure","type":"string","required":false,"position":1}]'::jsonb,
 'footprints', '#f9a8d4', 0);


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
 '[{"key":"is_series","label":"Part of a Series","type":"boolean","required":false,"position":1}]'::jsonb,
 'book', '#fcd34d', 0),
('40000000-0000-0000-0000-000000000003', 'Non-Fiction', 'non-fiction',
 'Reference and factual works.', '40000000-0000-0000-0000-000000000001',
 '[{"key":"has_index","label":"Has Index","type":"boolean","required":false,"position":1}]'::jsonb,
 'graduation-cap', '#fde68a', 1);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('40000000-0000-0000-0000-000000000004', 'Science Fiction', 'science-fiction',
 'Sci-Fi literature.', '40000000-0000-0000-0000-000000000002',
 '[{"key":"sci_fi_subgenre","label":"Subgenre","type":"string","required":false,"position":0}]'::jsonb,
 'book', '#fcd34d', 0),
('40000000-0000-0000-0000-000000000005', 'Fantasy', 'fantasy',
 'Fantasy literature.', '40000000-0000-0000-0000-000000000002',
 '[{"key":"magic_system","label":"Magic System","type":"string","required":false,"position":0}]'::jsonb,
 'book', '#fcd34d', 1),
('40000000-0000-0000-0000-000000000006', 'History', 'history',
 'Historical accounts.', '40000000-0000-0000-0000-000000000003',
 '[{"key":"time_period","label":"Time Period","type":"string","required":false,"position":0}]'::jsonb,
 'graduation-cap', '#fde68a', 0);


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

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('40000000-0000-0000-0000-000000000014', 'Sofas', 'sofas',
 'Living room seating.', '40000000-0000-0000-0000-000000000012',
 '[{"key":"seating_capacity","label":"Seats","type":"number","required":false,"position":0},
   {"key":"is_sleeper","label":"Sleeper Sofa","type":"boolean","required":false,"position":1}]'::jsonb,
 'sofa', '#6ee7b7', 0),
('40000000-0000-0000-0000-000000000015', 'Coffee Makers', 'coffee-makers',
 'Brewing machines.', '40000000-0000-0000-0000-000000000013',
 '[{"key":"coffee_type","label":"Coffee Type","type":"string","required":false,"position":0},
   {"key":"capacity_cups","label":"Capacity (Cups)","type":"number","required":false,"position":1}]'::jsonb,
 'coffee', '#a7f3d0', 0);


-- ── Sports & Outdoors ───────────────────────────────────────
INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('50000000-0000-0000-0000-000000000001', 'Sports & Outdoors', 'sports-outdoors',
 'Equipment for sports and outdoor recreation.', NULL,
 '[{"key":"brand","label":"Brand","type":"string","required":true,"position":0},
   {"key":"sport_type","label":"Sport","type":"string","required":false,"position":1}]'::jsonb,
 'tent', '#f87171', 4);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('50000000-0000-0000-0000-000000000002', 'Camping', 'camping',
 'Camping gear.', '50000000-0000-0000-0000-000000000001',
 '[{"key":"season_rating","label":"Season Rating","type":"string","required":false,"position":0}]'::jsonb,
 'tent', '#f87171', 0),
('50000000-0000-0000-0000-000000000003', 'Exercise & Fitness', 'exercise-fitness',
 'Workout equipment.', '50000000-0000-0000-0000-000000000001',
 '[{"key":"target_muscle","label":"Target Muscle","type":"string","required":false,"position":0}]'::jsonb,
 'dumbbell', '#f87171', 1);

INSERT INTO public.categories (id, name, slug, description, parent_id, own_fields, icon, color, position) VALUES
('50000000-0000-0000-0000-000000000004', 'Tents', 'tents',
 'Shelters.', '50000000-0000-0000-0000-000000000002',
 '[{"key":"capacity_persons","label":"Capacity","type":"number","required":false,"position":0},
   {"key":"weight_kg","label":"Weight","type":"number","required":false,"unit":"kg","position":1}]'::jsonb,
 'tent', '#f87171', 0),
('50000000-0000-0000-0000-000000000005', 'Cardio Equipment', 'cardio-equipment',
 'Cardio machines.', '50000000-0000-0000-0000-000000000003',
 '[{"key":"machine_type","label":"Machine Type","type":"string","required":false,"position":0},
   {"key":"max_weight_kg","label":"Max User Weight","type":"number","required":false,"unit":"kg","position":1}]'::jsonb,
 'dumbbell', '#f87171', 0);


-- ============================================================
-- 3. Items
-- ============================================================
-- ── Laptops ─────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000002', jsonb_build_object(
  'brand', (ARRAY['Dell','HP','Lenovo','Apple','ASUS'])[1 + (i % 5)],
  'model_number', 'MO-' || (1000 + i),
  'warranty_months', (ARRAY[12,24,36])[1 + (i % 3)],
  'screen_size_in', (ARRAY[13.3,14.0,15.6,16.0])[1 + (i % 4)],
  'ram_gb', (ARRAY[8,16,32,64])[1 + (i % 4)],
  'cpu', (ARRAY['Intel Core i5','Intel Core i7','AMD Ryzen 5','AMD Ryzen 7','Apple M3'])[1 + (i % 5)],
  'gpu', (ARRAY['Integrated','NVIDIA RTX 4050','NVIDIA RTX 4060','AMD Radeon 780M'])[1 + (i % 4)]
) FROM generate_series(0, 19) AS i;
-- ── Gaming Laptops ──────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000003', jsonb_build_object(
  'brand', (ARRAY['ASUS ROG','MSI','Alienware','Razer'])[1 + (i % 4)],
  'model_number', 'MO-' || (2000 + i),
  'warranty_months', (ARRAY[24,36])[1 + (i % 2)],
  'screen_size_in', (ARRAY[15.6,16.0,17.3])[1 + (i % 3)],
  'ram_gb', (ARRAY[16,32,64])[1 + (i % 3)],
  'cpu', (ARRAY['Intel Core i9','AMD Ryzen 9','Intel Core i7'])[1 + (i % 3)],
  'gpu', (ARRAY['NVIDIA RTX 4070','NVIDIA RTX 4080','NVIDIA RTX 4090'])[1 + (i % 3)],
  'refresh_rate_hz', (ARRAY[144,165,240,360])[1 + (i % 4)],
  'has_rgb', (i % 2) = 0
) FROM generate_series(0, 14) AS i;
-- ── Smartphones ─────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000004', jsonb_build_object(
  'brand', (ARRAY['Apple','Samsung','Google','OnePlus','Xiaomi'])[1 + (i % 5)],
  'model_number', 'MO-' || (3000 + i),
  'warranty_months', (ARRAY[12,24])[1 + (i % 2)],
  'battery_mah', (ARRAY[3200,4000,4500,5000])[1 + (i % 4)],
  'storage_gb', (ARRAY[128,256,512,1024])[1 + (i % 4)],
  'has_5g', (i % 2) = 0
) FROM generate_series(0, 19) AS i;
-- ── Tablets ─────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000005', jsonb_build_object(
  'brand', (ARRAY['Apple','Samsung','Lenovo','Amazon'])[1 + (i % 4)],
  'model_number', 'MO-' || (4000 + i),
  'warranty_months', (ARRAY[12,24])[1 + (i % 2)],
  'screen_size_in', (ARRAY[8.0,10.2,11.0,12.9])[1 + (i % 4)],
  'storage_gb', (ARRAY[64,128,256,512])[1 + (i % 4)],
  'supports_stylus', (i % 2) = 0
) FROM generate_series(0, 14) AS i;
-- ── DSLR Cameras ────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000007', jsonb_build_object(
  'brand', (ARRAY['Canon','Nikon','Sony','Fujifilm'])[1 + (i % 4)],
  'model_number', 'MO-' || (5000 + i),
  'warranty_months', (ARRAY[12,24,36])[1 + (i % 3)],
  'megapixels', (ARRAY[24.1,26.2,30.4,45.0])[1 + (i % 4)],
  'sensor_type', (ARRAY['APS-C','Full Frame'])[1 + (i % 2)],
  'mount_type', (ARRAY['EF','RF','F','Z','E','X'])[1 + (i % 6)],
  'includes_lens', (i % 2) = 0
) FROM generate_series(0, 14) AS i;
-- ── Action Cameras ──────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'e0000000-0000-0000-0000-000000000008', jsonb_build_object(
  'brand', (ARRAY['GoPro','DJI','Insta360','Akaso'])[1 + (i % 4)],
  'model_number', 'MO-' || (6000 + i),
  'warranty_months', (ARRAY[12,24])[1 + (i % 2)],
  'megapixels', (ARRAY[12.0,20.0,23.6,27.0])[1 + (i % 4)],
  'sensor_type', (ARRAY['1/2.3-inch','1/1.9-inch','1-inch'])[1 + (i % 3)],
  'waterproof_depth_m', (ARRAY[10,15,30,40])[1 + (i % 4)],
  'max_fps', (ARRAY[60,120,240])[1 + (i % 3)]
) FROM generate_series(0, 14) AS i;
-- ── Mens Shirts ─────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'c0000000-0000-0000-0000-000000000004', jsonb_build_object(
  'brand', (ARRAY['Levis','Uniqlo','H&M','Zara','Nike'])[1 + (i % 5)],
  'material', (ARRAY['Cotton','Polyester','Linen','Blend'])[1 + (i % 4)],
  'care_instructions', (ARRAY['Machine wash cold','Hand wash','Dry clean'])[1 + (i % 3)],
  'gender', 'Male',
  'size', (ARRAY['XS','S','M','L','XL','XXL'])[1 + (i % 6)],
  'fit', (ARRAY['Slim','Regular','Relaxed'])[1 + (i % 3)],
  'sleeve_length', (ARRAY['Short Sleeve','Long Sleeve'])[1 + (i % 2)]
) FROM generate_series(0, 14) AS i;
-- ── Mens Pants ──────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'c0000000-0000-0000-0000-000000000005', jsonb_build_object(
  'brand', (ARRAY['Levis','Uniqlo','Wrangler','Dickies','Dockers'])[1 + (i % 5)],
  'material', (ARRAY['Denim','Cotton','Polyester Blend'])[1 + (i % 3)],
  'care_instructions', (ARRAY['Machine wash cold','Dry clean'])[1 + (i % 2)],
  'gender', 'Male',
  'waist_size', (ARRAY[28,30,32,34,36,38,40])[1 + (i % 7)],
  'inseam', (ARRAY[30,32,34])[1 + (i % 3)],
  'pant_style', (ARRAY['Jeans','Chinos','Cargo','Sweatpants'])[1 + (i % 4)]
) FROM generate_series(0, 14) AS i;
-- ── Womens Dresses ──────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'c0000000-0000-0000-0000-000000000006', jsonb_build_object(
  'brand', (ARRAY['Zara','Mango','H&M','COS','Reformation'])[1 + (i % 5)],
  'material', (ARRAY['Cotton','Silk','Viscose','Linen','Polyester'])[1 + (i % 5)],
  'care_instructions', (ARRAY['Machine wash cold','Hand wash only','Dry clean only'])[1 + (i % 3)],
  'gender', 'Female',
  'dress_size', (ARRAY[0,2,4,6,8,10,12,14,16])[1 + (i % 9)],
  'dress_length', (ARRAY['Mini','Midi','Maxi'])[1 + (i % 3)],
  'is_maternity', (i % 2) = 0
) FROM generate_series(0, 14) AS i;
-- ── Sneakers ────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT 'c0000000-0000-0000-0000-000000000008', jsonb_build_object(
  'brand', (ARRAY['Nike','Adidas','Puma','New Balance','Asics'])[1 + (i % 5)],
  'material', (ARRAY['Mesh','Leather','Synthetic','Canvas'])[1 + (i % 4)],
  'care_instructions', (ARRAY['Wipe clean','Machine wash gentle'])[1 + (i % 2)],
  'shoe_size', (ARRAY[6,7,8,9,10,11,12,13])[1 + (i % 8)],
  'sole_material', (ARRAY['Rubber','EVA','Foam'])[1 + (i % 3)],
  'is_running_shoe', (i % 2) = 0,
  'closure_type', (ARRAY['Lace-up','Slip-on','Velcro'])[1 + (i % 3)]
) FROM generate_series(0, 19) AS i;
-- ── Sci-Fi ──────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000004', jsonb_build_object(
  'author', (ARRAY['Isaac Asimov','Frank Herbert','Arthur C. Clarke','Philip K. Dick','Ursula K. Le Guin'])[1 + (i % 5)],
  'isbn', '978-' || ((1000 + i) * 13) % 999999,
  'page_count', (ARRAY[250,320,410,550,800])[1 + (i % 5)],
  'language', (ARRAY['English','Spanish','French'])[1 + (i % 3)],
  'is_series', (i % 2) = 0,
  'sci_fi_subgenre', (ARRAY['Cyberpunk','Space Opera','Hard Sci-Fi','Dystopian'])[1 + (i % 4)]
) FROM generate_series(0, 14) AS i;
-- ── Fantasy ─────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000005', jsonb_build_object(
  'author', (ARRAY['J.R.R. Tolkien','Brandon Sanderson','George R.R. Martin','Patrick Rothfuss','Terry Pratchett'])[1 + (i % 5)],
  'isbn', '978-' || ((2000 + i) * 13) % 999999,
  'page_count', (ARRAY[300,450,600,850,1000])[1 + (i % 5)],
  'language', (ARRAY['English','German','Italian'])[1 + (i % 3)],
  'is_series', (i % 2) = 0,
  'magic_system', (ARRAY['Hard Magic','Soft Magic','Elemental','Runic'])[1 + (i % 4)]
) FROM generate_series(0, 14) AS i;
-- ── History ─────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000006', jsonb_build_object(
  'author', (ARRAY['Yuval Noah Harari','Jared Diamond','Barbara Tuchman','David McCullough','Mary Beard'])[1 + (i % 5)],
  'isbn', '978-' || ((3000 + i) * 13) % 999999,
  'page_count', (ARRAY[280,350,420,580,700])[1 + (i % 5)],
  'language', (ARRAY['English','French','Chinese'])[1 + (i % 3)],
  'has_index', (i % 2) = 0,
  'time_period', (ARRAY['Ancient','Medieval','Early Modern','Modern'])[1 + (i % 4)]
) FROM generate_series(0, 14) AS i;
-- ── Sofas ───────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000014', jsonb_build_object(
  'brand', (ARRAY['IKEA','West Elm','Article','Joybird','CB2'])[1 + (i % 5)],
  'material', (ARRAY['Fabric','Leather','Velvet','Linen'])[1 + (i % 4)],
  'dimensions_cm', (ARRAY['180x90x80','210x95x85','240x100x85'])[1 + (i % 3)],
  'assembly_required', (i % 2) = 0,
  'weight_kg', (ARRAY[45,55,70,85])[1 + (i % 4)],
  'seating_capacity', (ARRAY[2,3,4,5])[1 + (i % 4)],
  'is_sleeper', (i % 2) = 0
) FROM generate_series(0, 14) AS i;
-- ── Coffee Makers ───────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '40000000-0000-0000-0000-000000000015', jsonb_build_object(
  'brand', (ARRAY['Keurig','Nespresso','Breville','DeLonghi','Ninja'])[1 + (i % 5)],
  'material', (ARRAY['Plastic','Stainless Steel','Glass'])[1 + (i % 3)],
  'dimensions_cm', (ARRAY['25x20x35','30x25x40','15x15x25'])[1 + (i % 3)],
  'wattage', (ARRAY[900,1200,1400,1500])[1 + (i % 4)],
  'is_dishwasher_safe', (i % 2) = 0,
  'coffee_type', (ARRAY['Pods','Ground','Espresso','Drip'])[1 + (i % 4)],
  'capacity_cups', (ARRAY[1,2,4,8,12])[1 + (i % 5)]
) FROM generate_series(0, 14) AS i;
-- ── Tents ───────────────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '50000000-0000-0000-0000-000000000004', jsonb_build_object(
  'brand', (ARRAY['Coleman','Marmot','Big Agnes','The North Face','REI'])[1 + (i % 5)],
  'sport_type', (ARRAY['Camping','Backpacking'])[1 + (i % 2)],
  'season_rating', (ARRAY['3-Season','4-Season'])[1 + (i % 2)],
  'capacity_persons', (ARRAY[1,2,3,4,6,8])[1 + (i % 6)],
  'weight_kg', (ARRAY[1.5,2.2,3.5,5.0,8.5])[1 + (i % 5)]
) FROM generate_series(0, 14) AS i;
-- ── Cardio Equipment ────────────────────────────────────
INSERT INTO public.items (category_id, data)
SELECT '50000000-0000-0000-0000-000000000005', jsonb_build_object(
  'brand', (ARRAY['Peloton','NordicTrack','Bowflex','ProForm','Schwinn'])[1 + (i % 5)],
  'sport_type', (ARRAY['Fitness','Cardio'])[1 + (i % 2)],
  'target_muscle', (ARRAY['Full Body','Legs','Core'])[1 + (i % 3)],
  'machine_type', (ARRAY['Treadmill','Elliptical','Stationary Bike','Rowing Machine'])[1 + (i % 4)],
  'max_weight_kg', (ARRAY[100,120,135,150])[1 + (i % 4)]
) FROM generate_series(0, 9) AS i;

-- ============================================================
-- 4. Verification
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

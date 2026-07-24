-- ============================================================
-- SchemaShift — Seed Data
-- Run AFTER schema.sql in the Supabase SQL Editor.
-- ============================================================

-- ── 1. "Vehicles" Template ──────────────────────────────────
INSERT INTO public.templates (id, name, description, fields)
VALUES (
  'a1b2c3d4-0001-4000-8000-000000000001',
  'Vehicles',
  'Template for cataloging vehicles with brand, model year, fuel type, and electric flag.',
  '[
    { "key": "brand",      "label": "Brand",        "type": "string",  "required": true,  "options": [] },
    { "key": "model",      "label": "Model",        "type": "string",  "required": true,  "options": [] },
    { "key": "modelYear",  "label": "Model Year",   "type": "number",  "required": true,  "options": [] },
    { "key": "isElectric", "label": "Is Electric",  "type": "boolean", "required": false, "options": [] },
    { "key": "fuelType",   "label": "Fuel Type",    "type": "select",  "required": true,  "options": ["Petrol", "Diesel", "Electric", "Hybrid"] }
  ]'::jsonb
);

-- ── 2. Hierarchical Categories ──────────────────────────────

-- Root: Vehicles
INSERT INTO public.categories (id, name, parent_id, template_id)
VALUES (
  'b1b2c3d4-0001-4000-8000-000000000001',
  'Vehicles',
  NULL,
  'a1b2c3d4-0001-4000-8000-000000000001'
);

-- Child: Cars (under Vehicles)
INSERT INTO public.categories (id, name, parent_id, template_id)
VALUES (
  'b1b2c3d4-0002-4000-8000-000000000002',
  'Cars',
  'b1b2c3d4-0001-4000-8000-000000000001',
  'a1b2c3d4-0001-4000-8000-000000000001'
);

-- Grandchild: Petrol (under Cars)
INSERT INTO public.categories (id, name, parent_id, template_id)
VALUES (
  'b1b2c3d4-0003-4000-8000-000000000003',
  'Petrol',
  'b1b2c3d4-0002-4000-8000-000000000002',
  'a1b2c3d4-0001-4000-8000-000000000001'
);

-- Grandchild: Electric (under Cars)
INSERT INTO public.categories (id, name, parent_id, template_id)
VALUES (
  'b1b2c3d4-0004-4000-8000-000000000004',
  'Electric',
  'b1b2c3d4-0002-4000-8000-000000000002',
  'a1b2c3d4-0001-4000-8000-000000000001'
);

-- ── 3. Sample Items ─────────────────────────────────────────

-- Item 1: Toyota Camry (Petrol category)
INSERT INTO public.items (category_id, data)
VALUES (
  'b1b2c3d4-0003-4000-8000-000000000003',
  '{
    "brand": "Toyota",
    "model": "Camry",
    "modelYear": 2024,
    "isElectric": false,
    "fuelType": "Petrol"
  }'::jsonb
);

-- Item 2: Tesla Model 3 (Electric category)
INSERT INTO public.items (category_id, data)
VALUES (
  'b1b2c3d4-0004-4000-8000-000000000004',
  '{
    "brand": "Tesla",
    "model": "Model 3",
    "modelYear": 2024,
    "isElectric": true,
    "fuelType": "Electric"
  }'::jsonb
);

-- ── NOTE ────────────────────────────────────────────────────
-- Profiles are auto-created by the `handle_new_user` trigger
-- when users sign up through Supabase Auth.
-- To manually create test profiles, first create users in
-- Supabase Auth, then update their roles:
--
--   UPDATE public.profiles SET role = 'TEMPLATE_ADMIN'
--   WHERE email = 'admin@example.com';
--
--   UPDATE public.profiles SET role = 'DATA_CONTRIBUTOR'
--   WHERE email = 'contributor@example.com';
-- ────────────────────────────────────────────────────────────

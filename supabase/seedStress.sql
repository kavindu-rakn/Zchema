-- ============================================================
-- Zchema — Stress dataset (Phase 7, Increment 5)
--
-- 50 categories, 6 levels deep, 5,000 items. The point is not volume
-- for its own sake — it is DEPTH and BREADTH together, because the
-- expensive things in this schema are the recursive walks:
-- get_effective_schema resolves one ancestor chain per category, and
-- get_category_tree calls it once per node.
--
-- ⚠️  DESTRUCTIVE. Truncates categories and items. Load into a
-- throwaway project, not the one holding your demo data.
--
-- Shape: 2 roots × (5 children × 5 grandchildren), then a deliberately
-- deep spine of 6 levels hanging off the first root, so the worst-case
-- ancestor walk is exercised rather than averaged away.
-- ============================================================

TRUNCATE public.items, public.schema_versions, public.categories CASCADE;

DO $$
DECLARE
  root_a   UUID;
  root_b   UUID;
  parent   UUID;
  child    UUID;
  grand    UUID;
  spine    UUID;
  i        INT;
  j        INT;
  k        INT;
  made     INT := 0;
BEGIN
  -- ── Two roots, each carrying real fields ─────────────────
  INSERT INTO public.categories (name, slug, parent_id, own_fields)
  VALUES ('Stress A', 'stress-a', NULL, '[
    {"key":"sa_brand","label":"Brand","type":"string","required":true,"position":0},
    {"key":"sa_price","label":"Price","type":"number","required":false,"position":1},
    {"key":"sa_state","label":"State","type":"select","required":false,"position":2,
     "options":["new","used","refurbished"]}
  ]'::jsonb) RETURNING id INTO root_a;

  INSERT INTO public.categories (name, slug, parent_id, own_fields)
  VALUES ('Stress B', 'stress-b', NULL, '[
    {"key":"sb_code","label":"Code","type":"string","required":false,"position":0},
    {"key":"sb_weight","label":"Weight","type":"number","required":false,"position":1,"unit":"kg"}
  ]'::jsonb) RETURNING id INTO root_b;

  -- ── 5 children × 5 grandchildren under each root ─────────
  FOREACH parent IN ARRAY ARRAY[root_a, root_b] LOOP
    FOR i IN 1..5 LOOP
      INSERT INTO public.categories (name, slug, parent_id, own_fields)
      VALUES (
        format('Branch %s-%s', left(parent::text, 4), i),
        format('branch-%s-%s', left(parent::text, 4), i),
        parent,
        jsonb_build_array(jsonb_build_object(
          'key', format('f_%s_%s', left(parent::text, 4), i),
          'label', format('Field %s', i),
          'type', 'string', 'required', false, 'position', 0
        ))
      ) RETURNING id INTO child;

      FOR j IN 1..5 LOOP
        INSERT INTO public.categories (name, slug, parent_id, own_fields)
        VALUES (
          format('Leaf %s-%s-%s', left(parent::text, 4), i, j),
          format('leaf-%s-%s-%s', left(parent::text, 4), i, j),
          child,
          jsonb_build_array(jsonb_build_object(
            'key', format('g_%s_%s_%s', left(parent::text, 4), i, j),
            'label', format('Leaf field %s', j),
            'type', 'number', 'required', false, 'position', 0
          ))
        ) RETURNING id INTO grand;

        -- ~90 items each; the deep spine below gets the rest.
        FOR k IN 1..90 LOOP
          INSERT INTO public.items (category_id, data) VALUES (grand, jsonb_build_object(
            CASE WHEN parent = root_a THEN 'sa_brand' ELSE 'sb_code' END,
              (ARRAY['Acme','Globex','Initech','Umbrella','Soylent'])[1 + (k % 5)],
            CASE WHEN parent = root_a THEN 'sa_price' ELSE 'sb_weight' END,
              10 + (k * 7) % 990,
            format('g_%s_%s_%s', left(parent::text, 4), i, j), k
          ));
          made := made + 1;
        END LOOP;
      END LOOP;
    END LOOP;
  END LOOP;

  -- ── A 6-level spine, so the worst-case ancestor walk is real ──
  -- Averages hide this: 48 shallow categories and 2 deep ones is a very
  -- different profile from 50 shallow ones, and it is the deep chain
  -- that get_effective_schema has to fold.
  spine := root_a;
  FOR i IN 1..5 LOOP
    INSERT INTO public.categories (name, slug, parent_id, own_fields)
    VALUES (
      format('Deep level %s', i),
      format('deep-level-%s', i),
      spine,
      jsonb_build_array(jsonb_build_object(
        'key', format('d_level_%s', i), 'label', format('Depth %s', i),
        'type', 'string', 'required', false, 'position', 0
      ))
    ) RETURNING id INTO spine;

    FOR k IN 1..50 LOOP
      INSERT INTO public.items (category_id, data) VALUES (spine, jsonb_build_object(
        'sa_brand', (ARRAY['Acme','Globex','Initech'])[1 + (k % 3)],
        'sa_price', 100 + k,
        'sa_state', (ARRAY['new','used','refurbished'])[1 + (k % 3)],
        format('d_level_%s', i), format('value-%s', k)
      ));
      made := made + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Stress dataset: % categories, % items',
    (SELECT count(*) FROM public.categories), made;
END $$;

-- Statistics matter more than row counts for the plans you are about to
-- read: a stale ANALYZE makes the planner choose badly and makes the
-- EXPLAIN output a lie about production.
ANALYZE public.categories;
ANALYZE public.items;

SELECT
  (SELECT count(*) FROM public.categories) AS categories,
  (SELECT count(*) FROM public.items)      AS items,
  (SELECT max(depth) + 1
     FROM public.categories c
     CROSS JOIN LATERAL public.get_category_ancestors(c.id) a
    WHERE a.depth = (SELECT max(a2.depth)
                     FROM public.get_category_ancestors(c.id) a2)) AS max_depth;

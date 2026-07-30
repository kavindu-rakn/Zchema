-- ============================================================
-- SchemaShift — Attribute registry (Phase 6, Increment 1)
--
-- Run AFTER attributes.sql is applied. Assertions 1-13 use a sandbox
-- tree for exact counts and tear it down; assertion 14 checks the real
-- seed, because "finds the seeded brand triplication" is the actual
-- promise the duplicate detector makes.
--
-- Expected: 14 rows, all PASS.
-- ============================================================

DROP TABLE IF EXISTS _attr_results;
CREATE TEMP TABLE _attr_results (n int PRIMARY KEY, assertion text, passed boolean, detail text);

DO $$
DECLARE
  ca UUID := 'dd000000-0000-0000-0000-00000000a001';
  cb UUID := 'dd000000-0000-0000-0000-00000000a002';
  cc UUID := 'dd000000-0000-0000-0000-00000000a003';
  cd UUID := 'dd000000-0000-0000-0000-00000000a004';

  res      JSONB;
  dup      JSONB;
  attr_id  UUID;
  sys_id   UUID;
  ok       BOOLEAN;
  msg      TEXT;
BEGIN
  -- ── Sandbox ───────────────────────────────────────────────
  DELETE FROM public.categories
   WHERE id IN (ca, cb, cc, cd)
      OR (parent_id IS NULL AND slug LIKE 'zz-attr-%');
  DELETE FROM public.attributes WHERE key IN ('zz_brand','zz_size','zz_sys');

  -- zz_brand: three roots, all `string`   → clean promotion candidate
  -- zz_size : number on A, string on D    → types disagree
  INSERT INTO public.categories (id, name, slug, parent_id, own_fields) VALUES
  (ca, 'ZZ Attr A', 'zz-attr-a', NULL, '[
     {"key":"zz_brand","label":"Brand","type":"string","required":true,"position":0,
      "help_text":"Who makes it","unit":null},
     {"key":"zz_size","label":"Size","type":"number","required":false,"position":1}
   ]'::jsonb),
  (cb, 'ZZ Attr B', 'zz-attr-b', NULL, '[
     {"key":"zz_brand","label":"Marque","type":"string","required":false,"position":0},
     {"key":"zz_other","label":"Other","type":"string","required":false,"position":1}
   ]'::jsonb),
  (cc, 'ZZ Attr C', 'zz-attr-c', NULL, '[
     {"key":"zz_brand","label":"Make","type":"string","required":false,"position":0}
   ]'::jsonb),
  (cd, 'ZZ Attr D', 'zz-attr-d', NULL, '[
     {"key":"zz_size","label":"Size Text","type":"string","required":false,"position":0}
   ]'::jsonb);

  INSERT INTO public.items (category_id, data) VALUES
  (ca, '{"zz_brand":"Acme","zz_size":10}'::jsonb),
  (ca, '{"zz_brand":"Beta","zz_size":20}'::jsonb),
  (cb, '{"zz_brand":"Gamma"}'::jsonb),
  (cc, '{"zz_brand":"Delta"}'::jsonb);

  -- ── 1. Duplicate detection finds the triplication ─────────
  SELECT d INTO dup
  FROM jsonb_array_elements(public.find_duplicate_field_definitions()) d
  WHERE d->>'key' = 'zz_brand';

  INSERT INTO _attr_results VALUES (1,
    'find_duplicate_field_definitions: "zz_brand" on 3 categories, types agree',
    (dup->>'category_count')::int = 3
      AND (dup->>'types_agree')::boolean = true
      AND dup->>'type' = 'string'
      AND (dup->>'item_count')::int = 4,
    format('categories=%s agree=%s type=%s items=%s',
      dup->>'category_count', dup->>'types_agree', dup->>'type', dup->>'item_count'));

  -- ── 2. Disagreeing types are reported, not hidden ─────────
  SELECT d INTO dup
  FROM jsonb_array_elements(public.find_duplicate_field_definitions()) d
  WHERE d->>'key' = 'zz_size';

  INSERT INTO _attr_results VALUES (2,
    '"zz_size" is flagged types_agree = false, listing both number and string',
    (dup->>'types_agree')::boolean = false
      AND dup->'types' @> '["number"]'::jsonb
      AND dup->'types' @> '["string"]'::jsonb,
    format('agree=%s types=%s', dup->>'types_agree', (dup->'types')::text));

  -- ── 3. Promotion links every matching definition ──────────
  res := public.promote_field_to_attribute(ca, 'zz_brand', 'Commercial');
  attr_id := (res->>'attribute_id')::uuid;

  INSERT INTO _attr_results VALUES (3,
    'promote_field_to_attribute: all 3 definitions linked, none skipped',
    (res->>'linked')::int = 3
      AND jsonb_array_length(res->'skipped') = 0
      AND res->>'type' = 'string',
    format('linked=%s skipped=%s', res->>'linked', (res->'skipped')::text));

  INSERT INTO _attr_results VALUES (4,
    'The new attribute inherited the source field''s label, help text and group',
    (SELECT label = 'Brand' AND description = 'Who makes it' AND group_name = 'Commercial'
       FROM public.attributes WHERE id = attr_id),
    (SELECT format('label=%s desc=%s group=%s', label, description, group_name)
       FROM public.attributes WHERE id = attr_id));

  -- ── 5. Usage tracking sees all three ──────────────────────
  res := public.get_attribute_usage(attr_id);
  INSERT INTO _attr_results VALUES (5,
    'get_attribute_usage: 3 categories, with the item counts attached',
    jsonb_array_length(res) = 3
      AND (SELECT sum((u->>'item_count')::int)
             FROM jsonb_array_elements(res) u) = 4,
    format('categories=%s items=%s', jsonb_array_length(res),
      (SELECT sum((u->>'item_count')::int) FROM jsonb_array_elements(res) u)));

  -- ── 6. A promoted key stops being a duplicate candidate ───
  INSERT INTO _attr_results VALUES (6,
    'Once promoted, "zz_brand" is no longer offered for promotion',
    NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(public.find_duplicate_field_definitions()) d
       WHERE d->>'key' = 'zz_brand'),
    (SELECT COALESCE(string_agg(d->>'key', ', '), '(none)')
       FROM jsonb_array_elements(public.find_duplicate_field_definitions()) d));

  -- ── 7. Type mismatches are SKIPPED, never coerced ─────────
  res := public.promote_field_to_attribute(ca, 'zz_size', 'Physical');
  INSERT INTO _attr_results VALUES (7,
    'Promoting "zz_size" links only the number definition and REPORTS the string one',
    (res->>'linked')::int = 1
      AND jsonb_array_length(res->'skipped') = 1
      AND res->'skipped'->0->>'type' = 'string',
    format('linked=%s skipped=%s', res->>'linked', (res->'skipped')::text));

  INSERT INTO _attr_results VALUES (8,
    'The skipped category''s field was left exactly as it was — no coercion, no link',
    (SELECT (f.elem->>'type' = 'string' AND NOT (f.elem ? 'attribute_id'))
       FROM public.categories c
       CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
      WHERE c.id = cd AND f.elem->>'key' = 'zz_size'),
    (SELECT (f.elem)::text FROM public.categories c
      CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
     WHERE c.id = cd AND f.elem->>'key' = 'zz_size'));

  -- ── 9. Promoting an existing key is refused ───────────────
  BEGIN
    PERFORM public.promote_field_to_attribute(cb, 'zz_brand', NULL);
    ok := false; msg := '(no exception raised)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;
  INSERT INTO _attr_results VALUES (9,
    'Promoting a key that is already an attribute is REFUSED', ok, msg);

  -- ── 10. Label edits PROPAGATE ─────────────────────────────
  UPDATE public.attributes SET label = 'Manufacturer' WHERE id = attr_id;

  INSERT INTO _attr_results VALUES (10,
    'Editing the attribute label propagated to all 3 linked fields',
    (SELECT count(*)::int
       FROM public.categories c
       CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
      WHERE f.elem->>'attribute_id' = attr_id::text
        AND f.elem->>'label' = 'Manufacturer') = 3,
    (SELECT string_agg(c.name || '=' || (f.elem->>'label'), ', ')
       FROM public.categories c
       CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
      WHERE f.elem->>'attribute_id' = attr_id::text));

  -- ── 11. Type edits are REFUSED ────────────────────────────
  BEGIN
    UPDATE public.attributes SET type = 'number' WHERE id = attr_id;
    ok := false; msg := '(no exception raised)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;
  INSERT INTO _attr_results VALUES (11,
    'Changing an attribute TYPE globally is REFUSED, naming the per-category route', ok, msg);

  -- ── 12. Key edits are REFUSED ─────────────────────────────
  BEGIN
    UPDATE public.attributes SET key = 'zz_brand_renamed' WHERE id = attr_id;
    ok := false; msg := '(no exception raised)';
  EXCEPTION WHEN others THEN
    ok := true; msg := SQLERRM;
  END;
  INSERT INTO _attr_results VALUES (12,
    'Changing an attribute KEY is REFUSED — item data is stored against it', ok, msg);

  -- ── 13. Deleting unlinks, it does not destroy fields ──────
  DELETE FROM public.attributes WHERE id = attr_id;

  INSERT INTO _attr_results VALUES (13,
    'Deleting an attribute strips the link but leaves all 3 fields standing',
    (SELECT count(*)::int
       FROM public.categories c
       CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
      WHERE f.elem->>'key' = 'zz_brand') = 3
    AND NOT EXISTS (
      SELECT 1 FROM public.categories c
      CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
      WHERE f.elem->>'attribute_id' = attr_id::text),
    format('fields_remaining=%s',
      (SELECT count(*) FROM public.categories c
        CROSS JOIN LATERAL jsonb_array_elements(c.own_fields) AS f(elem)
       WHERE f.elem->>'key' = 'zz_brand')));

  -- ── Tear down the sandbox ─────────────────────────────────
  DELETE FROM public.categories WHERE id IN (ca, cb, cc, cd);
  DELETE FROM public.attributes WHERE key IN ('zz_brand','zz_size');
END $$;

-- ============================================================
-- 14. The real seed — the case the DoD names
-- ------------------------------------------------------------
-- `brand` is authored independently on Electronics, Clothing and
-- Home & Kitchen, all as `string`. If the detector cannot see that, the
-- feature has nothing to offer on real data.
-- ============================================================
-- Written with scalar subqueries so the assertion still reports a row
-- when `brand` is absent, rather than silently vanishing from the
-- output — a test that disappears when it fails is not a test.
INSERT INTO _attr_results
WITH found AS (
  SELECT d AS entry
  FROM jsonb_array_elements(public.find_duplicate_field_definitions()) d
  WHERE d->>'key' = 'brand'
)
SELECT 14,
       'Seed data: "brand" is detected on 3+ categories with agreeing types',
       COALESCE((SELECT (entry->>'category_count')::int >= 3
                        AND (entry->>'types_agree')::boolean
                   FROM found), false),
       COALESCE(
         (SELECT format('categories=%s agree=%s names=%s',
                   entry->>'category_count', entry->>'types_agree',
                   (SELECT string_agg(c->>'name', ', ')
                      FROM jsonb_array_elements(entry->'categories') c))
            FROM found),
         '(brand not found — is seedAmazon.sql loaded?)');

-- ── FINAL RESULT ────────────────────────────────────────────
SELECT n,
       CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,
       assertion,
       detail
FROM _attr_results
ORDER BY n;

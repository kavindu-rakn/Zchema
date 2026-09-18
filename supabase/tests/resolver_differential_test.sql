-- ============================================================
-- Resolver differential test — GENERATED, do not edit by hand
-- ------------------------------------------------------------
-- Rendered from supabase/tests/fixtures/resolver-cases.json by
-- `npm run gen:resolver-sql`. Edit the fixture and regenerate;
-- supabase/tests/resolver-sql.test.ts fails while this file is stale.
--
-- Runs every shared resolver case against get_effective_schema() and
-- resolve_schema_preview() and checks each result against the
-- fixture — the same cases src/lib/schema.test.ts runs against
-- resolveEffectiveSchema(). Only the listed properties are checked; a
-- null in the fixture means the property must be absent.
--
-- Run in the Supabase SQL editor. It ends in a PASS/FAIL result set
-- and leaves nothing behind.
--
-- Several cases are chains the write trigger rejects (empty keys,
-- non-object patches, non-numeric positions) — a resolver must still
-- never throw — so the sandbox disables categories_validate_fields for
-- its duration. That holds a brief exclusive lock on categories. The
-- change is transactional: it is undone even if the script fails.
-- ============================================================
DROP TABLE IF EXISTS _p_test_results;
CREATE TEMP TABLE _p_test_results (n int PRIMARY KEY, assertion text, status text, detail text);

DO $test$
DECLARE
  cases CONSTANT jsonb := $fixture$
[
  {"name":"folds own fields down a three-level chain","chain":[{"id":"a0000000-0000-4000-8000-000000000100","name":"ZZ resolver 01 root","own_fields":[{"key":"brand","label":"Brand","type":"string","position":0},{"key":"warranty","label":"Warranty","type":"number","position":1}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000101","name":"ZZ resolver 01 middle","own_fields":[{"key":"screen","label":"Screen","type":"number","position":0}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000102","name":"ZZ resolver 01 target","own_fields":[{"key":"refresh","label":"Refresh","type":"number","position":0}],"overrides":{}}],"expected":[{"key":"brand","depth":2,"inherited":true,"source_category_id":"a0000000-0000-4000-8000-000000000100","source_category_name":"ZZ resolver 01 root","overridden_by":[]},{"key":"warranty","depth":2,"inherited":true,"source_category_id":"a0000000-0000-4000-8000-000000000100","overridden_by":[]},{"key":"screen","depth":1,"inherited":true,"source_category_id":"a0000000-0000-4000-8000-000000000101","overridden_by":[]},{"key":"refresh","depth":0,"inherited":false,"source_category_id":"a0000000-0000-4000-8000-000000000102","overridden_by":[]}]},
  {"name":"applies only the patchable properties of an override","chain":[{"id":"a0000000-0000-4000-8000-000000000200","name":"ZZ resolver 02 root","own_fields":[{"key":"brand","label":"Brand","type":"string","required":false,"position":0}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000201","name":"ZZ resolver 02 target","own_fields":[],"overrides":{"brand":{"label":"Maker","required":true,"type":"number","key":"hijack","unknown":1}}}],"expected":[{"key":"brand","label":"Maker","required":true,"type":"string","unknown":null,"depth":1,"inherited":true,"source_category_id":"a0000000-0000-4000-8000-000000000200","overridden_by":["a0000000-0000-4000-8000-000000000201"]}]},
  {"name":"records every ancestor that patches a field, in chain order","chain":[{"id":"a0000000-0000-4000-8000-000000000300","name":"ZZ resolver 03 root","own_fields":[{"key":"size","label":"Size","type":"string","required":false,"position":0}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000301","name":"ZZ resolver 03 middle","own_fields":[],"overrides":{"size":{"label":"Size (cm)"}}},{"id":"a0000000-0000-4000-8000-000000000302","name":"ZZ resolver 03 target","own_fields":[],"overrides":{"size":{"required":true}}}],"expected":[{"key":"size","label":"Size (cm)","required":true,"depth":2,"overridden_by":["a0000000-0000-4000-8000-000000000301","a0000000-0000-4000-8000-000000000302"]}]},
  {"name":"keeps the first definition of a duplicated key","chain":[{"id":"a0000000-0000-4000-8000-000000000400","name":"ZZ resolver 04 root","own_fields":[{"key":"color","label":"Colour","type":"string","position":0}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000401","name":"ZZ resolver 04 target","own_fields":[{"key":"color","label":"Color again","type":"number","position":0},{"key":"fit","label":"Fit","type":"string","position":0}],"overrides":{}}],"expected":[{"key":"color","label":"Colour","type":"string","depth":1,"source_category_id":"a0000000-0000-4000-8000-000000000400"},{"key":"fit","depth":0,"inherited":false,"source_category_id":"a0000000-0000-4000-8000-000000000401"}]},
  {"name":"drops fields whose key is missing, empty or not a string","chain":[{"id":"a0000000-0000-4000-8000-000000000500","name":"ZZ resolver 05 target","own_fields":[{"key":"","label":"Empty key","position":0},{"label":"No key","position":0},{"key":7,"label":"Numeric key","position":0},{"key":"ok","label":"OK","position":0}],"overrides":{}}],"expected":[{"key":"ok","depth":0,"inherited":false}]},
  {"name":"skips an override that is not an object","chain":[{"id":"a0000000-0000-4000-8000-000000000600","name":"ZZ resolver 06 root","own_fields":[{"key":"a","label":"A","position":0},{"key":"b","label":"B","position":1},{"key":"c","label":"C","position":2}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000601","name":"ZZ resolver 06 target","own_fields":[],"overrides":{"a":["not","a","patch"],"b":"not a patch","c":{"label":"C!"}}}],"expected":[{"key":"a","label":"A","overridden_by":[]},{"key":"b","label":"B","overridden_by":[]},{"key":"c","label":"C!","overridden_by":["a0000000-0000-4000-8000-000000000601"]}]},
  {"name":"orders by position, reading numeric strings and treating anything else as 0","chain":[{"id":"a0000000-0000-4000-8000-000000000700","name":"ZZ resolver 07 target","own_fields":[{"key":"p2","label":"P two","position":2},{"key":"p1s","label":"P one string","position":"1"},{"key":"pbad","label":"Bad position","position":"first"},{"key":"pnone","label":"No position"},{"key":"pneg","label":"Negative","position":-1},{"key":"pdec","label":"Decimal","position":0.5}],"overrides":{}}],"expected":[{"key":"pneg"},{"key":"pbad","position":"first"},{"key":"pnone","position":null},{"key":"pdec"},{"key":"p1s","position":"1"},{"key":"p2"}]},
  {"name":"breaks ties by label, then key, comparing by code point","chain":[{"id":"a0000000-0000-4000-8000-000000000800","name":"ZZ resolver 08 target","own_fields":[{"key":"k_apple","label":"apple","position":0},{"key":"k_banana_upper","label":"Banana","position":0},{"key":"k_banana_lower","label":"banana","position":0},{"key":"k_nolabel","position":0},{"key":"k_same_b","label":"Same","position":0},{"key":"k_same_a","label":"Same","position":0}],"overrides":{}}],"expected":[{"key":"k_nolabel"},{"key":"k_banana_upper"},{"key":"k_same_a"},{"key":"k_same_b"},{"key":"k_apple"},{"key":"k_banana_lower"}]},
  {"name":"ignores an override for a key it does not have","chain":[{"id":"a0000000-0000-4000-8000-000000000900","name":"ZZ resolver 09 root","own_fields":[{"key":"a","label":"A","position":0}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000000901","name":"ZZ resolver 09 target","own_fields":[],"overrides":{"ghost":{"label":"Boo"}}}],"expected":[{"key":"a","label":"A","depth":1,"overridden_by":[]}]},
  {"name":"applies a category's override to its own field","chain":[{"id":"a0000000-0000-4000-8000-000000001000","name":"ZZ resolver 10 target","own_fields":[{"key":"x","label":"X","position":0}],"overrides":{"x":{"label":"X!"}}}],"expected":[{"key":"x","label":"X!","depth":0,"inherited":false,"overridden_by":["a0000000-0000-4000-8000-000000001000"]}]},
  {"name":"ignores own_fields that are not an array and overrides that are not an object","chain":[{"id":"a0000000-0000-4000-8000-000000001100","name":"ZZ resolver 11 root","own_fields":{"not":"an array"},"overrides":["not","an object"]},{"id":"a0000000-0000-4000-8000-000000001101","name":"ZZ resolver 11 target","own_fields":[{"key":"z","label":"Z","position":0}],"overrides":{}}],"expected":[{"key":"z","depth":0,"source_category_id":"a0000000-0000-4000-8000-000000001101"}]},
  {"name":"an override replaces options wholesale","chain":[{"id":"a0000000-0000-4000-8000-000000001200","name":"ZZ resolver 12 root","own_fields":[{"key":"size","label":"Size","type":"select","options":["S","M","L"],"position":0}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000001201","name":"ZZ resolver 12 target","own_fields":[],"overrides":{"size":{"options":["S","M"]}}}],"expected":[{"key":"size","options":["S","M"],"overridden_by":["a0000000-0000-4000-8000-000000001201"]}]},
  {"name":"re-sorts after an override moves a field","chain":[{"id":"a0000000-0000-4000-8000-000000001300","name":"ZZ resolver 13 root","own_fields":[{"key":"a","label":"A","position":0},{"key":"b","label":"B","position":1}],"overrides":{}},{"id":"a0000000-0000-4000-8000-000000001301","name":"ZZ resolver 13 target","own_fields":[],"overrides":{"a":{"position":5}}}],"expected":[{"key":"b","position":1,"overridden_by":[]},{"key":"a","position":5,"overridden_by":["a0000000-0000-4000-8000-000000001301"]}]}
]
$fixture$::jsonb;
  c        jsonb;
  node     jsonb;
  parent   uuid;
  target   uuid;
  n        int := 0;
  fn       text;
  got      jsonb;
  expected jsonb;
  problem  text;
  i        int;
  prop     text;
  want     jsonb;
BEGIN
  ALTER TABLE public.categories DISABLE TRIGGER categories_validate_fields;

  FOR c IN SELECT value FROM jsonb_array_elements(cases) LOOP
    parent := NULL;
    FOR node IN SELECT value FROM jsonb_array_elements(c->'chain') LOOP
      INSERT INTO public.categories (id, name, slug, parent_id, own_fields, overrides)
      VALUES ((node->>'id')::uuid, node->>'name', 'zz-resolver-' || (node->>'id'), parent,
              node->'own_fields', node->'overrides');
      parent := (node->>'id')::uuid;
    END LOOP;
    target := parent;
    expected := c->'expected';

    FOREACH fn IN ARRAY ARRAY['get_effective_schema', 'resolve_schema_preview'] LOOP
      n := n + 1;
      problem := NULL;
      BEGIN
        got := CASE fn
          WHEN 'get_effective_schema' THEN public.get_effective_schema(target)
          ELSE public.resolve_schema_preview(target, NULL, NULL)
        END;

        IF jsonb_array_length(got) <> jsonb_array_length(expected) THEN
          problem := format('expected %s fields, got %s: %s',
            jsonb_array_length(expected), jsonb_array_length(got),
            (SELECT string_agg(e->>'key', ', ') FROM jsonb_array_elements(got) e));
        ELSE
          FOR i IN 0 .. jsonb_array_length(expected) - 1 LOOP
            FOR prop, want IN SELECT key, value FROM jsonb_each(expected->i) LOOP
              IF jsonb_typeof(want) = 'null' THEN
                IF (got->i) ? prop THEN
                  problem := format('#%s %s: %s should be absent', i, got->i->>'key', prop);
                END IF;
              ELSIF (got->i->prop) IS DISTINCT FROM want THEN
                problem := format('#%s: expected %s = %s, got %s', i,
                  prop, want, COALESCE((got->i->prop)::text, 'absent'));
              END IF;
              EXIT WHEN problem IS NOT NULL;
            END LOOP;
            EXIT WHEN problem IS NOT NULL;
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        problem := 'raised: ' || SQLERRM;
      END;

      INSERT INTO _p_test_results VALUES (
        n, fn || ': ' || (c->>'name'),
        CASE WHEN problem IS NULL THEN 'PASS' ELSE 'FAIL' END,
        COALESCE(problem, 'matches the fixture'));
    END LOOP;

    DELETE FROM public.categories WHERE id = (c->'chain'->0->>'id')::uuid;
  END LOOP;

  ALTER TABLE public.categories ENABLE TRIGGER categories_validate_fields;
END
$test$;

SELECT n, status AS result, assertion, detail
FROM _p_test_results
ORDER BY n;

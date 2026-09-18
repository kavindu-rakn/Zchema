// ── SQL resolver test, rendered from the shared fixture ──────
// The Supabase SQL editor cannot read a file, so the SQL half of the
// resolver differential test carries the fixture inline. It is rendered
// from supabase/tests/fixtures/resolver-cases.json by this module:
//   npm run gen:resolver-sql        — rewrites the .sql file
//   resolver-sql.test.ts            — fails if the .sql file is stale

import { readFileSync } from "node:fs";

export const FIXTURE_URL = new URL("./fixtures/resolver-cases.json", import.meta.url);
export const OUTPUT_URL = new URL("./resolver_differential_test.sql", import.meta.url);

export function renderResolverSqlTest(): string {
  const { cases } = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as { cases: unknown[] };
  // One case per line: compact, and a diff still points at the case.
  const fixture = `[\n${cases.map((testCase) => `  ${JSON.stringify(testCase)}`).join(",\n")}\n]`;
  if (fixture.includes("$fixture$")) throw new Error("fixture text collides with its quote tag");

  return `-- ============================================================
-- Resolver differential test — GENERATED, do not edit by hand
-- ------------------------------------------------------------
-- Rendered from supabase/tests/fixtures/resolver-cases.json by
-- \`npm run gen:resolver-sql\`. Edit the fixture and regenerate;
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
${fixture}
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
`;
}

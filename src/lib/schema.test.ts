// ── Effective-schema resolver tests ──────────────────────────
// Run with:  npm test
//
// The resolver exists three times: resolveEffectiveSchema() here, which
// drives the editor's live preview, and get_effective_schema() plus
// resolve_schema_preview() in SQL, which drive the saved schema and the
// impact dialog. If they disagree, the UI promises one thing and the
// database does another. So all three run the same cases, from
// supabase/tests/fixtures/resolver-cases.json — this file for TypeScript,
// supabase/tests/resolver_differential_test.sql for SQL.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveEffectiveSchema } from "./schema.ts";
import type { Category } from "./types.ts";

interface ResolverCase {
  name: string;
  chain: Pick<Category, "id" | "name" | "own_fields" | "overrides">[];
  expected: Record<string, unknown>[];
}

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r/g, "");

const { cases } = JSON.parse(read("supabase/tests/fixtures/resolver-cases.json")) as {
  cases: ResolverCase[];
};

describe("resolveEffectiveSchema — shared resolver cases", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = resolveEffectiveSchema(testCase.chain) as unknown as Record<string, unknown>[];

      assert.deepEqual(
        result.map((field) => field.key),
        testCase.expected.map((field) => field.key),
        "fields, in order"
      );

      // Only the listed properties are checked; null means "must be absent".
      testCase.expected.forEach((expected, index) => {
        const field = result[index];
        for (const [prop, value] of Object.entries(expected)) {
          if (value === null) {
            assert.ok(!(prop in field), `${field.key}.${prop} should be absent`);
          } else {
            assert.deepEqual(field[prop], value, `${field.key}.${prop}`);
          }
        }
      });
    });
  }

  it("covers the cases that used to diverge between implementations", () => {
    const names = cases.map((testCase) => testCase.name).join("\n");
    for (const needle of ["not a string", "not an object", "numeric strings", "code point"]) {
      assert.match(names, new RegExp(needle), `no case mentions "${needle}"`);
    }
  });
});

describe("the three resolvers document the same algorithm", () => {
  /** The comment from "Algorithm:" to step 5, with comment markers stripped. */
  function algorithm(path: string, anchor: string): string {
    const text = read(path);
    const at = text.indexOf(anchor);
    assert.notEqual(at, -1, `${anchor} not found in ${path}`);
    const start = text.lastIndexOf("Algorithm:", at);
    const stepFive = text.indexOf("5. Return", start);
    assert.ok(start !== -1 && stepFive !== -1 && stepFive < at, `no algorithm comment above ${anchor}`);
    return text
      .slice(start, text.indexOf("\n", stepFive))
      .split("\n")
      .map((line) => line.replace(/^\s*(--|\*)?\s*/, "").trim())
      .join("\n");
  }

  const typescript = algorithm("src/lib/schema.ts", "export function resolveEffectiveSchema");
  const sql = algorithm("supabase/functions.sql", "FUNCTION public.get_effective_schema(");
  const preview = algorithm("supabase/impact.sql", "FUNCTION public.resolve_schema_preview(");

  it("get_effective_schema() matches resolveEffectiveSchema()", () => {
    assert.equal(sql, typescript);
  });

  it("resolve_schema_preview() matches resolveEffectiveSchema()", () => {
    assert.equal(preview, typescript);
  });
});

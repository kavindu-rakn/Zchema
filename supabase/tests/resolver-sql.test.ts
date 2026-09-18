// ── The generated SQL resolver test is up to date ────────────
// Run with:  npm test
//
// resolver_differential_test.sql carries the shared fixture inline,
// because the SQL editor cannot read files. If the fixture changes and
// nobody regenerates, the SQL side quietly tests yesterday's cases.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { OUTPUT_URL, renderResolverSqlTest } from "./resolver-sql.ts";

describe("resolver_differential_test.sql", () => {
  it("matches the fixture — run `npm run gen:resolver-sql` if not", () => {
    const committed = readFileSync(OUTPUT_URL, "utf8").replace(/\r/g, "");
    assert.equal(committed, renderResolverSqlTest());
  });
});

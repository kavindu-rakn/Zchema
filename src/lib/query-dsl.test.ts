// ── Query DSL unit tests ─────────────────────────────────────
// Run with:  npm test
//
// No test framework: Node 24 runs TypeScript directly and ships
// node:test, so this costs the project zero dependencies.
//
// The parser is the piece of Phase 6 most likely to be subtly wrong —
// it is pure string handling with a dozen shapes and a governing rule
// (never throw, fall back to free text) that is easy to violate by
// accident. Every DSL form gets a case, and so does every malformed
// input I could think of.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseQuery, serializeQuery, tokenize } from "./query-dsl.ts";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    assert.deepEqual(tokenize("sony wireless"), ["sony", "wireless"]);
  });

  it("keeps quoted runs together", () => {
    assert.deepEqual(tokenize('brand:"Herman Miller" cheap'), [
      'brand:"Herman Miller"',
      "cheap",
    ]);
  });

  it("collapses runs of whitespace", () => {
    assert.deepEqual(tokenize("  a   b  "), ["a", "b"]);
  });

  it("does not lose text after an unterminated quote", () => {
    assert.deepEqual(tokenize('brand:"Herman Miller'), ['brand:"Herman Miller']);
  });

  it("keeps a parenthesised set together despite its spaces", () => {
    assert.deepEqual(tokenize("size:in(S, M, L) cheap"), ["size:in(S, M, L)", "cheap"]);
  });

  it("does not lose text after an unterminated paren", () => {
    assert.deepEqual(tokenize("size:in(S, M"), ["size:in(S, M"]);
  });

  it("returns nothing for an empty string", () => {
    assert.deepEqual(tokenize(""), []);
  });
});

describe("parseQuery — free text", () => {
  it("passes bare words through", () => {
    const result = parseQuery("sony wireless");
    assert.equal(result.text, "sony wireless");
    assert.deepEqual(result.filters, []);
    assert.equal(result.scope, null);
    assert.deepEqual(result.errors, []);
  });

  it("preserves quotes so the server can treat them as a phrase", () => {
    assert.equal(parseQuery('"wireless mouse"').text, '"wireless mouse"');
  });

  it("handles an empty input", () => {
    assert.deepEqual(parseQuery(""), { text: "", filters: [], scope: null, errors: [] });
  });
});

describe("parseQuery — equality", () => {
  it("parses key:value", () => {
    assert.deepEqual(parseQuery("brand:Sony").filters, [
      { key: "brand", op: "eq", value: "Sony" },
    ]);
  });

  it("unquotes a quoted value", () => {
    assert.deepEqual(parseQuery('brand:"Herman Miller"').filters, [
      { key: "brand", op: "eq", value: "Herman Miller" },
    ]);
  });

  it("treats a boolean as ordinary equality", () => {
    assert.deepEqual(parseQuery("has_5g:true").filters, [
      { key: "has_5g", op: "eq", value: "true" },
    ]);
  });
});

describe("parseQuery — comparison and range", () => {
  it("parses each comparison operator", () => {
    assert.deepEqual(parseQuery("price:>500").filters, [
      { key: "price", op: "gt", value: "500" },
    ]);
    assert.deepEqual(parseQuery("price:>=500").filters, [
      { key: "price", op: "gte", value: "500" },
    ]);
    assert.deepEqual(parseQuery("price:<500").filters, [
      { key: "price", op: "lt", value: "500" },
    ]);
    assert.deepEqual(parseQuery("price:<=500").filters, [
      { key: "price", op: "lte", value: "500" },
    ]);
  });

  it("accepts negative and decimal operands", () => {
    assert.deepEqual(parseQuery("temp:<-5.5").filters, [
      { key: "temp", op: "lt", value: "-5.5" },
    ]);
  });

  it("expands a range into two ANDed filters", () => {
    assert.deepEqual(parseQuery("price:500..1200").filters, [
      { key: "price", op: "gte", value: "500" },
      { key: "price", op: "lte", value: "1200" },
    ]);
  });

  it("tolerates a reversed range rather than returning nothing", () => {
    assert.deepEqual(parseQuery("price:1200..500").filters, [
      { key: "price", op: "gte", value: "500" },
      { key: "price", op: "lte", value: "1200" },
    ]);
  });

  it("falls back to free text when the operand is not a number", () => {
    const result = parseQuery("price:>cheap");
    assert.deepEqual(result.filters, []);
    assert.equal(result.text, "price:>cheap");
    assert.equal(result.errors.length, 1);
  });
});

describe("parseQuery — set membership", () => {
  it("parses in(...)", () => {
    assert.deepEqual(parseQuery("size:in(S,M,L)").filters, [
      { key: "size", op: "in", value: "S,M,L" },
    ]);
  });

  it("trims members and drops empties, spaces and all", () => {
    assert.deepEqual(parseQuery("size:in( S , M ,)").filters, [
      { key: "size", op: "in", value: "S,M" },
    ]);
  });

  it("survives the way people actually type a list", () => {
    assert.deepEqual(parseQuery("size:in(S, M, L)").filters, [
      { key: "size", op: "in", value: "S,M,L" },
    ]);
  });

  it("falls back to free text when the set is empty", () => {
    const result = parseQuery("size:in()");
    assert.deepEqual(result.filters, []);
    assert.equal(result.errors.length, 1);
  });
});

describe("parseQuery — wildcards", () => {
  it("maps *foo* to contains", () => {
    assert.deepEqual(parseQuery("brand:*son*").filters, [
      { key: "brand", op: "contains", value: "son" },
    ]);
  });

  it("maps foo* to starts_with", () => {
    assert.deepEqual(parseQuery("brand:So*").filters, [
      { key: "brand", op: "starts_with", value: "So" },
    ]);
  });
});

describe("parseQuery — presence", () => {
  it("parses missing:", () => {
    assert.deepEqual(parseQuery("missing:warranty_months").filters, [
      { key: "warranty_months", op: "is_null" },
    ]);
  });

  it("parses has:", () => {
    assert.deepEqual(parseQuery("has:warranty_months").filters, [
      { key: "warranty_months", op: "not_null" },
    ]);
  });

  it("rejects a non-key argument and falls back to free text", () => {
    const result = parseQuery("missing:Not A Key");
    assert.deepEqual(result.filters, []);
    assert.equal(result.errors.length, 1);
  });
});

describe("parseQuery — negation", () => {
  it("inverts equality", () => {
    assert.deepEqual(parseQuery("-discontinued:true").filters, [
      { key: "discontinued", op: "neq", value: "true" },
    ]);
  });

  it("inverts missing: into has:", () => {
    assert.deepEqual(parseQuery("-missing:warranty_months").filters, [
      { key: "warranty_months", op: "not_null" },
    ]);
  });

  it("inverts has: into missing:", () => {
    assert.deepEqual(parseQuery("-has:warranty_months").filters, [
      { key: "warranty_months", op: "is_null" },
    ]);
  });

  it("refuses to negate a comparison, and says so", () => {
    // There is no honest inversion: negating "> 500" is not "<= 500"
    // for a row that has no value at all.
    const result = parseQuery("-price:>500");
    assert.deepEqual(result.filters, []);
    assert.equal(result.text, "-price:>500");
    assert.match(result.errors[0], /cannot be negated/);
  });

  it("refuses to negate a set — there is no not_in", () => {
    const result = parseQuery("-size:in(S,M)");
    assert.deepEqual(result.filters, []);
    assert.equal(result.errors.length, 1);
  });

  it("treats a lone hyphen as free text", () => {
    assert.equal(parseQuery("-").text, "-");
  });
});

describe("parseQuery — scope", () => {
  it("parses in: as a scope, not a filter", () => {
    const result = parseQuery("in:electronics");
    assert.equal(result.scope, "electronics");
    assert.deepEqual(result.filters, []);
  });

  it("keeps the last scope and notes the conflict", () => {
    const result = parseQuery("in:electronics in:books");
    assert.equal(result.scope, "books");
    assert.equal(result.errors.length, 1);
  });

  it("refuses a negated scope", () => {
    const result = parseQuery("-in:electronics");
    assert.equal(result.scope, null);
    assert.equal(result.errors.length, 1);
  });
});

describe("parseQuery — combinations", () => {
  it("ANDs several filters and keeps free text alongside", () => {
    const result = parseQuery('wireless brand:Sony price:>500 in:electronics missing:sku');
    assert.equal(result.text, "wireless");
    assert.equal(result.scope, "electronics");
    assert.deepEqual(result.filters, [
      { key: "brand", op: "eq", value: "Sony" },
      { key: "price", op: "gt", value: "500" },
      { key: "sku", op: "is_null" },
    ]);
    assert.deepEqual(result.errors, []);
  });
});

describe("parseQuery — malformed input never throws", () => {
  const nasty = [
    ":",
    "::",
    ":value",
    "key:",
    "-:",
    '"',
    '""',
    "key:in(",
    "a".repeat(500),
    "brand:Sony:extra",
    "PRICE:>500",
    "1234:foo",
    "_key:foo",
    "https://example.com/thing",
    "  ",
    "brand:*",
    "price:..",
    "price:1..",
  ];

  for (const input of nasty) {
    it(`survives ${JSON.stringify(input)}`, () => {
      const result = parseQuery(input);
      assert.ok(Array.isArray(result.filters));
      assert.equal(typeof result.text, "string");
    });
  }

  it("does not mistake a URL for a filter", () => {
    const result = parseQuery("https://example.com/thing");
    assert.deepEqual(result.filters, []);
    assert.equal(result.text, "https://example.com/thing");
  });

  it("does not mistake an uppercase or numeric key for a field", () => {
    // Field keys are lowercase snake_case; anything else is a word.
    assert.deepEqual(parseQuery("1234:foo").filters, []);
    assert.deepEqual(parseQuery("_key:foo").filters, []);
  });

  it("lowercases the key so BRAND:Sony still filters", () => {
    assert.deepEqual(parseQuery("BRAND:Sony").filters, [
      { key: "brand", op: "eq", value: "Sony" },
    ]);
  });

  it("keeps everything after the first colon as the value", () => {
    assert.deepEqual(parseQuery("brand:Sony:extra").filters, [
      { key: "brand", op: "eq", value: "Sony:extra" },
    ]);
  });
});

describe("serializeQuery round-trips", () => {
  const cases = [
    "brand:Sony",
    "-discontinued:true",
    "price:>500",
    "price:>=500",
    "price:<500",
    "price:<=500",
    "size:in(S,M,L)",
    "missing:warranty_months",
    "has:warranty_months",
    "brand:*son*",
    "brand:So*",
    "in:electronics",
    "wireless brand:Sony price:>500",
  ];

  for (const input of cases) {
    it(`re-parses to the same thing: ${input}`, () => {
      const once = parseQuery(input);
      const twice = parseQuery(serializeQuery(once));
      assert.deepEqual(twice.filters, once.filters);
      assert.equal(twice.scope, once.scope);
      assert.equal(twice.text, once.text);
    });
  }

  it("quotes a value containing a space", () => {
    const parsed = parseQuery('brand:"Herman Miller"');
    assert.equal(serializeQuery(parsed), 'brand:"Herman Miller"');
  });

  it("re-parses a range to the same two filters", () => {
    // A range serialises as its two halves rather than 500..1200, which
    // is not identical text but IS an identical query.
    const once = parseQuery("price:500..1200");
    const twice = parseQuery(serializeQuery(once));
    assert.deepEqual(twice.filters, once.filters);
  });
});

// ── Item value unit tests ────────────────────────────────────
// Run with:  npm test
//
// safeHref is a security boundary, not a formatting helper: whatever it
// returns is put in an href. So the cases that matter most are the ones
// it must refuse.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { itemTitle, safeHref, validateItemData } from "./items.ts";
import type { EffectiveField } from "./types.ts";

describe("safeHref — what becomes a link", () => {
  it("accepts http and https addresses", () => {
    assert.equal(safeHref("https://example.com/page"), "https://example.com/page");
    assert.equal(safeHref("http://example.com"), "http://example.com/");
  });

  it("adds https:// to a bare host, as people type them", () => {
    assert.equal(safeHref("example.com/page"), "https://example.com/page");
    assert.equal(safeHref("  www.example.co.uk  "), "https://www.example.co.uk/");
    assert.equal(safeHref("example.com:8080/x"), "https://example.com:8080/x");
  });

  it("refuses javascript: even when it parses with a dotted host", () => {
    // The payload that got past the old check: `//example.com/` is a
    // comment, and the encoded newline ends it.
    assert.equal(safeHref("javascript://example.com/%0Aalert(1)"), null);
    assert.equal(safeHref("JavaScript://example.com/%0Aalert(1)"), null);
    assert.equal(safeHref("javascript:alert(1)"), null);
  });

  it("refuses every other scheme", () => {
    assert.equal(safeHref("data://example.com/text/html,<script>alert(1)</script>"), null);
    assert.equal(safeHref("vbscript://example.com/x"), null);
    assert.equal(safeHref("file://server.example.com/share"), null);
    assert.equal(safeHref("ftp://files.example.com"), null);
  });

  it("refuses what is not an address at all", () => {
    assert.equal(safeHref(""), null);
    assert.equal(safeHref("   "), null);
    assert.equal(safeHref("localhost"), null);
    assert.equal(safeHref("call for a quote"), null);
  });
});

describe("itemTitle", () => {
  it("prefers a key that usually names the item", () => {
    assert.equal(itemTitle({ color: "red", sku: "A-1", name: "Aeron" }), "Aeron");
    assert.equal(itemTitle({ color: "red", sku: "A-1" }), "A-1");
  });

  it("falls back to the first text value, never an orphaned one", () => {
    assert.equal(itemTitle({ __orphaned: { name: "Old" }, color: "red" }), "red");
  });

  it("returns null when there is nothing to call it", () => {
    assert.equal(itemTitle({ price: 12, in_stock: true }), null);
    assert.equal(itemTitle({ name: "   " }), null);
    assert.equal(itemTitle(null), null);
  });
});

describe("validateItemData — url fields", () => {
  const field: EffectiveField = {
    key: "manual",
    label: "Manual",
    type: "url",
    required: false,
    position: 0,
    source_category_id: "c1",
    source_category_name: "Root",
    depth: 0,
    inherited: false,
    overridden_by: [],
  };

  it("passes an ordinary address", () => {
    assert.deepEqual(validateItemData([field], { manual: "example.com/manual.pdf" }), {});
  });

  it("rejects a javascript: address instead of storing it", () => {
    const errors = validateItemData([field], { manual: "javascript://example.com/%0Aalert(1)" });
    assert.match(errors.manual ?? "", /valid URL/);
  });
});

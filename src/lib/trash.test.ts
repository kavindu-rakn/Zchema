// ── Trash entry wording unit tests ───────────────────────────
// Run with:  npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { describeTrashEntry } from "./trash.ts";
import type { TrashEntry } from "./types.ts";

const entry = (overrides: Partial<TrashEntry>): TrashEntry => ({
  batch: "1",
  deleted_at: "2026-09-19T12:00:00Z",
  deleted_by: null,
  categories: 0,
  items: 0,
  top_categories: [],
  item_samples: [],
  home_categories: [],
  blocked_by: null,
  ...overrides,
});

describe("describeTrashEntry — categories", () => {
  it("names the top of the tree and counts what came with it", () => {
    const d = describeTrashEntry(
      entry({ categories: 4, items: 20, top_categories: ["Laptops"] })
    );
    assert.equal(d.kind, "category");
    assert.equal(d.title, "“Laptops”");
    assert.equal(d.detail, "with 3 subcategories and 20 items");
    assert.equal(d.needsAdmin, true);
  });

  it("uses the singular where it should", () => {
    const d = describeTrashEntry(entry({ categories: 2, items: 1, top_categories: ["Chairs"] }));
    assert.equal(d.detail, "with 1 subcategory and 1 item");
  });

  it("says so when the category was empty", () => {
    const d = describeTrashEntry(entry({ categories: 1, top_categories: ["Drafts"] }));
    assert.equal(d.detail, "empty — no subcategories or items");
  });
});

describe("describeTrashEntry — items", () => {
  it("names a single item by its title", () => {
    const d = describeTrashEntry(
      entry({ items: 1, item_samples: [{ name: "Aeron Chair" }], home_categories: ["Office Chairs"] })
    );
    assert.equal(d.kind, "items");
    assert.equal(d.title, "“Aeron Chair”");
    assert.equal(d.detail, "from Office Chairs");
    assert.equal(d.needsAdmin, false);
  });

  it("counts several items and shows the first few", () => {
    const d = describeTrashEntry(
      entry({
        items: 12,
        item_samples: [{ name: "A" }, { name: "B" }, { price: 3 }],
        home_categories: ["Laptops", "Tablets"],
      })
    );
    assert.equal(d.title, "12 items");
    assert.equal(d.detail, "from 2 categories · including “A” and “B”…");
  });

  it("falls back to a count when the item has no text to name it by", () => {
    const d = describeTrashEntry(entry({ items: 1, item_samples: [{ price: 3 }] }));
    assert.equal(d.title, "1 item");
    assert.equal(d.detail, null);
  });
});

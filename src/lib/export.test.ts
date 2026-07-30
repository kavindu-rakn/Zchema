// ── Export formatting unit tests ─────────────────────────────
// Run with:  npm test
//
// CSV escaping is the classic "looks fine until it isn't" bug: get it
// wrong and the file still opens, it just has the wrong number of
// columns on the three rows that happened to contain a comma. So every
// character that changes the encoding gets a case.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORY_COLUMN,
  csvEscape,
  csvRow,
  exportFilename,
  exportHeader,
  ID_COLUMN,
  itemToRow,
} from "./export.ts";

describe("csvEscape", () => {
  it("leaves a plain value alone", () => {
    assert.equal(csvEscape("Sony"), "Sony");
  });

  it("renders null and undefined as an empty cell", () => {
    assert.equal(csvEscape(null), "");
    assert.equal(csvEscape(undefined), "");
  });

  it("keeps a zero rather than treating it as empty", () => {
    // `value || ""` would silently drop this. It is a real value.
    assert.equal(csvEscape(0), "0");
    assert.equal(csvEscape(false), "false");
  });

  it("quotes a value containing a comma", () => {
    assert.equal(csvEscape("Miller, Herman"), '"Miller, Herman"');
  });

  it("doubles internal quotes and wraps the field", () => {
    assert.equal(csvEscape('the "good" one'), '"the ""good"" one"');
  });

  it("quotes a value containing a newline", () => {
    assert.equal(csvEscape("line one\nline two"), '"line one\nline two"');
    assert.equal(csvEscape("line one\r\nline two"), '"line one\r\nline two"');
  });

  it("serialises an array or object rather than printing [object Object]", () => {
    assert.equal(csvEscape(["S", "M"]), '"[""S"",""M""]"');
    assert.equal(csvEscape({ a: 1 }), '"{""a"":1}"');
  });

  it("handles a value that is only a quote", () => {
    assert.equal(csvEscape('"'), '""""');
  });
});

describe("csvRow", () => {
  it("joins with commas and terminates with CRLF", () => {
    assert.equal(csvRow(["a", "b"]), "a,b\r\n");
  });

  it("keeps empty cells positional", () => {
    assert.equal(csvRow(["a", null, "c"]), "a,,c\r\n");
  });
});

describe("itemToRow", () => {
  const item = {
    id: "abc",
    category_path: "Electronics / Laptops",
    data: { brand: "Sony", ram_gb: 16, __orphaned: { legacy: "x" } },
  };

  it("leads with the id and category, then the chosen columns", () => {
    assert.deepEqual(itemToRow(item, ["brand", "ram_gb"]), [
      "abc",
      "Electronics / Laptops",
      "Sony",
      16,
    ]);
  });

  it("emits an empty cell for a column this item lacks", () => {
    // A ragged CSV is not a CSV — the cell must be present and empty.
    assert.deepEqual(itemToRow(item, ["brand", "gpu"]), [
      "abc",
      "Electronics / Laptops",
      "Sony",
      "",
    ]);
  });

  it("excludes orphaned data by default", () => {
    const row = itemToRow(item, ["brand"]);
    assert.equal(row.length, 3);
    assert.ok(!JSON.stringify(row).includes("legacy"));
  });

  it("appends orphaned data only when asked", () => {
    const row = itemToRow(item, ["brand"], { includeOrphaned: true });
    assert.equal(row.length, 4);
    assert.equal(row[3], '{"legacy":"x"}');
  });

  it("emits an empty orphan cell when there is nothing orphaned", () => {
    const clean = { id: "x", category_path: "P", data: { brand: "A" } };
    assert.equal(itemToRow(clean, ["brand"], { includeOrphaned: true })[3], "");
  });
});

describe("exportHeader", () => {
  it("matches itemToRow's column order", () => {
    assert.deepEqual(exportHeader(["brand", "ram_gb"]), [
      ID_COLUMN,
      CATEGORY_COLUMN,
      "brand",
      "ram_gb",
    ]);
  });

  it("adds the orphan column only when asked", () => {
    assert.deepEqual(exportHeader(["brand"], { includeOrphaned: true }), [
      ID_COLUMN,
      CATEGORY_COLUMN,
      "brand",
      "__orphaned",
    ]);
  });

  it("stays the same length as a row built with the same options", () => {
    const columns = ["a", "b", "c"];
    const item = { id: "i", category_path: "p", data: {} };
    for (const includeOrphaned of [false, true]) {
      assert.equal(
        exportHeader(columns, { includeOrphaned }).length,
        itemToRow(item, columns, { includeOrphaned }).length
      );
    }
  });
});

describe("exportFilename", () => {
  it("slugifies the scope", () => {
    assert.equal(
      exportFilename("Electronics / Laptops", "csv", "2026-01-02"),
      "electronics-laptops-2026-01-02.csv"
    );
  });

  it("falls back when the scope slugifies to nothing", () => {
    assert.equal(exportFilename("///", "json", "2026-01-02"), "export-2026-01-02.json");
  });
});

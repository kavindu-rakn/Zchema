// ── CSV parser unit tests ────────────────────────────────────
// Run with:  npm test
//
// A wrong CSV parser fails silently: the file loads, and the three rows
// containing a quoted comma have their columns shifted by one. So the
// cases here are deliberately the awkward ones — embedded newlines,
// escaped quotes, BOMs, lone CRs, ragged rows — rather than the happy
// path, which any implementation gets right.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectDelimiter, flattenJsonRow, parseCsv, parseJson, parseRows } from "./csv.ts";

describe("parseRows", () => {
  it("parses a simple grid", () => {
    assert.deepEqual(parseRows("a,b\n1,2"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles CRLF", () => {
    assert.deepEqual(parseRows("a,b\r\n1,2\r\n"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a lone CR", () => {
    assert.deepEqual(parseRows("a,b\r1,2"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("strips a UTF-8 BOM rather than gluing it to the first header", () => {
    // Left in place, the first column is named "﻿id" and every
    // lookup by "id" silently returns undefined.
    assert.deepEqual(parseRows("﻿a,b\n1,2")[0], ["a", "b"]);
  });

  it("keeps a delimiter inside a quoted field", () => {
    assert.deepEqual(parseRows('a,"b,c",d'), [["a", "b,c", "d"]]);
  });

  it("keeps a NEWLINE inside a quoted field", () => {
    assert.deepEqual(parseRows('a,"line one\nline two",c'), [["a", "line one\nline two", "c"]]);
  });

  it('turns "" into one literal quote', () => {
    assert.deepEqual(parseRows('a,"the ""good"" one",c'), [["a", 'the "good" one', "c"]]);
  });

  it("handles a field that is only a quoted empty string", () => {
    assert.deepEqual(parseRows('a,"",c'), [["a", "", "c"]]);
  });

  it("does not manufacture a phantom row from a trailing newline", () => {
    assert.equal(parseRows("a,b\n1,2\n").length, 2);
  });

  it("keeps a final row that has no trailing newline", () => {
    assert.equal(parseRows("a,b\n1,2").length, 2);
  });

  it("preserves empty trailing cells", () => {
    assert.deepEqual(parseRows("a,b,c\n1,,")[1], ["1", "", ""]);
  });

  it("returns nothing for empty input", () => {
    assert.deepEqual(parseRows(""), []);
  });
});

describe("detectDelimiter", () => {
  it("finds a comma", () => {
    assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  });

  it("finds a semicolon", () => {
    assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  });

  it("finds a tab", () => {
    assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  });

  it("finds a pipe", () => {
    assert.equal(detectDelimiter("a|b|c\n1|2|3"), "|");
  });

  it("prefers CONSISTENCY over frequency", () => {
    // Semicolon-delimited prose full of commas. Counting occurrences
    // would pick the comma and shred every row.
    const text = 'name;notes\nWidget;"red, blue, green"\nGadget;"one, two, three"';
    assert.equal(detectDelimiter(text), ";");
  });

  it("falls back to a comma on a single column", () => {
    assert.equal(detectDelimiter("name\nWidget\nGadget"), ",");
  });

  it("does not crash on empty input", () => {
    assert.equal(detectDelimiter(""), ",");
  });
});

describe("parseCsv", () => {
  it("keys rows by header", () => {
    const table = parseCsv("name,qty\nWidget,3");
    assert.deepEqual(table.headers, ["name", "qty"]);
    assert.deepEqual(table.rows, [{ name: "Widget", qty: "3" }]);
  });

  it("trims headers", () => {
    assert.deepEqual(parseCsv(" name , qty \nA,1").headers, ["name", "qty"]);
  });

  it("renames duplicate headers instead of letting them clobber", () => {
    const table = parseCsv("name,name\nA,B");
    assert.deepEqual(table.headers, ["name", "name 2"]);
    assert.deepEqual(table.rows[0], { name: "A", "name 2": "B" });
    assert.equal(table.warnings.length, 1);
  });

  it("names an empty header rather than dropping the column", () => {
    const table = parseCsv("name,,qty\nA,B,1");
    assert.equal(table.headers[1], "column_2");
    assert.equal(table.rows[0].column_2, "B");
  });

  it("pads a short row and warns with the line number", () => {
    const table = parseCsv("a,b,c\n1,2");
    assert.deepEqual(table.rows[0], { a: "1", b: "2", c: "" });
    assert.match(table.warnings[0], /Line 2/);
  });

  it("keeps a long row's extra cells rather than discarding them", () => {
    const table = parseCsv("a,b\n1,2,3");
    assert.equal(table.rows[0]._extra_1, "3");
    assert.match(table.warnings[0], /Line 2/);
  });

  it("skips blank lines without counting them as rows", () => {
    assert.equal(parseCsv("a,b\n1,2\n\n3,4").rows.length, 2);
  });

  it("reports an empty file rather than throwing", () => {
    const table = parseCsv("");
    assert.deepEqual(table.rows, []);
    assert.equal(table.warnings.length, 1);
  });

  it("respects an explicit delimiter over detection", () => {
    assert.deepEqual(parseCsv("a;b\n1;2", { delimiter: ";" }).headers, ["a", "b"]);
  });
});

describe("flattenJsonRow", () => {
  it("flattens one level with an underscore", () => {
    const warnings: string[] = [];
    assert.deepEqual(flattenJsonRow({ specs: { weight: 2 } }, warnings, "Row 1"), {
      specs_weight: "2",
    });
  });

  it("joins an array of scalars so the multiselect rule can see it", () => {
    const warnings: string[] = [];
    assert.deepEqual(flattenJsonRow({ tags: ["a", "b"] }, warnings, "Row 1"), { tags: "a,b" });
  });

  it("skips an array of objects and says so", () => {
    const warnings: string[] = [];
    flattenJsonRow({ variants: [{ sku: "x" }] }, warnings, "Row 1");
    assert.match(warnings[0], /list of objects/);
  });

  it("refuses to flatten two levels deep, and says so", () => {
    const warnings: string[] = [];
    flattenJsonRow({ a: { b: { c: 1 } } }, warnings, "Row 1");
    assert.match(warnings[0], /nests too deeply/);
  });

  it("renders null as an empty cell", () => {
    const warnings: string[] = [];
    assert.deepEqual(flattenJsonRow({ a: null }, warnings, "Row 1"), { a: "" });
  });

  it("keeps false and 0 rather than treating them as absent", () => {
    const warnings: string[] = [];
    assert.deepEqual(flattenJsonRow({ a: false, b: 0 }, warnings, "Row 1"), { a: "false", b: "0" });
  });
});

describe("parseJson", () => {
  it("parses an array of objects", () => {
    const table = parseJson('[{"a":1},{"a":2}]');
    assert.deepEqual(table.headers, ["a"]);
    assert.equal(table.rows.length, 2);
  });

  it("accepts an { items: [...] } wrapper", () => {
    assert.equal(parseJson('{"items":[{"a":1}]}').rows.length, 1);
  });

  it("accepts a { data: [...] } wrapper", () => {
    assert.equal(parseJson('{"data":[{"a":1}]}').rows.length, 1);
  });

  it("gives every row every key, so the table is not ragged", () => {
    const table = parseJson('[{"a":1},{"b":2}]');
    assert.deepEqual(table.rows[0], { a: "1", b: "" });
    assert.deepEqual(table.rows[1], { a: "", b: "2" });
  });

  it("reports invalid JSON rather than throwing", () => {
    const table = parseJson("{not json");
    assert.deepEqual(table.rows, []);
    assert.match(table.warnings[0], /Not valid JSON/);
  });

  it("rejects a bare object with a message that says what was expected", () => {
    assert.match(parseJson('{"a":1}').warnings[0], /array of objects/);
  });

  it("skips a non-object entry and names its row", () => {
    const table = parseJson('[{"a":1},"nope"]');
    assert.equal(table.rows.length, 1);
    assert.match(table.warnings[0], /Row 2/);
  });
});

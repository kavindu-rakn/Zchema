// ── Inference unit tests ─────────────────────────────────────
// Run with:  npm test
//
// Inference is a guess presented as an answer, so the tests care about
// two things equally: that it gets the obvious cases right, and that it
// REFUSES the genuinely ambiguous ones instead of picking. The
// boolean/0-1 collision and the DD/MM vs MM/DD collision are the two
// places where a confident wrong answer silently corrupts data.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  inferSchema,
  parseDateShape,
  parseNumeric,
  suggestName,
  toFieldKey,
  toLabel,
} from "./inference.ts";

/** Build n rows for one column. */
function column(header: string, values: string[]): Record<string, string>[] {
  return values.map((value) => ({ [header]: value }));
}

function field(rows: Record<string, string>[], index = 0) {
  return inferSchema(rows).fields[index];
}

describe("parseNumeric", () => {
  it("parses a plain integer and decimal", () => {
    assert.deepEqual(parseNumeric("42"), { value: 42, unit: "" });
    assert.deepEqual(parseNumeric("3.14"), { value: 3.14, unit: "" });
    assert.deepEqual(parseNumeric("-5"), { value: -5, unit: "" });
  });

  it("captures a trailing unit", () => {
    assert.deepEqual(parseNumeric("16 GB"), { value: 16, unit: "GB" });
    assert.deepEqual(parseNumeric("16GB"), { value: 16, unit: "GB" });
    assert.deepEqual(parseNumeric("50%"), { value: 50, unit: "%" });
  });

  it("strips currency symbols and thousands separators", () => {
    assert.deepEqual(parseNumeric("$1,299.00"), { value: 1299, unit: "" });
    assert.deepEqual(parseNumeric("£45"), { value: 45, unit: "" });
  });

  it("accepts scientific notation", () => {
    assert.deepEqual(parseNumeric("1e5"), { value: 100000, unit: "" });
  });

  it("rejects an ambiguous comma rather than guessing", () => {
    // "1,5" is a decimal comma in half the world and a typo in the
    // other half. Guessing would be silently wrong either way.
    assert.equal(parseNumeric("1,5"), null);
  });

  it("rejects text", () => {
    assert.equal(parseNumeric("Intel Core i7"), null);
    assert.equal(parseNumeric(""), null);
    assert.equal(parseNumeric("n/a"), null);
  });
});

describe("parseDateShape", () => {
  it("recognises ISO", () => {
    assert.equal(parseDateShape("2024-03-04"), "iso");
    assert.equal(parseDateShape("2024-03-04T10:00:00Z"), "iso");
  });

  it("resolves the order when a day exceeds 12", () => {
    assert.equal(parseDateShape("25/03/2024"), "dmy");
    assert.equal(parseDateShape("03/25/2024"), "mdy");
  });

  it("reports ambiguity rather than picking", () => {
    assert.equal(parseDateShape("03/04/2024"), "either");
  });

  it("rejects an impossible date", () => {
    assert.equal(parseDateShape("25/25/2024"), null);
  });

  it("rejects non-dates", () => {
    assert.equal(parseDateShape("hello"), null);
    assert.equal(parseDateShape(""), null);
  });
});

describe("inferSchema — boolean", () => {
  it("recognises true/false and yes/no", () => {
    assert.equal(field(column("is_active", ["true", "false", "yes", "no"])).type, "boolean");
  });

  it("treats a 0/1 column as a NUMBER when the header is not boolean-ish", () => {
    // `quantity` holding 0s and 1s is a small count, not a flag.
    // Getting this wrong turns a numeric column into checkboxes.
    const inferred = field(column("quantity", ["0", "1", "1", "0", "1"]));
    assert.equal(inferred.type, "number");
  });

  it("treats a 0/1 column as BOOLEAN when the header says so", () => {
    for (const header of ["is_active", "has_warranty", "discontinued_flag"]) {
      assert.equal(field(column(header, ["0", "1", "1", "0"])).type, "boolean", header);
    }
  });
});

describe("inferSchema — number and units", () => {
  it("captures a consistent unit onto the field", () => {
    const inferred = field(column("ram", ["16 GB", "32 GB", "8 GB", "16 GB"]));
    assert.equal(inferred.type, "number");
    assert.equal(inferred.unit, "GB");
    assert.match(inferred.reason, /all in GB/);
  });

  it("warns when a column mixes units instead of silently comparing them", () => {
    // 1 TB is smaller than 16 GB as a number. Anyone sorting this
    // column would get nonsense with no indication why.
    const result = inferSchema(column("storage", ["16 GB", "1 TB", "512 GB", "2 TB"]));
    assert.equal(result.fields[0].type, "number");
    assert.equal(result.fields[0].unit, undefined);
    assert.match(result.warnings.join(" "), /mixes units/);
  });

  it("falls back to string when too many values fail to parse", () => {
    // 3 of 5 parse — well under the 95% threshold.
    const inferred = field(column("price", ["10", "20", "call us", "ask", "30"]));
    assert.equal(inferred.type, "string");
    assert.equal(inferred.alternatives[0], "number");
    assert.ok(inferred.confidence < 0.5);
    assert.match(inferred.reason, /only \d+% of values look like a number/);
  });

  it("tolerates a single stray value at 95%", () => {
    const values = Array.from({ length: 20 }, (_, i) => String(i));
    assert.equal(field(column("count", values)).type, "number");
  });
});

describe("inferSchema — date", () => {
  it("assigns date for ISO values", () => {
    assert.equal(
      field(column("released", ["2024-01-01", "2024-02-01", "2023-12-25"])).type,
      "date"
    );
  });

  it("resolves DD/MM when some day exceeds 12", () => {
    const inferred = field(column("released", ["25/03/2024", "01/04/2024", "13/05/2024"]));
    assert.equal(inferred.type, "date");
    assert.match(inferred.reason, /DD\/MM/);
  });

  it("REFUSES to guess when nothing disambiguates, and warns", () => {
    const result = inferSchema(column("released", ["03/04/2024", "05/06/2024", "07/08/2024"]));
    assert.equal(result.fields[0].type, "date");
    assert.match(result.fields[0].reason, /cannot be determined/);
    assert.match(result.warnings.join(" "), /3 April or 4 March/);
  });
});

describe("inferSchema — url", () => {
  it("recognises http and https", () => {
    assert.equal(
      field(column("link", ["https://a.example", "http://b.example", "https://c.example"])).type,
      "url"
    );
  });

  it("does not treat a bare domain as a url", () => {
    assert.notEqual(field(column("link", ["a.example", "b.example", "c.example"])).type, "url");
  });
});

describe("inferSchema — select", () => {
  it("recognises a closed vocabulary, ordered by frequency", () => {
    // 20 rows: the 30%-of-rows rule makes `select` undetectable on a
    // handful of rows by design, the same way `required` needs ten.
    const values = [
      ...Array(10).fill("New"),
      ...Array(6).fill("Used"),
      ...Array(4).fill("Refurbished"),
    ];
    const inferred = field(column("condition", values));
    assert.equal(inferred.type, "select");
    assert.deepEqual(inferred.options, ["New", "Used", "Refurbished"]);
  });

  it("refuses on a sample too small to justify a closed vocabulary", () => {
    // Three options across six rows is a coincidence, not a vocabulary.
    assert.notEqual(
      field(column("condition", ["New", "Used", "New", "Used", "New", "Used"])).type,
      "select"
    );
  });

  it("refuses when a value occurs only once", () => {
    // A value seen once is a value, not an option.
    assert.notEqual(field(column("name", ["A", "B", "C", "D"])).type, "select");
  });

  it("refuses when distinct values exceed 30% of the rows", () => {
    const values = Array.from({ length: 12 }, (_, i) => `v${i % 6}`);
    assert.notEqual(field(column("code", values)).type, "select");
  });
});

describe("inferSchema — multiselect", () => {
  it("beats select on comma-separated lists", () => {
    // As raw strings these pass the select test, which would make
    // "S,M" a single option — visibly wrong.
    const inferred = field(
      column("sizes", ["S,M", "M,L", "S", "M,L", "S,M", "L"])
    );
    assert.equal(inferred.type, "multiselect");
    assert.ok(inferred.options?.includes("S"));
    assert.ok(inferred.options?.includes("M"));
    assert.ok(inferred.options?.includes("L"));
  });

  it("does not mistake prose containing commas for a multiselect", () => {
    const inferred = field(
      column("notes", [
        "red, blue and green",
        "one, two and three",
        "alpha, beta and gamma",
        "up, down and sideways",
      ])
    );
    assert.notEqual(inferred.type, "multiselect");
  });
});

describe("inferSchema — text and string", () => {
  it("uses text when the median length is long", () => {
    const long = "x".repeat(200);
    assert.equal(field(column("description", [long, long, long])).type, "text");
  });

  it("falls back to string for short free text", () => {
    const inferred = field(column("name", ["Widget", "Gadget", "Doohickey", "Thing"]));
    assert.equal(inferred.type, "string");
    assert.ok(inferred.confidence > 0.5);
  });
});

describe("inferSchema — required", () => {
  it("marks a full column required once there are enough rows", () => {
    const values = Array.from({ length: 12 }, (_, i) => `v${i}`);
    assert.equal(field(column("name", values)).required, true);
  });

  it("does NOT mark required on a small sample", () => {
    // With three rows, "no empty values" is a coincidence.
    assert.equal(field(column("name", ["a", "b", "c"])).required, false);
  });

  it("does not mark required when any value is empty", () => {
    const values = Array.from({ length: 12 }, (_, i) => (i === 5 ? "" : `v${i}`));
    assert.equal(field(column("name", values)).required, false);
  });
});

describe("inferSchema — keys and labels", () => {
  it("derives a snake_case key from a human header", () => {
    assert.equal(toFieldKey("Screen Size (in)"), "screen_size_in");
    assert.equal(toFieldKey("RAM"), "ram");
  });

  it("prefixes a key that would start with a digit", () => {
    assert.equal(toFieldKey("2024 Sales"), "f_2024_sales");
  });

  it("title-cases a machine header but leaves a human one alone", () => {
    assert.equal(toLabel("screen_size"), "Screen Size");
    assert.equal(toLabel("Release Date (UTC)"), "Release Date (UTC)");
  });

  it("deduplicates colliding keys", () => {
    const rows = [{ "Screen Size": "1", "screen size": "2" }];
    const result = inferSchema(rows);
    assert.equal(result.fields[0].key, "screen_size");
    assert.equal(result.fields[1].key, "screen_size_2");
  });

  it("records the original header when the label rewrote it", () => {
    const inferred = field(column("screen_size", ["a", "b"]));
    assert.match(inferred.help_text ?? "", /screen_size/);
  });
});

describe("inferSchema — reporting", () => {
  it("counts nulls and distinct values", () => {
    const inferred = field(column("brand", ["A", "", "B", "A", ""]));
    assert.equal(inferred.null_count, 2);
    assert.equal(inferred.distinct_count, 2);
  });

  it("offers up to five sample values", () => {
    const inferred = field(column("brand", ["A", "B", "C", "D", "E", "F", "G"]));
    assert.equal(inferred.sample_values.length, 5);
  });

  it("handles an entirely empty column without crashing", () => {
    const inferred = field(column("blank", ["", "", ""]));
    assert.equal(inferred.type, "string");
    assert.ok(inferred.confidence < 0.5);
    assert.match(inferred.reason, /entirely empty/);
  });

  it("handles zero rows", () => {
    const result = inferSchema([]);
    assert.deepEqual(result.fields, []);
    assert.equal(result.row_count, 0);
    assert.match(result.warnings.join(" "), /No data rows/);
  });

  it("keeps column order and positions", () => {
    const result = inferSchema([{ a: "1", b: "2", c: "3" }]);
    assert.deepEqual(
      result.fields.map((f) => f.key),
      ["a", "b", "c"]
    );
    assert.deepEqual(
      result.fields.map((f) => f.position),
      [0, 1, 2]
    );
  });

  it("carries parser warnings through", () => {
    const result = inferSchema([{ a: "1" }], { warnings: ["Line 2: ragged"] });
    assert.ok(result.warnings.includes("Line 2: ragged"));
  });
});

describe("suggestName", () => {
  it("turns a filename into a title", () => {
    assert.equal(suggestName("laptop-inventory-2024.csv"), "Laptop Inventory 2024");
    assert.equal(suggestName("my_products.json"), "My Products");
  });

  it("falls back when there is nothing to work with", () => {
    assert.equal(suggestName(), "Imported Items");
    assert.equal(suggestName(".csv"), "Imported Items");
  });
});

describe("inferSchema — a realistic sheet", () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    "Product Name": `Laptop ${i}`,
    Brand: ["Dell", "HP", "Lenovo"][i % 3],
    RAM: `${[8, 16, 32][i % 3]} GB`,
    "Release Date": `2024-0${(i % 9) + 1}-15`,
    "Product URL": `https://example.com/p/${i}`,
    "In Stock": i % 2 === 0 ? "yes" : "no",
    Tags: ["gaming,portable", "business", "gaming"][i % 3],
    Notes: i % 5 === 0 ? "" : "A note",
  }));

  const result = inferSchema(rows, { sourceName: "laptops.csv" });
  const byKey = new Map(result.fields.map((f) => [f.key, f]));

  it("types every column as expected", () => {
    assert.equal(byKey.get("product_name")?.type, "string");
    assert.equal(byKey.get("brand")?.type, "select");
    assert.equal(byKey.get("ram")?.type, "number");
    assert.equal(byKey.get("ram")?.unit, "GB");
    assert.equal(byKey.get("release_date")?.type, "date");
    assert.equal(byKey.get("product_url")?.type, "url");
    assert.equal(byKey.get("in_stock")?.type, "boolean");
    assert.equal(byKey.get("tags")?.type, "multiselect");
  });

  it("marks the full columns required and the gappy one optional", () => {
    assert.equal(byKey.get("brand")?.required, true);
    assert.equal(byKey.get("notes")?.required, false);
  });

  it("suggests a name from the filename", () => {
    assert.equal(result.suggested_name, "Laptops");
  });
});

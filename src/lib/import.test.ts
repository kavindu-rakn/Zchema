// ── Import preparation unit tests ────────────────────────────
// Run with:  npm test
//
// The date normalisation is the part that silently corrupts data if it
// is wrong — an off-by-one in day/month order shifts a whole column by
// up to eleven months and nothing on screen looks broken.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRows, fieldsToCreate, matchToExisting, normaliseCell } from "./import.ts";
import type { ColumnPlan } from "./import.ts";
import type { EffectiveField, SchemaField } from "./types.ts";

function field(overrides: Partial<SchemaField> = {}): SchemaField {
  return {
    key: "brand",
    label: "Brand",
    type: "string",
    required: false,
    position: 0,
    ...overrides,
  };
}

function effective(overrides: Partial<EffectiveField> = {}): EffectiveField {
  return {
    key: "brand",
    label: "Brand",
    type: "string",
    required: false,
    position: 0,
    source_category_id: "c1",
    source_category_name: "Electronics",
    depth: 1,
    inherited: true,
    overridden_by: [],
    ...overrides,
  };
}

describe("normaliseCell — dates", () => {
  it("passes ISO through, dropping any time component", () => {
    assert.equal(normaliseCell("2024-03-04", "date"), "2024-03-04");
    assert.equal(normaliseCell("2024-03-04T10:00:00Z", "date"), "2024-03-04");
  });

  it("honours the chosen DD/MM reading", () => {
    assert.equal(normaliseCell("03/04/2024", "date", "dmy"), "2024-04-03");
  });

  it("honours the chosen MM/DD reading", () => {
    assert.equal(normaliseCell("03/04/2024", "date", "mdy"), "2024-03-04");
  });

  it("lets the DATA override the chosen order when a day exceeds 12", () => {
    // The user picked MM/DD, but 25 cannot be a month. The data wins.
    assert.equal(normaliseCell("25/03/2024", "date", "mdy"), "2024-03-25");
  });

  it("pads single-digit days and months", () => {
    assert.equal(normaliseCell("1/2/2024", "date", "dmy"), "2024-02-01");
  });

  it("accepts dots and dashes as separators", () => {
    assert.equal(normaliseCell("03.04.2024", "date", "dmy"), "2024-04-03");
    assert.equal(normaliseCell("03-04-2024", "date", "dmy"), "2024-04-03");
  });

  it("leaves an unparseable value alone so the server reports the row", () => {
    assert.equal(normaliseCell("n/a", "date"), "n/a");
  });

  it("rejects an impossible date rather than wrapping it", () => {
    assert.equal(normaliseCell("40/40/2024", "date", "dmy"), "40/40/2024");
  });

  it("returns empty for an empty cell", () => {
    assert.equal(normaliseCell("", "date"), "");
    assert.equal(normaliseCell("   ", "date"), "");
  });
});

describe("normaliseCell — other types", () => {
  it("trims but does not otherwise touch non-dates", () => {
    assert.equal(normaliseCell("  Sony  ", "string"), "Sony");
    assert.equal(normaliseCell("16 GB", "number"), "16 GB");
    assert.equal(normaliseCell("S,M", "multiselect"), "S,M");
  });

  it("does not reformat a date-looking value in a string column", () => {
    assert.equal(normaliseCell("03/04/2024", "string"), "03/04/2024");
  });
});

describe("matchToExisting", () => {
  const schema = [
    effective({ key: "brand", label: "Brand" }),
    effective({ key: "warranty_months", label: "Warranty (months)" }),
  ];

  it("matches on key", () => {
    const matches = matchToExisting([{ header: "brand", field: field() }], schema);
    assert.equal(matches.get("brand")?.key, "brand");
  });

  it("matches on a normalised label", () => {
    const matches = matchToExisting(
      [{ header: "Warranty (Months)", field: field({ key: "warranty_months_x", label: "Warranty (Months)" }) }],
      schema
    );
    assert.equal(matches.get("Warranty (Months)")?.key, "warranty_months");
  });

  it("matches Brand Name onto the inherited brand rather than duplicating", () => {
    const matches = matchToExisting(
      [{ header: "Brand Name", field: field({ key: "brand_name", label: "Brand Name" }) }],
      schema
    );
    assert.equal(matches.get("Brand Name")?.key, "brand");
  });

  it("does not fuzzy-match on a stub shorter than four characters", () => {
    // "id" would otherwise contain-match half a schema.
    const matches = matchToExisting(
      [{ header: "id", field: field({ key: "id", label: "id" }) }],
      [effective({ key: "guid", label: "id number" })]
    );
    assert.equal(matches.get("id"), undefined);
  });

  it("leaves a genuinely new column unmatched", () => {
    const matches = matchToExisting(
      [{ header: "Refresh Rate", field: field({ key: "refresh_rate", label: "Refresh Rate" }) }],
      schema
    );
    assert.equal(matches.get("Refresh Rate"), undefined);
  });
});

describe("buildRows", () => {
  const plans: ColumnPlan[] = [
    { header: "Brand", skip: false, field: field({ key: "brand" }) },
    { header: "Released", skip: false, field: field({ key: "released", type: "date" }), dateOrder: "dmy" },
    { header: "Internal", skip: true, field: field({ key: "internal" }) },
  ];

  it("keys rows by field key, not by source header", () => {
    const rows = buildRows([{ Brand: "Sony", Released: "03/04/2024", Internal: "x" }], plans);
    assert.deepEqual(rows[0], { brand: "Sony", released: "2024-04-03" });
  });

  it("omits skipped columns entirely", () => {
    const rows = buildRows([{ Brand: "Sony", Internal: "secret" }], plans);
    assert.ok(!("internal" in rows[0]));
  });

  it("omits empty cells rather than storing empty strings", () => {
    // An absent key and a key holding "" mean different things to the
    // completeness check; only the first is honest.
    const rows = buildRows([{ Brand: "", Released: "2024-01-01" }], plans);
    assert.deepEqual(rows[0], { released: "2024-01-01" });
  });

  it("handles a row missing a column altogether", () => {
    assert.deepEqual(buildRows([{ Brand: "Sony" }], plans), [{ brand: "Sony" }]);
  });
});

describe("fieldsToCreate", () => {
  it("returns only unmapped, unskipped columns", () => {
    const plans: ColumnPlan[] = [
      { header: "A", skip: false, field: field({ key: "a" }) },
      { header: "B", skip: false, field: field({ key: "b" }), mappedTo: "inherited" },
      { header: "C", skip: true, field: field({ key: "c" }) },
    ];
    assert.deepEqual(
      fieldsToCreate(plans).map((f) => f.key),
      ["a"]
    );
  });

  it("renumbers positions contiguously", () => {
    const plans: ColumnPlan[] = [
      { header: "A", skip: false, field: field({ key: "a", position: 7 }) },
      { header: "B", skip: false, field: field({ key: "b", position: 9 }) },
    ];
    assert.deepEqual(
      fieldsToCreate(plans).map((f) => f.position),
      [0, 1]
    );
  });

  it("drops inference metadata that is not part of a stored field", () => {
    const plans: ColumnPlan[] = [
      {
        header: "A",
        skip: false,
        // Extra keys of the sort InferredField carries.
        field: { ...field({ key: "a" }), confidence: 0.9, reason: "x" } as SchemaField,
      },
    ];
    const [created] = fieldsToCreate(plans);
    assert.ok(!("confidence" in created));
    assert.ok(!("reason" in created));
  });
});

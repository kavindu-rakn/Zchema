// ── Schema inference ─────────────────────────────────────────
// Pure, no I/O, heavily unit-tested. Given rows of strings, work out
// what each column IS.
//
// The governing principle is that a confident wrong guess is worse than
// an unconfident right one. Every inference carries the evidence that
// produced it ("412/500 values parse as numbers") and the alternatives
// it beat, so the review step can argue with it. Where the data is
// genuinely ambiguous — 03/04/2024 — it refuses to pick and says why.

import { slugify } from "./schema.ts";
import type { FieldType, SchemaField } from "./types.ts";

export interface InferredField extends SchemaField {
  /** 0–1. How strongly the evidence supports this type over the others. */
  confidence: number;
  /** The evidence, in a sentence. Shown verbatim in the review step. */
  reason: string;
  sample_values: string[];
  null_count: number;
  distinct_count: number;
  /** Other plausible types, best first. */
  alternatives: FieldType[];
}

export interface InferenceResult {
  fields: InferredField[];
  row_count: number;
  warnings: string[];
  suggested_name: string;
}

export interface InferenceOptions {
  /** Filename or similar, used for suggested_name. */
  sourceName?: string;
  /** Warnings carried over from parsing. */
  warnings?: string[];
}

/** Rows examined. Beyond this the answer stops changing. */
const SAMPLE_SIZE = 1000;

/** Share of non-empty values that must match before a type is assigned. */
const THRESHOLD = 0.95;

/** A candidate needs this much support to be worth offering as an alternative. */
const ALTERNATIVE_THRESHOLD = 0.5;

const BOOLEAN_WORDS = new Set(["true", "false", "yes", "no", "y", "n", "1", "0", "t", "f"]);

/** Headers that make a 0/1 column genuinely boolean rather than numeric. */
const BOOLEAN_HEADER = /^(is|has|can|should|was|are|does)[_\s-]|[_\s-]?(flag|enabled|active)$/i;

const MULTISELECT_SEPARATORS = [",", ";", "|"] as const;

// ── Cell parsers ─────────────────────────────────────────────

/**
 * A number, with its unit if it carries one.
 *
 * `"16 GB"` → `{ value: 16, unit: "GB" }`. Capturing the unit is what
 * makes this feel like it understood the column rather than merely
 * pattern-matched it — and the unit is a real field property, so it
 * survives into the schema.
 *
 * A comma is treated as a thousands separator ONLY in the 3-digit
 * grouping shape. `"1,5"` is rejected rather than guessed at: it is a
 * decimal comma in half the world and a typo in the other half.
 */
export function parseNumeric(raw: string): { value: number; unit: string } | null {
  let text = raw.trim();
  if (text === "") return null;

  text = text.replace(/^[$€£¥₹]\s*/, "").replace(/\s*[$€£¥₹]$/, "");

  const match =
    /^([-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?|[-+]?\.\d+)\s*([A-Za-z%°][A-Za-z%°/²³]*)?$/.exec(
      text
    );
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;

  return { value, unit: (match[2] ?? "").trim() };
}

export type DateShape = "iso" | "dmy" | "mdy" | "either";

/**
 * Recognise a date and report WHICH shape it is.
 *
 * `"either"` means the value fits both DD/MM and MM/DD — the caller
 * needs that distinction, because a column where every value is
 * `"either"` is genuinely ambiguous and must be asked about rather
 * than guessed. Guessing here silently shifts dates by up to eleven
 * months.
 */
export function parseDateShape(raw: string): DateShape | null {
  const text = raw.trim();
  if (text === "") return null;

  if (/^\d{4}-\d{2}-\d{2}([T\s].*)?$/.test(text)) return "iso";

  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (!slash) return null;

  const first = Number(slash[1]);
  const second = Number(slash[2]);

  if (first > 12 && second <= 12) return "dmy";
  if (second > 12 && first <= 12) return "mdy";
  if (first > 12 && second > 12) return null;
  return "either";
}

export function isBooleanish(raw: string): boolean {
  return BOOLEAN_WORDS.has(raw.trim().toLowerCase());
}

export function isUrl(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw.trim());
}

// ── Column analysis ──────────────────────────────────────────

interface Candidate {
  type: FieldType;
  ratio: number;
  reason: string;
  unit?: string;
  options?: string[];
  warnings?: string[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Does a set of values look like a closed vocabulary? */
function selectOptions(values: string[], rowCount: number): string[] | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  const distinct = counts.size;
  if (distinct === 0) return null;
  if (distinct > 20) return null;
  if (rowCount > 0 && distinct > rowCount * 0.3) return null;
  // Every option must recur. A value seen once is a value, not an option.
  if ([...counts.values()].some((count) => count < 2)) return null;

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

function analyseColumn(header: string, rawValues: string[]): Candidate[] {
  const values = rawValues.slice(0, SAMPLE_SIZE);
  const present = values.map((value) => value.trim()).filter((value) => value !== "");
  const total = present.length;
  const candidates: Candidate[] = [];

  if (total === 0) return candidates;

  const ratio = (n: number) => n / total;

  // ── boolean ───────────────────────────────────────────────
  const booleanCount = present.filter(isBooleanish).length;
  if (ratio(booleanCount) >= ALTERNATIVE_THRESHOLD) {
    const onlyDigits = present.every((value) => value === "0" || value === "1");
    // A column of nothing but 0 and 1 is a number unless its NAME says
    // otherwise. `quantity` holding 0s and 1s is a count that happens
    // to be small; `is_active` is a flag.
    const looksBoolean = BOOLEAN_HEADER.test(header);
    if (!(onlyDigits && !looksBoolean)) {
      candidates.push({
        type: "boolean",
        ratio: ratio(booleanCount),
        reason: `${booleanCount}/${total} values are true/false-like`,
      });
    }
  }

  // ── number, with unit ─────────────────────────────────────
  const numerics = present.map(parseNumeric);
  const numericCount = numerics.filter(Boolean).length;
  if (ratio(numericCount) >= ALTERNATIVE_THRESHOLD) {
    const units = new Set(
      numerics.filter(Boolean).map((entry) => entry!.unit).filter((unit) => unit !== "")
    );
    const unit = units.size === 1 ? [...units][0] : undefined;
    const warnings =
      units.size > 1
        ? [
            `"${header}" mixes units (${[...units].join(", ")}). The numbers are not comparable — split the column or convert first.`,
          ]
        : undefined;

    candidates.push({
      type: "number",
      ratio: ratio(numericCount),
      reason: unit
        ? `${numericCount}/${total} values parse as numbers, all in ${unit}`
        : `${numericCount}/${total} values parse as numbers`,
      unit,
      warnings,
    });
  }

  // ── date ──────────────────────────────────────────────────
  const shapes = present.map(parseDateShape);
  const dateCount = shapes.filter(Boolean).length;
  if (ratio(dateCount) >= ALTERNATIVE_THRESHOLD) {
    const found = new Set(shapes.filter(Boolean) as DateShape[]);
    const ambiguous = found.has("either") && !found.has("dmy") && !found.has("mdy");
    const resolved = found.has("dmy") ? "DD/MM/YYYY" : found.has("mdy") ? "MM/DD/YYYY" : "ISO";

    candidates.push({
      type: "date",
      ratio: ratio(dateCount),
      reason: ambiguous
        ? `${dateCount}/${total} values are dates, but the day/month order cannot be determined`
        : `${dateCount}/${total} values parse as dates (${resolved})`,
      warnings: ambiguous
        ? [
            `"${header}" is ambiguous: no value has a day above 12, so 03/04/2024 could be 3 April or 4 March. Pick a format before importing.`,
          ]
        : undefined,
    });
  }

  // ── url ───────────────────────────────────────────────────
  const urlCount = present.filter(isUrl).length;
  if (ratio(urlCount) >= ALTERNATIVE_THRESHOLD) {
    candidates.push({
      type: "url",
      ratio: ratio(urlCount),
      reason: `${urlCount}/${total} values are http(s) links`,
    });
  }

  // ── multiselect, BEFORE select ────────────────────────────
  // Tested first despite being listed later: "S,M" and "M,L" pass the
  // select test as raw strings, and typing them as select would make
  // "S,M" a single option — visibly wrong. If the tokens form a closed
  // vocabulary, the column is a multiselect.
  for (const separator of MULTISELECT_SEPARATORS) {
    const withSeparator = present.filter((value) => value.includes(separator)).length;
    // A quarter is enough: plenty of real multiselect columns have most
    // rows holding a single value. Prose with commas fails the token
    // test below anyway.
    if (ratio(withSeparator) < 0.25) continue;

    const tokens = present.flatMap((value) =>
      value
        .split(separator)
        .map((token) => token.trim())
        .filter(Boolean)
    );
    if (tokens.some((token) => MULTISELECT_SEPARATORS.some((other) => token.includes(other)))) {
      continue;
    }

    const options = selectOptions(tokens, tokens.length);
    if (options) {
      candidates.push({
        type: "multiselect",
        ratio: 1,
        reason: `values are "${separator}"-separated lists drawn from ${options.length} options`,
        options,
      });
      break;
    }
  }

  // ── select ────────────────────────────────────────────────
  const options = selectOptions(present, total);
  if (options) {
    candidates.push({
      type: "select",
      ratio: 1,
      reason: `only ${options.length} distinct values, each occurring more than once`,
      options,
    });
  }

  // ── text ──────────────────────────────────────────────────
  const medianLength = median(present.map((value) => value.length));
  if (medianLength > 120) {
    candidates.push({
      type: "text",
      ratio: 1,
      reason: `median length is ${Math.round(medianLength)} characters`,
    });
  }

  return candidates;
}

// ── Key and label derivation ─────────────────────────────────

/** `"Screen Size (in)"` → `screen_size_in`. */
export function toFieldKey(header: string): string {
  const key = slugify(header).replace(/-/g, "_");
  // slugify falls back to "category" for an empty input, which would be
  // a baffling column name.
  const cleaned = key === "category" && !/categor/i.test(header) ? "column" : key;
  // A key must start with a letter.
  return /^[a-z]/.test(cleaned) ? cleaned : `f_${cleaned}`;
}

/** `"screen_size_in"` → `"Screen Size In"`; a human header is left alone. */
export function toLabel(header: string): string {
  const trimmed = header.trim();
  if (!trimmed) return "Column";
  // Only rewrite machine-shaped headers; "Release Date (UTC)" is
  // already a better label than anything derived from it.
  if (!/^[a-z0-9_-]+$/.test(trimmed)) return trimmed;
  return trimmed
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ── Entry point ──────────────────────────────────────────────

export function inferSchema(
  rows: Record<string, string>[],
  options: InferenceOptions = {}
): InferenceResult {
  const warnings = [...(options.warnings ?? [])];
  const rowCount = rows.length;

  // Union of keys, in first-seen order, so column order survives.
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }

  const usedKeys = new Map<string, number>();
  const fields: InferredField[] = [];

  headers.forEach((header, index) => {
    const rawValues = rows.map((row) => row[header] ?? "");
    const present = rawValues.map((value) => value.trim()).filter((value) => value !== "");
    const nullCount = rowCount - present.length;
    const distinct = new Set(present).size;

    const candidates = analyseColumn(header, rawValues)
      .filter((candidate) => candidate.ratio >= ALTERNATIVE_THRESHOLD)
      .sort((a, b) => b.ratio - a.ratio);

    const winner = candidates.find((candidate) => candidate.ratio >= THRESHOLD);

    let type: FieldType;
    let reason: string;
    let confidence: number;
    let unit: string | undefined;
    let fieldOptions: string[] | undefined;

    if (winner) {
      type = winner.type;
      reason = winner.reason;
      confidence = winner.ratio;
      unit = winner.unit;
      fieldOptions = winner.options;
      for (const warning of winner.warnings ?? []) warnings.push(warning);
    } else {
      type = "string";
      const nearMiss = candidates[0];
      if (nearMiss) {
        // A column that ALMOST parsed as something is exactly the case
        // worth surfacing — a few stray "n/a" cells are usually a data
        // problem, not a type decision.
        confidence = 0.4;
        reason = `kept as text — only ${Math.round(nearMiss.ratio * 100)}% of values look like a ${nearMiss.type}`;
      } else {
        confidence = present.length === 0 ? 0.2 : 0.9;
        reason =
          present.length === 0
            ? "the column is entirely empty"
            : `${present.length} free-text values with no consistent shape`;
      }
    }

    // Unique key, deduplicated with _2, _3 …
    const base = toFieldKey(header);
    const seen = usedKeys.get(base) ?? 0;
    usedKeys.set(base, seen + 1);
    const key = seen === 0 ? base : `${base}_${seen + 1}`;

    const label = toLabel(header);

    fields.push({
      key,
      label,
      type,
      // A constraint needs evidence. Below ten rows, "no empty values"
      // is a coincidence, not a rule.
      required: nullCount === 0 && rowCount >= 10,
      options: fieldOptions,
      unit,
      // Keep the original header when the label no longer contains it,
      // so a mapping back to the source file is always possible.
      help_text: label === header.trim() ? undefined : `Imported from "${header.trim()}"`,
      position: index,
      confidence,
      reason,
      sample_values: [...new Set(present)].slice(0, 5),
      null_count: nullCount,
      distinct_count: distinct,
      alternatives: candidates
        .filter((candidate) => candidate.type !== type)
        .map((candidate) => candidate.type),
    });
  });

  if (rowCount === 0) warnings.push("No data rows were found.");

  return {
    fields,
    row_count: rowCount,
    warnings,
    suggested_name: suggestName(options.sourceName),
  };
}

/** `"laptop-inventory-2024.csv"` → `"Laptop Inventory 2024"`. */
export function suggestName(sourceName?: string): string {
  if (!sourceName) return "Imported Items";
  const base = sourceName.replace(/\.[a-z0-9]+$/i, "").trim();
  if (!base) return "Imported Items";
  return (
    base
      .split(/[_\-\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ") || "Imported Items"
  );
}

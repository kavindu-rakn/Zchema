// ── Items table state ────────────────────────────────────────
// Pure helpers for the table's URL-encoded filter state and its
// default column selection. Kept out of the component so the encoding
// round-trip can be tested — a filter that survives a link is only
// useful if it decodes back to exactly what was encoded.

import type { EffectiveField } from "./types";
import type { FilterOp, ItemFilter } from "./data/items";

/**
 * Encode filters for the URL.
 *
 * Format: `key:op:value:value2`, filters joined by `,`. Every part is
 * percent-encoded, so a value containing `:` or `,` round-trips.
 */
export function encodeFilters(filters: ItemFilter[]): string {
  return filters
    .filter((filter) => filter.key)
    .map((filter) =>
      [
        encodeURIComponent(filter.key),
        encodeURIComponent(filter.op),
        encodeURIComponent(filter.value ?? ""),
        encodeURIComponent(filter.value2 ?? ""),
      ].join(":")
    )
    .join(",");
}

const VALID_OPS: FilterOp[] = [
  "contains",
  "eq",
  "in",
  "range",
  "bool",
  "is_empty",
  "not_empty",
];

/**
 * Decode filters from the URL, dropping anything malformed or aimed at
 * a field that is not in the schema. A stale link should degrade to a
 * smaller filter set, never to an error.
 */
export function decodeFilters(raw: string | null | undefined, schema: EffectiveField[]): ItemFilter[] {
  if (!raw) return [];
  const byKey = new Map(schema.map((field) => [field.key, field]));

  const decoded: ItemFilter[] = [];

  for (const chunk of raw.split(",")) {
    const parts = chunk.split(":");
    if (parts.length < 2) continue;

    const key = decodeURIComponent(parts[0] ?? "");
    const op = decodeURIComponent(parts[1] ?? "") as FilterOp;
    const value = decodeURIComponent(parts[2] ?? "");
    const value2 = decodeURIComponent(parts[3] ?? "");

    const field = byKey.get(key);
    if (!field || !VALID_OPS.includes(op)) continue;

    // Only `is_empty`/`not_empty` are meaningful without a value.
    if (!value && !value2 && op !== "is_empty" && op !== "not_empty") continue;

    decoded.push({ key, op, type: field.type, value, value2 });
  }

  return decoded;
}

/** The filter operator that suits a field's type. */
export function defaultOpFor(field: EffectiveField): FilterOp {
  switch (field.type) {
    case "number":
      return "range";
    case "boolean":
      return "bool";
    case "select":
    case "multiselect":
      return "in";
    default:
      return "contains";
  }
}

/**
 * Which columns to show before the user chooses.
 *
 * Nine columns will not fit, so default to everything this category
 * defines itself plus the inherited fields that are required — the
 * ones a row is actually obliged to fill in.
 */
/**
 * Reserved column key for `items.schema_version`.
 *
 * A metadata COLUMN, not a schema field, so it is off by default and
 * lives outside the provenance grouping. The `__` prefix cannot collide
 * with a real key: the field-key grammar requires `^[a-z]`.
 */
export const SCHEMA_VERSION_COLUMN = "__schema_version";

export function defaultVisibleColumns(schema: EffectiveField[]): string[] {
  const chosen = schema
    .filter((field) => !field.inherited || field.required)
    .map((field) => field.key);

  // A category that inherits everything and requires nothing would
  // otherwise show no columns at all.
  if (chosen.length === 0) return schema.slice(0, 4).map((field) => field.key);
  return chosen;
}

/**
 * Fields present in EVERY schema — the columns a heterogeneous subtree
 * can honestly show. In practice these are the inherited ones, which is
 * the inheritance model paying off visibly.
 */
export function commonFields(schemas: EffectiveField[][]): EffectiveField[] {
  if (schemas.length === 0) return [];
  const [first, ...rest] = schemas;
  return first.filter((field) =>
    rest.every((other) => other.some((candidate) => candidate.key === field.key))
  );
}

/** Human-readable cell text for a stored value. */
export function formatCell(field: EffectiveField, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  switch (field.type) {
    case "boolean":
      return value ? "Yes" : "No";
    case "multiselect":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString() : String(value);
    default:
      return String(value);
  }
}

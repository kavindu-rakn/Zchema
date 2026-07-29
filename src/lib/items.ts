// ── Pure item-data helpers ───────────────────────────────────
// Coercion, validation and normalisation for item `data` against an
// effective schema. Dependency-free and unit-testable, like lib/schema
// and lib/tree — this is where the JSONB round-trip correctness lives,
// so it is worth being able to test without a browser.

import type { EffectiveField } from "./types";

/** Where values whose field disappeared are parked. Never hard-deleted. */
export const ORPHAN_KEY = "__orphaned";

/** True for values that mean "nothing was entered". */
export function isBlank(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

/**
 * Turn a raw form value into what should be stored.
 *
 * The important case: a number input yields `""` when cleared. Storing
 * that puts an empty string where a number belongs in JSONB, which then
 * breaks numeric sorts and comparisons. Empty becomes `null` here.
 */
export function coerceValue(field: EffectiveField, raw: unknown): unknown {
  if (raw === undefined || raw === null) return null;

  switch (field.type) {
    case "number": {
      if (raw === "") return null;
      const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
      return Number.isFinite(parsed) ? parsed : null;
    }
    case "boolean":
      return Boolean(raw);
    case "multiselect":
      if (Array.isArray(raw)) return raw.filter((item) => item !== "" && item != null);
      return isBlank(raw) ? [] : [raw];
    default: {
      const text = String(raw);
      return text.trim() === "" ? null : text;
    }
  }
}

/** Loose URL check — accepts http(s) and protocol-relative forms. */
function looksLikeUrl(value: string): boolean {
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return Boolean(url.hostname) && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Per-field validation errors, keyed by field key.
 *
 * Returns a map rather than a single message so the form can put each
 * error next to the input that caused it — one banner at the top makes
 * the user hunt for which field is wrong.
 */
export function validateItemData(
  schema: EffectiveField[],
  values: Record<string, unknown>
): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of schema) {
    const raw = values[field.key];
    const value = coerceValue(field, raw);

    // Input that was typed but could not be coerced is an ERROR, not an
    // empty field. Without this, "sixteen" in a number box coerces to
    // null, looks blank, passes validation on an optional field, and is
    // silently dropped on save.
    if (field.type === "number" && !isBlank(raw) && value === null) {
      errors[field.key] = `${field.label} must be a number.`;
      continue;
    }

    if (isBlank(value)) {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      continue;
    }

    switch (field.type) {
      case "number": {
        // Unparseable input was caught above, so this is belt-and-braces.
        if (typeof value !== "number") {
          errors[field.key] = `${field.label} must be a number.`;
        }
        break;
      }
      case "select": {
        const options = field.options ?? [];
        if (options.length > 0 && !options.includes(String(value))) {
          errors[field.key] = `“${value}” is not one of the allowed options.`;
        }
        break;
      }
      case "multiselect": {
        const options = field.options ?? [];
        const chosen = Array.isArray(value) ? value : [];
        const stray = chosen.find((item) => options.length > 0 && !options.includes(String(item)));
        if (stray !== undefined) {
          errors[field.key] = `“${stray}” is not one of the allowed options.`;
        }
        break;
      }
      case "url": {
        if (!looksLikeUrl(String(value))) {
          errors[field.key] = `${field.label} does not look like a valid URL.`;
        }
        break;
      }
      case "date": {
        if (Number.isNaN(new Date(String(value)).getTime())) {
          errors[field.key] = `${field.label} is not a valid date.`;
        }
        break;
      }
      default:
        break;
    }
  }

  return errors;
}

/**
 * The object to persist: coerced values, unknown keys dropped, blanks
 * removed unless the field is required.
 *
 * Dropping unknown keys matters — a client that posts arbitrary keys
 * would otherwise write them straight into `data`. The server actions
 * run this against a schema THEY fetched, never one supplied by the
 * caller.
 *
 * `__orphaned` is preserved: it holds values whose field was removed,
 * and losing it would defeat the point of never hard-deleting.
 */
export function normaliseForSave(
  schema: EffectiveField[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of schema) {
    const value = coerceValue(field, values[field.key]);
    if (isBlank(value)) {
      // Keep the key for required fields so the gap is explicit in the
      // stored row rather than merely absent.
      if (field.required) out[field.key] = null;
      continue;
    }
    out[field.key] = value;
  }

  const orphaned = values[ORPHAN_KEY];
  if (orphaned && typeof orphaned === "object" && Object.keys(orphaned).length > 0) {
    out[ORPHAN_KEY] = orphaned;
  }

  return out;
}

/** Values held under `__orphaned`, as entries. */
export function orphanedEntries(data: Record<string, unknown>): [string, unknown][] {
  const orphaned = data?.[ORPHAN_KEY];
  if (!orphaned || typeof orphaned !== "object" || Array.isArray(orphaned)) return [];
  return Object.entries(orphaned as Record<string, unknown>);
}

export interface Completeness {
  filled: number;
  total: number;
  missing: string[];
  missingRequired: string[];
}

/** How much of the schema this item actually fills in. */
export function completenessOf(
  schema: EffectiveField[],
  data: Record<string, unknown>
): Completeness {
  const missing: string[] = [];
  const missingRequired: string[] = [];
  let filled = 0;

  for (const field of schema) {
    if (isBlank(data?.[field.key])) {
      missing.push(field.key);
      if (field.required) missingRequired.push(field.key);
    } else {
      filled += 1;
    }
  }

  return { filled, total: schema.length, missing, missingRequired };
}

/**
 * A human-readable handle for an item: the first non-empty string field
 * in schema order, else a short id. Every table needs one.
 */
export function displayValueFor(
  schema: EffectiveField[],
  item: { id: string; data: Record<string, unknown> }
): string {
  const preferred = schema.filter((field) => field.type === "string" || field.type === "text");
  for (const field of preferred) {
    const value = item.data?.[field.key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return item.id.slice(0, 8);
}

/** Group fields by the category that defined them, root-first. */
export function groupByProvenance(
  schema: EffectiveField[]
): { sourceId: string; sourceName: string; inherited: boolean; fields: EffectiveField[] }[] {
  const groups = new Map<
    string,
    { sourceId: string; sourceName: string; inherited: boolean; fields: EffectiveField[] }
  >();

  for (const field of schema) {
    const entry = groups.get(field.source_category_id) ?? {
      sourceId: field.source_category_id,
      sourceName: field.source_category_name,
      inherited: field.inherited,
      fields: [],
    };
    entry.fields.push(field);
    groups.set(field.source_category_id, entry);
  }

  // Schema order is already (depth DESC, position, label), so insertion
  // order is root-first with own fields last.
  return [...groups.values()];
}

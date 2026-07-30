// ── Import preparation ───────────────────────────────────────
// Pure helpers that turn parsed rows plus a reviewed schema into the
// payload import_items() expects. Unit-tested alongside inference.

import type { EffectiveField, FieldType, SchemaField } from "./types.ts";
import type { InferredField } from "./inference.ts";

/** What the wizard decided to do with one incoming column. */
export interface ColumnPlan {
  /** The header as it appears in the source file. */
  header: string;
  /** Skipped columns are carried through so the summary can count them. */
  skip: boolean;
  /** The field this column writes to — existing or newly created. */
  field: SchemaField;
  /** Set when the column maps onto a field the category already has. */
  mappedTo?: "inherited" | "own" | null;
  /** For an ambiguous date column, the reading the user chose. */
  dateOrder?: "dmy" | "mdy";
}

/**
 * Normalise a cell to what the database expects.
 *
 * Dates are the reason this exists. `"03/04/2024"` must become
 * `"2024-04-03"` or `"2024-03-04"` HERE, on the client, because the
 * client is the only place that knows which reading the user picked —
 * and casting it server-side would depend on the session's DateStyle,
 * so the same file would import differently down different connections.
 */
export function normaliseCell(
  raw: string,
  type: FieldType,
  dateOrder: "dmy" | "mdy" = "dmy"
): string {
  const text = (raw ?? "").trim();
  if (text === "") return "";

  if (type !== "date") return text;

  // Already ISO — leave the time component off, the column is a date.
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso) return iso[1];

  const parts = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (!parts) return text; // Let the server reject it and report the row.

  const first = Number(parts[1]);
  const second = Number(parts[2]);
  const year = parts[3];

  // A day above 12 settles the order regardless of what was chosen —
  // the data outranks the preference.
  const [day, month] =
    first > 12 ? [first, second] : second > 12 ? [second, first] : dateOrder === "dmy" ? [first, second] : [second, first];

  if (day < 1 || day > 31 || month < 1 || month > 12) return text;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Strip the inference metadata, leaving a storable SchemaField. */
export function toSchemaField(field: InferredField | SchemaField): SchemaField {
  const {
    key,
    label,
    type,
    required,
    options,
    unit,
    help_text,
    position,
    attribute_id,
  } = field as SchemaField;

  return {
    key,
    label,
    type,
    required: Boolean(required),
    ...(options?.length ? { options } : {}),
    ...(unit ? { unit } : {}),
    ...(help_text ? { help_text } : {}),
    position: position ?? 0,
    ...(attribute_id ? { attribute_id } : {}),
  };
}

/**
 * Match incoming columns onto fields the category already has.
 *
 * By key first, then by a normalised label — `"Brand"`, `"brand"` and
 * `"Brand Name"` should all land on an inherited `brand` rather than
 * creating a near-duplicate beside it. The wizard shows every match as
 * an editable row: this proposes, it does not decide.
 */
export function matchToExisting(
  columns: { header: string; field: SchemaField }[],
  schema: EffectiveField[]
): Map<string, EffectiveField> {
  const matches = new Map<string, EffectiveField>();
  const byKey = new Map(schema.map((field) => [field.key, field]));
  const byLabel = new Map(schema.map((field) => [normalise(field.label), field]));

  for (const column of columns) {
    const exact = byKey.get(column.field.key);
    if (exact) {
      matches.set(column.header, exact);
      continue;
    }

    const byName = byLabel.get(normalise(column.field.label));
    if (byName) {
      matches.set(column.header, byName);
      continue;
    }

    // Last resort: one contains the other, e.g. "Brand" vs "Brand Name".
    // Only when the shorter side is at least four characters, or "id"
    // matches half the schema.
    const fuzzy = schema.find((field) => {
      const a = normalise(field.label);
      const b = normalise(column.field.label);
      const short = a.length <= b.length ? a : b;
      return short.length >= 4 && (a.includes(b) || b.includes(a));
    });
    if (fuzzy) matches.set(column.header, fuzzy);
  }

  return matches;
}

function normalise(value: string): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Build the row payload: only planned, non-skipped columns, keyed by
 * the field key rather than the source header.
 */
export function buildRows(
  rows: Record<string, string>[],
  plans: ColumnPlan[]
): Record<string, string>[] {
  const active = plans.filter((plan) => !plan.skip);

  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const plan of active) {
      const value = normaliseCell(row[plan.header] ?? "", plan.field.type, plan.dateOrder);
      if (value !== "") out[plan.field.key] = value;
    }
    return out;
  });
}

/** The fields that must be ADDED to the target; mapped ones already exist. */
export function fieldsToCreate(plans: ColumnPlan[]): SchemaField[] {
  return plans
    .filter((plan) => !plan.skip && !plan.mappedTo)
    .map((plan, index) => ({ ...toSchemaField(plan.field), position: index }));
}

// ── Export formatting ────────────────────────────────────────
// Pure and unit-tested. Kept out of the route handler so the escaping
// — the part that is actually easy to get wrong — can be tested without
// a request, a database, or a stream.

/** Reserved column for the item's category path. */
export const CATEGORY_COLUMN = "_category";
/** Reserved column for the item's id, so an export can be re-imported. */
export const ID_COLUMN = "_id";

// ── Formula guard (CSV injection) ────────────────────────────
// A spreadsheet reads a cell that starts with = + - @ (or a tab or CR)
// as a formula. Item data is typed by users, so a value such as
// =HYPERLINK("https://evil.example","Open") would become a live formula
// for whoever opens the export in Excel, Sheets or LibreOffice. Such a
// cell is prefixed with an apostrophe, which all three read as "this is
// text". A plain number like -5 is left alone: it is not a formula, and
// prefixing it would turn every negative price into text.
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Prefix a text value that a spreadsheet would run as a formula. */
export function guardFormula(text: string): string {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

/**
 * Undo guardFormula, so an exported file re-imports to the values it
 * was made from. Only strips an apostrophe that guardFormula would have
 * added — one directly before a formula character.
 */
export function unguardFormula(text: string): string {
  const rest = text.slice(1);
  return text.startsWith("'") && FORMULA_START.test(rest) && !PLAIN_NUMBER.test(rest)
    ? rest
    : text;
}

/**
 * Escape one CSV field per RFC 4180, after the formula guard.
 *
 * A field is quoted when it contains a comma, a quote, or a newline;
 * internal quotes are doubled. Getting this wrong does not produce a
 * visibly broken file — it produces one that opens fine and has the
 * wrong number of columns on three rows out of nine hundred.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";

  // Only strings are guarded: a number, boolean or JSON object can
  // never start with a formula character that means anything.
  const text =
    typeof value === "string"
      ? guardFormula(value)
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One CSV row, terminated with CRLF as the spec requires. */
export function csvRow(values: unknown[]): string {
  return values.map(csvEscape).join(",") + "\r\n";
}

/**
 * Flatten one item into the export's column order.
 *
 * A column the item has no value for becomes an empty cell rather than
 * being skipped — a ragged CSV is not a CSV.
 */
export function itemToRow(
  item: { id: string; category_path?: string; data: Record<string, unknown> },
  columns: string[],
  options: { includeOrphaned?: boolean } = {}
): unknown[] {
  const row: unknown[] = [item.id, item.category_path ?? ""];

  for (const column of columns) {
    row.push(item.data?.[column] ?? "");
  }

  if (options.includeOrphaned) {
    const orphaned = item.data?.__orphaned;
    row.push(orphaned && Object.keys(orphaned).length > 0 ? JSON.stringify(orphaned) : "");
  }

  return row;
}

/** Header row matching itemToRow's column order. */
export function exportHeader(
  columns: string[],
  options: { includeOrphaned?: boolean } = {}
): string[] {
  const header = [ID_COLUMN, CATEGORY_COLUMN, ...columns];
  if (options.includeOrphaned) header.push("__orphaned");
  return header;
}

/** A filename that sorts well and says what it holds. */
export function exportFilename(
  scope: string,
  format: "csv" | "json",
  stamp: string
): string {
  const slug = scope
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "export"}-${stamp}.${format}`;
}

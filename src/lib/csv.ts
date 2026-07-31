// ── CSV parsing ──────────────────────────────────────────────
// Hand-written rather than a dependency, because the requirements are
// small, fixed, and fully specified by RFC 4180 — and because the
// failure mode of a wrong CSV parser is silent: the file loads, and
// three rows out of nine hundred have their columns shifted.
//
// Handles: quoted fields, embedded delimiters, embedded newlines,
// escaped ("") quotes, CRLF and LF, a UTF-8 BOM, a trailing newline,
// and delimiter auto-detection.
//
// Deliberately NOT handled: multi-character delimiters, non-UTF-8
// encodings, and comment lines. Each would be guesswork about intent.

/** Delimiters worth guessing between. */
const CANDIDATES = [",", ";", "\t", "|"] as const;

/**
 * Guess the delimiter by field-count CONSISTENCY, not by frequency.
 *
 * Counting occurrences picks the wrong answer constantly — a comma-
 * delimited file of prose descriptions has more commas inside its
 * quoted fields than between them. The delimiter that splits every
 * line into the same number of fields is the delimiter.
 */
export function detectDelimiter(text: string): string {
  const sample = stripBom(text).split(/\r?\n/).filter((line) => line.trim() !== "").slice(0, 10);
  if (sample.length === 0) return ",";

  let best = ",";
  let bestScore = -1;

  for (const candidate of CANDIDATES) {
    const counts = sample.map((line) => parseLine(line, candidate).length);
    const first = counts[0];

    // A single column means this delimiter is simply absent.
    if (first < 2) continue;

    const consistent = counts.every((count) => count === first);
    // Prefer consistency; break ties on more columns, since a file that
    // parses consistently as 8 columns is a better read than the same
    // file parsing consistently as 2.
    const score = (consistent ? 1000 : 0) + first;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Parse a single already-isolated line. Used only by delimiter detection. */
function parseLine(line: string, delimiter: string): string[] {
  return parseRows(line, delimiter)[0] ?? [];
}

/**
 * Parse CSV text into rows of raw string cells.
 *
 * A character-by-character state machine, because a line-splitting
 * approach cannot handle a newline inside a quoted field — which is
 * exactly the case that shows up in a description column and silently
 * corrupts everything after it.
 */
export function parseRows(text: string, delimiter = ","): string[][] {
  const source = stripBom(text);
  const rows: string[][] = [];

  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source[index];

    if (quoted) {
      if (char === '"') {
        // "" inside a quoted field is one literal quote.
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }

    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }

    if (char === "\r") {
      // CRLF or a lone CR both terminate the row.
      endRow();
      index += source[index + 1] === "\n" ? 2 : 1;
      continue;
    }

    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }

    field += char;
    index += 1;
  }

  // A trailing newline must not manufacture a phantom empty row, but a
  // genuine final row without one must not be dropped.
  if (field !== "" || row.length > 0) endRow();

  return rows;
}

export interface ParsedTable {
  headers: string[];
  /** One record per data row, keyed by header. */
  rows: Record<string, string>[];
  delimiter: string;
  warnings: string[];
}

/**
 * Parse CSV text into header-keyed records.
 *
 * Ragged rows are RECONCILED, not rejected: a short row gets empty
 * cells and a long row's extra cells are collected under `_extra_N`,
 * with a warning naming the line. Refusing the whole file because line
 * 412 has a stray comma is the behaviour that makes people give up on
 * an importer.
 */
export function parseCsv(text: string, options: { delimiter?: string } = {}): ParsedTable {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const raw = parseRows(text, delimiter);
  const warnings: string[] = [];

  if (raw.length === 0) {
    return { headers: [], rows: [], delimiter, warnings: ["The file is empty."] };
  }

  const headers = dedupeHeaders(raw[0].map((header) => header.trim()), warnings);
  const rows: Record<string, string>[] = [];

  for (let line = 1; line < raw.length; line += 1) {
    const cells = raw[line];

    // A row of nothing but empty cells is a blank line, not data.
    if (cells.every((cell) => cell.trim() === "")) continue;

    if (cells.length !== headers.length) {
      warnings.push(
        `Line ${line + 1}: expected ${headers.length} columns but found ${cells.length}.`
      );
    }

    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      record[header] = cells[column] ?? "";
    });
    for (let extra = headers.length; extra < cells.length; extra += 1) {
      record[`_extra_${extra - headers.length + 1}`] = cells[extra];
    }

    rows.push(record);
  }

  return { headers, rows, delimiter, warnings };
}

/**
 * Make headers unique and non-empty.
 *
 * Duplicate headers are common in exported spreadsheets and silently
 * destroy a column when records are keyed by name, so they are
 * renamed and reported rather than left to clobber each other.
 */
function dedupeHeaders(headers: string[], warnings: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `column_${index + 1}`;
    if (!header) warnings.push(`Column ${index + 1} has no header; called "${base}".`);

    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    if (count === 0) return base;
    warnings.push(`Duplicate header "${base}" renamed to "${base} ${count + 1}".`);
    return `${base} ${count + 1}`;
  });
}

/**
 * Flatten one level of a JSON object into CSV-shaped string cells.
 *
 * One level only, joined with `_`: `specs.weight` → `specs_weight`.
 * Deeper flattening produces column names nobody recognises, and the
 * right answer for genuinely nested data is a nested schema, which is
 * not something this product models.
 */
export function flattenJsonRow(
  input: Record<string, unknown>,
  warnings: string[],
  rowLabel: string
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) {
      out[key] = "";
      continue;
    }

    if (Array.isArray(value)) {
      if (value.every((entry) => entry === null || typeof entry !== "object")) {
        // Scalars join with commas so the multiselect rule sees them.
        out[key] = value.map((entry) => String(entry ?? "")).join(",");
      } else {
        warnings.push(`${rowLabel}: "${key}" is a list of objects and was skipped.`);
      }
      continue;
    }

    if (typeof value === "object") {
      for (const [inner, innerValue] of Object.entries(value as Record<string, unknown>)) {
        if (innerValue !== null && typeof innerValue === "object") {
          warnings.push(`${rowLabel}: "${key}.${inner}" nests too deeply and was skipped.`);
          continue;
        }
        out[`${key}_${inner}`] = innerValue === null || innerValue === undefined ? "" : String(innerValue);
      }
      continue;
    }

    out[key] = String(value);
  }

  return out;
}

/** Parse a JSON array of objects into the same shape parseCsv returns. */
export function parseJson(text: string): ParsedTable {
  const warnings: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBom(text));
  } catch (error) {
    return {
      headers: [],
      rows: [],
      delimiter: "",
      warnings: [`Not valid JSON: ${(error as Error).message}`],
    };
  }

  // Tolerate the common wrappers rather than demanding a bare array.
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.items)
      ? ((parsed as Record<string, unknown>).items as unknown[])
      : Array.isArray((parsed as Record<string, unknown>)?.data)
        ? ((parsed as Record<string, unknown>).data as unknown[])
        : null;

  if (!list) {
    return {
      headers: [],
      rows: [],
      delimiter: "",
      warnings: ["Expected a JSON array of objects, or an object with an `items` or `data` array."],
    };
  }

  const rows: Record<string, string>[] = [];
  const headers: string[] = [];

  list.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      warnings.push(`Row ${index + 1} is not an object and was skipped.`);
      return;
    }
    const flat = flattenJsonRow(entry as Record<string, unknown>, warnings, `Row ${index + 1}`);
    for (const key of Object.keys(flat)) {
      if (!headers.includes(key)) headers.push(key);
    }
    rows.push(flat);
  });

  // Records from a ragged JSON array must still agree on their keys.
  for (const row of rows) {
    for (const header of headers) {
      if (!(header in row)) row[header] = "";
    }
  }

  return { headers, rows, delimiter: "", warnings };
}

// ── Search query DSL ─────────────────────────────────────────
// Pure, dependency-free, and unit-tested in query-dsl.test.ts. This is
// the piece most likely to be subtly wrong, so it is kept free of React
// and of any server call.
//
//   sony wireless              free text
//   brand:Sony                 equality
//   brand:"Herman Miller"      quoted value
//   price:>500                 comparison  (> >= < <=)
//   price:500..1200            range       (expands to gte + lte)
//   size:in(S,M,L)             set membership
//   has_5g:true                boolean — just equality on "true"
//   -discontinued:true         negation
//   brand:Sony price:>500      implicit AND
//   in:electronics             scope to a subtree, by slug
//   missing:warranty_months    items with no value for that field
//   has:warranty_months        items that do have one
//
// GOVERNING RULE: an unparseable fragment becomes FREE TEXT and records
// a note. It never throws and never blocks the search. A search box
// that rejects what you typed is a search box you stop typing into —
// and the fallback is usually what the user wanted anyway, since the
// thing they typed was probably just words.

import type { SearchFilter, SearchOperator } from "./types";

export interface ParsedQuery {
  /** Free-text terms, joined. Passed to websearch_to_tsquery as-is. */
  text: string;
  filters: SearchFilter[];
  /** Category SLUG from `in:`; the caller resolves it to an id. */
  scope: string | null;
  /**
   * Fragments that did not parse as intended, phrased for a human.
   * Advisory only — the query still runs.
   */
  errors: string[];
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/**
 * Split on whitespace, but keep quoted runs AND parenthesised sets
 * together.
 *
 * `brand:"Herman Miller" wireless` → [`brand:"Herman Miller"`, `wireless`]
 * `size:in(S, M, L)`               → [`size:in(S, M, L)`]
 *
 * Parens matter because `in(S, M, L)` — with a space after each comma —
 * is how people actually type a list, and splitting it would turn the
 * filter into four unrelated free-text words.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  let depth = 0;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")" && depth > 0) depth -= 1;

    if (!quoted && depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  // An unterminated quote or paren still yields its token — the
  // alternative is losing everything typed after the stray character.
  if (current) tokens.push(current);
  return tokens;
}

/** Strip one matching pair of surrounding double quotes. */
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/** Which operators a leading `-` can meaningfully invert. */
const NEGATABLE: Partial<Record<SearchOperator, SearchOperator>> = {
  eq: "neq",
  is_null: "not_null",
  not_null: "is_null",
};

export function parseQuery(input: string): ParsedQuery {
  const text: string[] = [];
  const filters: SearchFilter[] = [];
  const errors: string[] = [];
  let scope: string | null = null;

  for (const token of tokenize(input ?? "")) {
    const negated = token.startsWith("-") && token.length > 1;
    const body = negated ? token.slice(1) : token;

    const colon = body.indexOf(":");

    // No colon, or nothing on one side of it → free text.
    if (colon <= 0 || colon === body.length - 1) {
      text.push(token);
      continue;
    }

    const key = body.slice(0, colon).toLowerCase();
    const rawValue = body.slice(colon + 1);

    // `https://example.com` looks exactly like `key:value`. It is not.
    if (rawValue.startsWith("//")) {
      text.push(token);
      continue;
    }

    if (!KEY_RE.test(key)) {
      text.push(token);
      continue;
    }

    const value = unquote(rawValue);

    // ── in: — scope, not a filter ──────────────────────────
    if (key === "in") {
      if (negated) {
        errors.push(`“${token}” — a scope cannot be negated, so it was searched as text.`);
        text.push(token);
        continue;
      }
      if (scope !== null) {
        errors.push(`Two scopes given; using “${value}” and ignoring “${scope}”.`);
      }
      scope = value;
      continue;
    }

    // ── missing: / has: — presence, not value ──────────────
    if (key === "missing" || key === "has") {
      if (!KEY_RE.test(value)) {
        errors.push(`“${value}” is not a field name, so “${token}” was searched as text.`);
        text.push(token);
        continue;
      }
      const base: SearchOperator = key === "missing" ? "is_null" : "not_null";
      filters.push({ key: value, op: negated ? NEGATABLE[base]! : base });
      continue;
    }

    // ── Everything else is a filter on `key` ───────────────
    const parsed = parseValue(value);

    if (!parsed) {
      errors.push(`Could not read “${rawValue}” as a value, so “${token}” was searched as text.`);
      text.push(token);
      continue;
    }

    if (negated) {
      const inverted = NEGATABLE[parsed[0].op];
      if (!inverted) {
        // No honest inversion exists — notably there is no `not_in`,
        // and negating a range is two disjoint ranges, which the
        // server ANDs into nothing. Say so rather than quietly
        // returning the opposite of what was asked.
        errors.push(
          `“${token}” cannot be negated — only exact values, missing: and has: can be. It was searched as text.`
        );
        text.push(token);
        continue;
      }
      filters.push({ key, ...parsed[0], op: inverted });
      continue;
    }

    filters.push(...parsed.map((filter) => ({ key, ...filter })));
  }

  return { text: text.join(" "), filters, scope, errors };
}

/**
 * One `key:` value into one or more filters.
 *
 * Returns null when the value is malformed — a comparison against
 * something that is not a number, say — so the caller can fall back to
 * free text.
 */
function parseValue(value: string): Omit<SearchFilter, "key">[] | null {
  if (value === "") return null;

  // in(a,b,c)
  const set = /^in\((.*)\)$/i.exec(value);
  if (set) {
    const members = set[1]
      .split(",")
      .map((member) => unquote(member.trim()))
      .filter(Boolean);
    if (members.length === 0) return null;
    return [{ op: "in", value: members.join(",") }];
  }

  // 500..1200 — expands to two filters, which the server ANDs.
  const range = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(value);
  if (range) {
    const [, low, high] = range;
    // Tolerate a reversed range rather than returning nothing: someone
    // typing 1200..500 meant the same interval.
    const [from, to] =
      Number(low) <= Number(high) ? [low, high] : [high, low];
    return [
      { op: "gte", value: from },
      { op: "lte", value: to },
    ];
  }

  // >500, >=500, <500, <=500
  const compare = /^(>=|<=|>|<)\s*(.+)$/.exec(value);
  if (compare) {
    const [, symbol, operand] = compare;
    if (!NUMBER_RE.test(operand.trim())) return null;
    const op: SearchOperator =
      symbol === ">" ? "gt" : symbol === ">=" ? "gte" : symbol === "<" ? "lt" : "lte";
    return [{ op, value: operand.trim() }];
  }

  // Leading/trailing * — substring, which people type by reflex.
  if (value.length > 1 && value.startsWith("*") && value.endsWith("*")) {
    return [{ op: "contains", value: value.slice(1, -1) }];
  }
  if (value.length > 1 && value.endsWith("*")) {
    return [{ op: "starts_with", value: value.slice(0, -1) }];
  }

  return [{ op: "eq", value }];
}

/**
 * Render a parsed query back to DSL text.
 *
 * Used by the facet panel, which adds a filter by rewriting the query
 * string rather than holding a second copy of the state — two
 * representations of one search is how the URL and the UI drift apart.
 */
export function serializeQuery(query: ParsedQuery): string {
  const parts: string[] = [];
  if (query.text) parts.push(query.text);
  if (query.scope) parts.push(`in:${quoteIfNeeded(query.scope)}`);

  for (const filter of query.filters) {
    switch (filter.op) {
      case "is_null":
        parts.push(`missing:${filter.key}`);
        break;
      case "not_null":
        parts.push(`has:${filter.key}`);
        break;
      case "eq":
        parts.push(`${filter.key}:${quoteIfNeeded(filter.value ?? "")}`);
        break;
      case "neq":
        parts.push(`-${filter.key}:${quoteIfNeeded(filter.value ?? "")}`);
        break;
      case "gt":
        parts.push(`${filter.key}:>${filter.value}`);
        break;
      case "gte":
        parts.push(`${filter.key}:>=${filter.value}`);
        break;
      case "lt":
        parts.push(`${filter.key}:<${filter.value}`);
        break;
      case "lte":
        parts.push(`${filter.key}:<=${filter.value}`);
        break;
      case "in":
        parts.push(`${filter.key}:in(${filter.value})`);
        break;
      case "contains":
        parts.push(`${filter.key}:*${filter.value}*`);
        break;
      case "starts_with":
        parts.push(`${filter.key}:${filter.value}*`);
        break;
    }
  }

  return parts.join(" ");
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** A short human description of a filter, for the active-filter chips. */
export function describeFilter(filter: SearchFilter): string {
  switch (filter.op) {
    case "eq":
      return `${filter.key} is ${filter.value}`;
    case "neq":
      return `${filter.key} is not ${filter.value}`;
    case "gt":
      return `${filter.key} > ${filter.value}`;
    case "gte":
      return `${filter.key} ≥ ${filter.value}`;
    case "lt":
      return `${filter.key} < ${filter.value}`;
    case "lte":
      return `${filter.key} ≤ ${filter.value}`;
    case "in":
      return `${filter.key} is one of ${filter.value?.split(",").join(", ")}`;
    case "contains":
      return `${filter.key} contains ${filter.value}`;
    case "starts_with":
      return `${filter.key} starts with ${filter.value}`;
    case "is_null":
      return `${filter.key} is empty`;
    case "not_null":
      return `${filter.key} has a value`;
  }
}

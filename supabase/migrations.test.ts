// ── Migration drift tests ────────────────────────────────────
// Run with:  npm test
//
// The supabase/*.sql feature files are the readable source of truth;
// supabase/migrations/ is what a database actually runs. Two sources can
// drift, so this replays both — the feature files in load order, and the
// migrations in version order — and asserts they end in the same state for
// every function, policy and trigger. No database needed.
//
// It also guards two older footguns: a function left with two signatures
// (every PostgREST call to it becomes ambiguous), and a feature file that
// drops or truncates a table (re-applying it once wiped production data).
//
// Limits, by design: tables, columns and indexes are not modelled — a
// column change is an ALTER in a migration and has no feature-file twin to
// compare. And a function changed with ALTER FUNCTION is invisible here, so
// migrations must carry the full CREATE OR REPLACE instead.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SUPABASE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(SUPABASE, "migrations");

/** Load order, as in AGENTS.md. */
const FEATURE_FILES = [
  "schema",
  "functions",
  "triggers",
  "policies",
  "impact",
  "attributes",
  "search",
  "import",
  "onboarding",
  "trash",
];

const read = (path: string) => readFileSync(path, "utf8").replace(/\r/g, "");

// ── Statement splitting ──────────────────────────────────────
// Splits on top-level semicolons. Comments outside quotes are dropped;
// single-quoted strings, quoted identifiers and dollar-quoted bodies are
// kept verbatim, so a function body compares byte for byte.
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    const dollar = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      assert.notEqual(end, -1, `unterminated ${tag} quote`);
      current += sql.slice(i, end + tag.length);
      i = end + tag.length;
      continue;
    }
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === ch && sql[j + 1] === ch) j += 2; // '' or "" escape
        else if (sql[j] === ch) break;
        else j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ";") {
      if (current.trim()) out.push(current.trim());
      current = "";
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

// ── Function signatures ──────────────────────────────────────
const TYPE_ALIASES: Record<string, string> = {
  int: "integer",
  int4: "integer",
  int8: "bigint",
  bool: "boolean",
  timestamptz: "timestamp with time zone",
  varchar: "character varying",
};

function normaliseType(raw: string): string {
  const type = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const array = type.endsWith("[]") ? "[]" : "";
  const base = array ? type.slice(0, -2).trim() : type;
  return (TYPE_ALIASES[base] ?? base) + array;
}

/** Split on commas that are not inside parentheses or quotes. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The parenthesised list starting at `open`, and the index after it. */
function parenthesised(text: string, open: number): { inner: string; end: number } {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), end: i + 1 };
    }
  }
  throw new Error(`unbalanced parentheses: ${text.slice(open, open + 80)}`);
}

/** Types only, from a CREATE parameter list: "p_id UUID DEFAULT x" → "uuid". */
function signatureFromParams(params: string): string {
  return splitTopLevel(params)
    .map((param) => {
      const withoutDefault = param.split(/\s+DEFAULT\s+|\s*=\s*/i)[0];
      const tokens = withoutDefault.trim().split(/\s+/);
      if (/^(IN|OUT|INOUT|VARIADIC)$/i.test(tokens[0])) tokens.shift();
      return normaliseType(tokens.slice(1).join(" "));
    })
    .join(", ");
}

/** Types from a DROP FUNCTION list, which names no parameters. */
function signatureFromTypes(types: string): string {
  return splitTopLevel(types).map(normaliseType).join(", ");
}

// ── Replay ───────────────────────────────────────────────────
interface ObjectState {
  /** "function:name", "policy:table.name" or "trigger:table.name" → definition. */
  definitions: Map<string, string>;
  /** Function name → the signatures it currently has. */
  signatures: Map<string, Set<string>>;
}

const qualified = (schema: string | undefined, name: string) =>
  `${(schema ?? "public.").slice(0, -1)}.${name}`;

function replay(sources: { name: string; sql: string }[]): ObjectState {
  const state: ObjectState = { definitions: new Map(), signatures: new Map() };

  for (const source of sources) {
    for (const stmt of statements(source.sql)) {
      const head = squash(stmt.slice(0, 400));

      let m = /^CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)\s*\(/i.exec(head);
      if (m) {
        const name = m[1];
        const open = stmt.indexOf("(", stmt.search(new RegExp(`\\b${name}\\b`)));
        const { inner } = parenthesised(stmt, open);
        const signature = signatureFromParams(inner);
        // Keep the body exact; squash only the surrounding clauses.
        const body = /\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1?\$/.exec(stmt);
        const definition = body
          ? `${squash(stmt.slice(0, body.index))} ${body[0]} ${squash(stmt.slice(body.index + body[0].length))}`
          : squash(stmt);
        state.definitions.set(`function:${name}`, definition.trim());
        const set = state.signatures.get(name) ?? new Set<string>();
        set.add(signature);
        state.signatures.set(name, set);
        continue;
      }

      m = /^DROP FUNCTION (?:IF EXISTS )?(?:public\.)?(\w+)\s*(\((.*)\))?/i.exec(head);
      if (m) {
        const name = m[1];
        const set = state.signatures.get(name);
        if (m[2] !== undefined && set) set.delete(signatureFromTypes(m[3]));
        if (m[2] === undefined || !set || set.size === 0) {
          state.signatures.delete(name);
          state.definitions.delete(`function:${name}`);
        }
        continue;
      }

      m = /^CREATE POLICY (\w+) ON (\w+\.)?(\w+)/i.exec(head);
      if (m) {
        state.definitions.set(`policy:${qualified(m[2], m[3])}.${m[1]}`, squash(stmt));
        continue;
      }

      m = /^DROP POLICY (?:IF EXISTS )?(\w+) ON (\w+\.)?(\w+)/i.exec(head);
      if (m) {
        state.definitions.delete(`policy:${qualified(m[2], m[3])}.${m[1]}`);
        continue;
      }

      m = /^CREATE (?:OR REPLACE )?TRIGGER (\w+) .*? ON (\w+\.)?(\w+)/i.exec(head);
      if (m) {
        state.definitions.set(`trigger:${qualified(m[2], m[3])}.${m[1]}`, squash(stmt));
        continue;
      }

      m = /^DROP TRIGGER (?:IF EXISTS )?(\w+) ON (\w+\.)?(\w+)/i.exec(head);
      if (m) {
        state.definitions.delete(`trigger:${qualified(m[2], m[3])}.${m[1]}`);
      }
    }
  }
  return state;
}

const migrationFiles = readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const featureState = replay(
  FEATURE_FILES.map((name) => ({ name, sql: read(join(SUPABASE, `${name}.sql`)) }))
);
const migrationState = replay(
  migrationFiles.map((name) => ({ name, sql: read(join(MIGRATIONS, name)) }))
);

describe("migrations", () => {
  it("are named <14-digit version>_<snake_case>.sql, one per version", () => {
    assert.ok(migrationFiles.length > 0, "no migrations found");
    for (const file of migrationFiles) {
      assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/, `bad migration name: ${file}`);
    }
    const versions = migrationFiles.map((file) => file.slice(0, 14));
    assert.equal(new Set(versions).size, versions.length, "two migrations share a version");
  });

  it("start from a baseline", () => {
    assert.match(migrationFiles[0], /_baseline\.sql$/);
  });
});

describe("feature files and migrations agree", () => {
  // Reported one object per line, so a failure says exactly what to fix.
  it("define the same functions, policies and triggers", () => {
    const problems: string[] = [];
    const keys = new Set([...featureState.definitions.keys(), ...migrationState.definitions.keys()]);
    for (const key of [...keys].sort()) {
      const feature = featureState.definitions.get(key);
      const migrated = migrationState.definitions.get(key);
      if (feature === undefined) {
        problems.push(`${key}: in migrations but in no feature file`);
      } else if (migrated === undefined) {
        problems.push(`${key}: in a feature file but in no migration — add one`);
      } else if (feature !== migrated) {
        problems.push(`${key}: the feature file and the latest migration differ`);
      }
    }
    assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}\n`);
  });

  it("finds the objects it is meant to compare", () => {
    // Guards the parser: if it silently matched nothing, the test above
    // would pass vacuously.
    const count = (prefix: string) =>
      [...featureState.definitions.keys()].filter((key) => key.startsWith(prefix)).length;
    assert.ok(count("function:") >= 40, `only ${count("function:")} functions parsed`);
    assert.ok(count("policy:") >= 20, `only ${count("policy:")} policies parsed`);
    assert.ok(count("trigger:") >= 10, `only ${count("trigger:")} triggers parsed`);
  });
});

describe("function signatures", () => {
  for (const [label, state] of [
    ["feature files", featureState],
    ["migrations", migrationState],
  ] as const) {
    it(`leave every function with exactly one signature (${label})`, () => {
      const overloaded = [...state.signatures]
        .filter(([, set]) => set.size > 1)
        .map(([name, set]) => `${name}(${[...set].join(") / (")})`);
      assert.deepEqual(
        overloaded,
        [],
        "overloaded — DROP FUNCTION the old signature before creating the new one"
      );
    });
  }
});

describe("feature files are safe to re-apply", () => {
  for (const name of FEATURE_FILES) {
    it(`${name}.sql never drops or truncates a table`, () => {
      const destructive = statements(read(join(SUPABASE, `${name}.sql`))).filter((stmt) =>
        /^(DROP TABLE|TRUNCATE)\b/i.test(squash(stmt))
      );
      assert.deepEqual(destructive.map((stmt) => squash(stmt).slice(0, 80)), []);
    });
  }
});

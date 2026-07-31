# SchemaShift

**Change your data model against live records — and see exactly what breaks before it breaks.**

Most catalog tools let you edit a schema and find out afterwards. SchemaShift shows you the
blast radius first: which categories, how many items, which values will not survive, and what
should happen to each one. Then it applies the change in a single transaction and keeps a
versioned record you can diff and roll back.

It is a schema-migration tool with a catalog attached, not a catalog with a schema editor.

---

## The problem

A product catalog is a tree, and the tree is the point. `Electronics` defines `brand` and
`warranty_months`. `Laptops` inherits both and adds `screen_size_in`, `gpu`. `Smartphones`
inherits the same two and adds `battery_mah` — and cannot see a single Laptops field.

Template-based tools get this wrong in a specific way: a category gets *one* template and no
ability to add anything of its own, so `Laptops` and `Smartphones` are forced to share a schema
neither of them wants. Adding `gpu` for laptops pollutes every phone.

SchemaShift puts the schema **on the category node** and composes it down the tree:

```
blueprints (optional presets)        attributes (shared field registry)
        │ copied-from                            │ referenced-by
        ▼                                        ▼
    categories ── own_fields, overrides, parent_id
        │
        │  effective_schema = fold(ancestors.own_fields) + own_fields,
        │                     with overrides applied
        ▼
      items ── data JSONB, schema_version
        │
        ▼
  schema_versions ── immutable, append-only snapshots
```

A child may **add** fields, and **override** an inherited field's label, requiredness, options,
default, help text or position. It may **not** delete an inherited field or change its type —
the two operations that would silently invalidate data its ancestors own.

---

## What makes it interesting

**Impact analysis before the change.** Make `warranty_months` required on `Electronics` and,
before saving, you see:

```
⚠  This change affects 4 categories and 48 items.

    ● warranty_months  →  now required                    WARNING
      31 of 48 items have no value for this field and will be flagged incomplete.
      → Backfill all with [ 12 ] · Leave blank and flag incomplete

    ● screen_size_in   →  number → string                 DESTRUCTIVE
      20 items hold a value, and all 20 convert cleanly to the new type.
      → Convert values · Move to orphaned data · Delete the values

    Version 4 → 5.                        [ Cancel ]  [ Apply changes ]
```

The severity badge updates **as you type**, so you feel the risk building rather than
discovering it at the end.

**No value is ever silently lost.** A field that disappears moves its values to
`data.__orphaned.<key>`, where they stay restorable. `discard` — the only strategy that
actually deletes — is never a default and needs a separate confirmation naming the count.

**Everything destructive routes through the same machinery.** Re-parenting a category and
deleting one both open the same impact dialog, because both do the same thing to item data.
There is exactly one place where "this will break things" is explained.

**Cross-category search that means something.** The attribute registry asserts that `brand` on
Electronics and `brand` on Clothing are the same concept rather than two strings that happen to
spell alike — which is what makes `brand:Sony` across the whole catalog answerable at all.

**Import that infers.** Paste a CSV and the field types, units and enum options are worked out
for you: `"16 GB"`, `"32 GB"` becomes `type: number, unit: "GB"`. Every inference states its
evidence (*"412/500 values parse as numbers"*), and genuinely ambiguous data — `03/04/2024` —
is asked about rather than guessed.

---

## Screenshots

> **Not yet captured.** The two worth having are the **Schema tab on `Gaming Laptops`**, showing
> seven inherited fields from two ancestors above two of its own, and the **impact dialog**
> mid-change with a destructive row expanded. [`docs/DEMO.md`](docs/DEMO.md) walks to both in
> under two minutes.

---

## Setup

```bash
npm install
cp .env.example .env.local   # add your Supabase URL and anon key
npm run dev
```

Then apply the SQL **in this order** — later files depend on earlier ones:

| file | what it adds |
|---|---|
| `supabase/schema.sql` | tables, `updated_at` triggers, roles, cycle guard |
| `supabase/functions.sql` | the resolver: `get_effective_schema`, `query_items`, `move_items` |
| `supabase/triggers.sql` | field-key uniqueness, override validation, slug generation |
| `supabase/policies.sql` | row-level security |
| `supabase/impact.sql` | `analyze_schema_change`, `apply_schema_change`, rollback |
| `supabase/attributes.sql` | the shared attribute registry |
| `supabase/search.sql` | full-text vector, `search_items`, facets |
| `supabase/import.sql` | transactional import |
| `supabase/onboarding.sql` | sample catalog, hint state |

Then one seed:

| seed | shape |
|---|---|
| `seedAmazonFull.sql` | 39 categories, 4 levels, several domains — the richest |
| `seedAmazon.sql` | 8 categories, the minimal inheritance demo |
| `seedVehicle.sql` | a structurally different second domain |
| `seedStress.sql` | 50 categories, 5,000 items — **truncates**, for timings only |

Roles: `SCHEMA_ADMIN` owns the data model, `DATA_EDITOR` owns item data only, `VIEWER` reads.

### Tests

```bash
npm test          # 234 unit tests: query DSL, inference, CSV, export, tree moves
npm run build     # typecheck + production build
```

SQL suites live in `supabase/tests/` and run in the Supabase SQL editor. Each ends in a
result-set `SELECT` of PASS/FAIL rows.

---

## Architecture decisions, and why

**Schema composition lives in SQL, mirrored in TypeScript.** `get_effective_schema()` is the
authority; `resolveEffectiveSchema()` in `src/lib/schema.ts` reproduces it exactly so the editor
can preview a change without a round trip. The two must agree — a divergence surfaces as a UI
that lies about what will happen — so the algorithm comment block is kept identical in both
files.

**Type changes are per-category, never global.** You can edit a shared attribute's label and it
propagates everywhere. You cannot edit its type. A global retype could touch thousands of items
across unrelated categories at once, and *"this affects 9 categories and 1,400 items, good
luck"* is not a decision anyone can make. Type changes go through the per-category impact flow
instead, one blast radius at a time.

**Impact analysis is read-only and provably so.** `analyze_schema_change()` runs on every
keystroke, so it must never write. The test suite snapshots row counts and an MD5 of every
item's data before and after eighteen analyses and asserts they are identical.

**Application is one database function, not several calls.** Category rewrite, item remediation,
and version rows for the category *and every descendant* happen inside a single plpgsql body,
which is one transaction. A partial schema migration is the worst possible outcome; the test
suite injects a mid-transaction failure and proves zero partial state survives.

**The audit trail is append-only by omission.** `schema_versions` has SELECT and INSERT policies
and deliberately no UPDATE or DELETE policy — with RLS on, an operation with no matching policy
is denied. Rolling back v5 to v3 writes v6; v4 and v5 stay readable forever.

**Numeric comparison is guarded.** `WHERE (data->>'price')::numeric > 500` does not fail on the
rows it rejects — it fails on rows it never meant to touch, the moment one item anywhere holds
`"call for pricing"` under a key spelled `price`. Every comparison goes through `try_numeric()`,
which yields NULL instead of aborting the statement.

**Server actions re-check the role.** A Server Action is a public POST endpoint. RLS guards the
tables underneath, but every mutation also checks the caller's role server-side, because
rendering a button conditionally is a UI affordance, not a security boundary.

Fuller treatment in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). A five-minute scripted
walkthrough in [`docs/DEMO.md`](docs/DEMO.md).

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Supabase (Postgres + RLS) · Tailwind 4 ·
Base UI. No test framework — Node 24 runs TypeScript directly and ships `node:test`.

## Not built, deliberately

Attribute-level validation rules (regex, min/max); computed fields; a public read-only catalog
view; scheduled exports; multi-tenant workspaces; an approval workflow for schema changes —
though `schema_versions` already has the shape to support one.

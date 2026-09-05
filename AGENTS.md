<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Zchema — the data model, and the mistakes to avoid

## Schema lives on the category, not in a template

This is the single thing to get right. There is **no** `template_id` on a category and no
one-template-per-category relationship. If you find yourself reaching for one, stop.

```
categories ── own_fields JSONB, overrides JSONB, parent_id
                    │
                    ▼   effective_schema = fold(ancestors.own_fields) + own_fields,
                        with overrides applied
                  items ── data JSONB
```

- **`blueprints`** are optional starter presets. Applying one **copies** its fields into
  `own_fields`. `blueprint_id` is provenance only — there is no live link, and editing a
  blueprint changes nothing downstream.
- **`attributes`** are the opposite: a live registry. A field's `attribute_id` back-links to a
  shared definition, and editing that definition's label/options/unit **propagates**.
- A child may **add** fields and **override** `label`, `required`, `options`, `default`,
  `help_text`, `position` of an inherited one. It may **not** delete an inherited field or
  change its `type`.

If a task description says "template", it means either a blueprint or an attribute — work out
which, and use that word.

## Rules that are load-bearing

**Never lose an item value.** A field that disappears moves its values to
`data.__orphaned.<key>`. The only path that actually deletes is the `discard` remediation, which
is never a default and requires a separate `confirm: true`. Do not add a code path that drops a
value silently.

**Destructive operations go through impact analysis.** Schema edits, re-parenting and category
deletion all route through the same dialog. If you are adding a fourth destructive operation, it
routes through it too — do not write a second explanation of "this will break things".

**`get_effective_schema()` (SQL) and `resolveEffectiveSchema()` (TS) must agree.** The algorithm
comment block is duplicated verbatim in `supabase/functions.sql` and `src/lib/schema.ts`. Change
one, change the other in the same commit. `diffSchemas()` has the same contract against
`analyze_schema_change`.

**Every mutating server action re-checks the role.** A Server Action is a public POST endpoint.
RLS guards the tables, but `requireSchemaAdmin()` / `requireDataEditor()` is not optional —
hiding a button is a UI affordance, not a boundary.

**Guard every numeric cast on JSONB.** `(data->>'price')::numeric` aborts the whole statement the
moment one row anywhere holds `"call for pricing"`. Use `try_numeric()`.

**Validate keys before interpolating them into dynamic SQL.** `^[a-z][a-z0-9_]*$`, and values
through `%L`. An unrecognised key is ignored, not run.

## Vocabulary

`SCHEMA_ADMIN` (was TEMPLATE_ADMIN) · `DATA_EDITOR` (was DATA_CONTRIBUTOR) · `VIEWER`.
`blueprints` (was `templates`). `own_fields`, `overrides`, `effective schema`, `__orphaned`.

## Working conventions

- **Do not commit.** No `git commit`, `git add`, `git push` or `gh pr create` unless asked.
- **Tests**: `npm test` runs `node --test` over `src/**/*.test.ts` — no framework, Node 24 runs
  TypeScript directly. SQL suites in `supabase/tests/` are run by hand in the Supabase SQL
  editor and must end in a result-set `SELECT` of PASS/FAIL rows.
- **SQL load order**: `schema → functions → triggers → policies → impact → attributes → search →
  import → onboarding`. Adding a parameter to an existing function creates an *overload* — drop
  the old signature first, or every PostgREST call becomes ambiguous.
- **Seed data changes.** Do not write a test assertion that depends on a specific seed row count
  unless the test builds its own sandbox and tears it down.

Further reading: `docs/ARCHITECTURE.md` for the algorithms and the RLS matrix, `docs/DEMO.md`
for what the product is supposed to feel like.

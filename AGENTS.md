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
`data.__orphaned.<key>`. Deleting does not destroy either: a trigger copies every deleted item,
category and schema version into `public.trash` (`supabase/trash.sql`), whatever route the
delete took — the UI, a direct PostgREST call, an `ON DELETE CASCADE`. Rows deleted together
share a `batch` and `restore_trash()` puts them back as one, reconciling item data with the
schema as it is now.

Exactly two paths actually destroy data, and both demand a separate `confirm: true`: the
`discard` remediation, and `purge_trash()` (SCHEMA_ADMIN only). Neither is ever a default. Do
not add a third, and do not add a code path that drops a value silently.

**Destructive operations go through impact analysis.** Schema edits, re-parenting and category
deletion all route through the same dialog. If you are adding a fourth destructive operation, it
routes through it too — do not write a second explanation of "this will break things".

**The effective schema is resolved in three places, and all three must agree.**

| Copy | Where | Fed by |
|---|---|---|
| `get_effective_schema()` | `supabase/functions.sql` | saved categories |
| `resolve_schema_preview()` | `supabase/impact.sql` | the proposed change, in the impact dialog |
| `resolveEffectiveSchema()` | `src/lib/schema.ts` | unsaved draft state in the editor |

The algorithm comment block is identical in all three. Change one, change all three in the same
commit — the one people forget is `resolve_schema_preview()`, and it is the copy that tells the
user what their save will do. One fixture holds them together,
`supabase/tests/fixtures/resolver-cases.json`: `npm test` asserts it against the TS copy and
fails if the three comment blocks drift, and `resolver_differential_test.sql` asserts it against
both SQL copies. That file is generated — edit the fixture, run `npm run gen:resolver-sql`, and
run the result in the SQL editor. Add the case to the fixture before changing the behaviour.

`diffSchemas()` is a display diff, not impact analysis. It names which fields and properties
differ, for the history timeline; its severity is always `"safe"` and it does **not** agree with
`analyze_schema_change`. Anything that decides whether a change may go ahead asks the SQL.

**A save that would overwrite someone else's is refused, not merged.** An item save sends the
`updated_at` it loaded and the UPDATE matches on it; a schema save sends the version the editor
loaded and `apply_schema_change()` locks the category, compares, and raises SQLSTATE `PT409`
(HTTP 409 through PostgREST). A bulk edit sends one `updated_at` per selected row and
`set_item_field()` matches each one, writing the rest and naming what it skipped. All three
surface as a choice — reload, or overwrite deliberately — never as a silent last-writer-wins.
Anything new that rewrites a whole record needs the same.

**Unsaved work belongs in sessionStorage, through `src/lib/drafts.ts`.** Every accessor there is
total: storage can be absent (the server), blocked, or full, and an editor must keep working in
all three cases. `useUnsavedWarning` covers a reload or a closed tab; the App Router has no
route-change guard, so a draft is what covers navigating away inside the app. An item form folds
its draft straight back into the fields — same item, fields on screen. The schema editor and the
blueprint builder **offer** theirs instead (`useDraft`), because a days-old draft silently
presented as the saved state is how someone applies a change they never meant to.

**Authorship comes from the session, not the payload.** `items.created_by` / `updated_by` are
stamped by `stamp_item_authors()`; a client that sends its own values has them overwritten. The
same rule holds for anything else recording who did something.

**Every mutating server action re-checks the role.** A Server Action is a public POST endpoint.
RLS guards the tables, but `requireSchemaAdmin()` / `requireDataEditor()` is not optional —
hiding a button is a UI affordance, not a boundary. In SQL, `require_schema_admin()` /
`require_data_editor()` let a caller with no `auth.uid()` through only when it is a direct
database session (the SQL editor, a migration) — never as `anon` or `authenticated`. Keep that
shape; a bare `auth.uid() IS NOT NULL AND …` guard is skipped by anyone without a JWT.

**Guard every cast on JSONB.** `(data->>'price')::numeric` aborts the whole statement the moment
one row anywhere holds `"call for pricing"`. Use `try_numeric()`, `try_boolean()` and
`try_date()` (`functions.sql` §1b–1c), which return NULL instead of raising. A regex check beside
the cast in the same `WHERE` is not a guard: Postgres does not promise to evaluate it first.

**Validate keys before interpolating them into dynamic SQL.** `^[a-z][a-z0-9_]*$`, and values
through `%L`. An unrecognised key is ignored, not run.

## Vocabulary

`SCHEMA_ADMIN` (was TEMPLATE_ADMIN) · `DATA_EDITOR` (was DATA_CONTRIBUTOR) · `VIEWER`.
`blueprints` (was `templates`). `own_fields`, `overrides`, `effective schema`, `__orphaned`.

## Working conventions

- **Do not commit.** No `git commit`, `git add`, `git push` or `gh pr create` unless asked.
- **Tests**: `npm test` runs `node --test` over `src/**/*.test.ts` and `supabase/**/*.test.ts` —
  no framework, Node 24 (`.nvmrc`) runs TypeScript directly. CI runs `npm run typecheck`,
  `npm run lint` and `npm test` on every pull request; keep all three at zero. SQL suites in
  `supabase/tests/` need a live database, so they are run by hand in the Supabase SQL editor and
  must end in a result-set `SELECT` of PASS/FAIL rows.
- **Write `package-lock.json` with the npm CI uses** — CI takes the newest Node 24 (`.nvmrc`), so
  that was npm 11.19 on 2026-09-18; the job log prints it. npm 11.6 leaves the
  optional wasm peers `@emnapi/core` and `@emnapi/runtime` out of the lock, and even strips them
  from a lock that has them; CI's `npm ci` then fails with `Missing: @emnapi/… from lock file`.
  Repair it with `npx npm@11.19.0 install --package-lock-only`.
- **Database changes are migrations.** The `supabase/*.sql` feature files are the readable
  source; `supabase/migrations/` is what a database actually runs, and
  `supabase_migrations.schema_migrations` records which have run. To change the database, edit
  the feature file, run `npm run db:new -- <name>`, put the same change in the new migration,
  then `npm run db:push`. Never edit a migration that has been applied anywhere — add another.
  `supabase/migrations.test.ts` replays both and fails when they end in different states.
- **Change a function with the full `CREATE OR REPLACE`**, never `ALTER FUNCTION` — the drift
  test cannot see an ALTER. Adding a parameter creates an *overload*: drop the old signature
  first, or every PostgREST call becomes ambiguous. The drift test fails on overloads.
- **Feature files never destroy data.** No `DROP TABLE` and no `TRUNCATE` in them (the drift
  test enforces it); tables are `CREATE … IF NOT EXISTS`. Tearing everything down is
  `supabase/dev/reset.sql`, dev databases only.
- **SQL load order**: `schema → functions → triggers → policies → impact → attributes → search →
  import → onboarding → trash → invites`. The baseline migration is the first nine concatenated
  in this order; `trash` and `invites` arrived as migrations of their own. A new feature file
  goes at the end of this list AND in `FEATURE_FILES` in `supabase/migrations.test.ts`.
- **A table clients never touch is reached through functions.** `trash` and `invitations` have
  RLS on with no policies and no grants, so the only way in is a SECURITY DEFINER function that
  checks the role itself. Inside one of those, `current_user` is the owner, so
  `require_schema_admin()`'s "direct database session" branch would wave a caller with no JWT
  through: revoke EXECUTE from `anon` on every such function, and keep saying why.
- **Seed data changes.** Do not write a test assertion that depends on a specific seed row count
  unless the test builds its own sandbox and tears it down.

Further reading: `docs/ARCHITECTURE.md` for the algorithms and the RLS matrix, `docs/DEMO.md`
for what the product is supposed to feel like.

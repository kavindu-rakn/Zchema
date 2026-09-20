# Architecture

Reference-grade notes on the parts that are load-bearing. If you change one of these, the
matching implementation comment says so — they are kept in sync deliberately.

---

## 1. Schema composition

A category stores two things: `own_fields` (a `SchemaField[]`) and `overrides` (a map keyed by
inherited field key). Its **effective schema** is computed by folding the ancestor chain.

### The algorithm

`get_effective_schema(category_id)` in `supabase/functions.sql`, mirrored exactly by
`resolve_schema_preview()` in `supabase/impact.sql` and `resolveEffectiveSchema(chain)` in
`src/lib/schema.ts`:

1. Start with an empty ordered accumulator.
2. **Pass 1 — root → target.** For each ancestor in order, append every entry of its
   `own_fields`, stamped with `source_category_id`, `source_category_name`, `depth` (distance
   from the target), `inherited = depth > 0`, and `overridden_by: []`. Skip a field whose key is
   missing, empty or not a string. If a key is already in the accumulator, **skip the duplicate
   and continue** — the uniqueness trigger makes this unreachable, but the resolver must never
   throw.
3. **Pass 2 — root → target again.** For each ancestor's `overrides` object, patch any
   accumulated field whose key matches, skipping any patch that is not an object. Only `label`,
   `required`, `options`, `default`, `help_text` and `position` may be patched; any other key in
   the patch object is ignored. Append the patching category's id to `overridden_by`.
4. Sort by `(depth DESC, position ASC, label ASC, key ASC)`, so inherited fields appear above
   own fields. A position is a number or a numeric string (`try_numeric`'s rule); anything else
   counts as 0. Labels and keys compare by code point, so every implementation orders ties
   identically.

Two passes rather than one because an override may target a field defined by an ancestor
*above* the overriding category, which is not yet in the accumulator during pass 1.

The skips in steps 2 and 3 matter more than they look. The TypeScript copy is fed unsaved draft
state that no trigger has validated, so it must survive anything a user can type. And whatever
it survives, the SQL copies must survive the same way, or the preview works and the save fails.

### Why three implementations

The SQL is the authority. `resolve_schema_preview()` resolves a *proposed* category — one that
is not saved yet — so the impact dialog can compare before and after. The TypeScript exists so
the schema editor can render a live preview of an unsaved draft without a round trip per
keystroke. **They must agree**: a divergence surfaces as a UI that lies about what saving will
do.

The algorithm comment block above is identical in all three files, and `src/lib/schema.test.ts`
fails if it drifts. Behaviour is pinned by one shared fixture,
`supabase/tests/fixtures/resolver-cases.json`: `npm test` asserts it against the TypeScript
copy, and the generated `supabase/tests/resolver_differential_test.sql` asserts it against both
SQL copies. Change the fixture first, then all three implementations, in the same commit.

### Uniqueness

A field key must be unique across a category's **entire effective chain** — ancestors and
descendants both. Enforced by `validate_category_fields()` on insert or update of `own_fields`,
`overrides` or `parent_id`, which also checks that ancestor keys and descendant keys stay
disjoint. That last check catches a re-parent that would make an *existing* descendant redefine
a newly inherited field — the descendant's own trigger does not fire when its ancestor moves.

---

## 2. Override rules, and why type is excluded

A descendant may patch:

| property | may override | reason |
|---|---|---|
| `label` | ✅ | presentation |
| `required` | ✅ | a stricter child is a legitimate refinement |
| `options` | ✅ | a narrower vocabulary is a refinement too |
| `default` | ✅ | presentation |
| `help_text` | ✅ | presentation |
| `position` | ✅ | presentation |
| `key` | ❌ | item data is stored against it |
| `type` | ❌ | see below |

**Type is excluded because an override is invisible to the ancestor.** If `Laptops` could
declare `warranty_months` a `string` while `Electronics` calls it a `number`, then the same key
holds two incompatible types in one tree, and every query that touches it — sorting, filtering,
numeric comparison — has to ask which category each row came from before it can read the value.
The type is the one property the *whole subtree* has to agree on.

Changing a type is still possible; it just isn't an override. It happens on the category that
**owns** the field, through impact analysis, with every affected item measured and remediated.

**Deletion is excluded for the same reason in reverse.** A child cannot delete an inherited
field, because the ancestor's other descendants still need it. What the child can do is stop
using it — and the values it already holds stay where they are.

---

## 3. Impact severity

`analyze_schema_change(category, own_fields, overrides)` is **read-only** and returns a
`SchemaChange[]`. Severity classification:

| change | severity | what is measured |
|---|---|---|
| add optional field | `safe` | nothing |
| add required field | `warning` | every existing item lacks it, by definition |
| remove field | `destructive` | items holding a non-null, non-blank value, + 5 samples |
| type change | `destructive` | every stored value probed; `lossy_item_count` + failing samples |
| optional → required | `warning` | items with null, missing or empty values |
| required → optional | `safe` | nothing can break |
| remove a `select` option | `destructive` if any item holds it, else `warning` | items holding the removed option |
| add a `select` option | `safe` | nothing |
| label / help-text change | `safe` | nothing |
| add / remove override | `warning` if it flips `required`, else `safe` | via the underlying effect |

The affected set is the category **plus every descendant**, because inherited fields propagate
down. `blocked = true` for conditions that must never apply at all: a key colliding with an
ancestor or descendant, an override targeting a non-inherited key, a malformed field object.

### Remediation strategies

Applied by `apply_schema_change(...)`. Every destructive change **must** carry one; the function
refuses to guess.

| strategy | effect |
|---|---|
| `backfill` | write `value` into every affected item missing the key |
| `cast` | convert to the new type; anything that fails goes to `__orphaned` |
| `orphan` | move values to `data.__orphaned.<key>`, preserving them |
| `discard` | hard-delete the key. Requires `confirm: true`. Never a default |
| `leave` | do nothing; affected items simply read as incomplete |

`__orphaned` is the floor. No path through the application deletes an item value without an
explicit, separately-confirmed `discard`.

### Atomicity

Category rewrite, item remediation, version rows for the category and every descendant, and the
`items.schema_version` bump all happen inside one plpgsql function body — therefore one
transaction. `supabase/tests/apply_schema_change_test.sql` injects a trigger that fails *after*
the category and items have been rewritten and asserts that the schema, an MD5 of every item's
data, and the version count are all bit-identical afterwards.

### Versioning

`schema_versions` stores both:

- `snapshot` — the **effective** schema (`EffectiveField[]`), what the history diff renders.
- `authored` — the **authored** state (`{ own_fields, overrides }`), what rollback restores.

Both are needed. `own_fields` could be recovered from the snapshot, but `overrides` cannot: the
snapshot records the post-patch value, not which properties the patch carried. A rollback
reconstructed from `snapshot` alone would quietly rewrite the model.

Rollback writes a **new forward version**. History is never rewritten — an audit trail that can
be edited is not an audit trail. Item data is *not* reverted, and the confirm dialog says so:
restoring the shape of a schema cannot un-migrate the records inside it.

---

## 4. Row-level security

| table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `profiles` | own row; all rows for `SCHEMA_ADMIN` | own row; any row for `SCHEMA_ADMIN` |
| `blueprints` | all authenticated | `SCHEMA_ADMIN` |
| `categories` | all authenticated | `SCHEMA_ADMIN` |
| `attributes` | all authenticated | `SCHEMA_ADMIN` |
| `items` | all authenticated | `SCHEMA_ADMIN`, `DATA_EDITOR` |
| `schema_versions` | all authenticated | **INSERT only**, `SCHEMA_ADMIN` |
| `trash` | nobody | nobody — functions only (§8) |
| `invitations` | nobody | nobody — functions only (§10) |

Four details that are easy to get wrong:

**`schema_versions` is append-only by omission.** It has no UPDATE or DELETE policy at all. With
RLS enabled, an operation with no matching policy is denied — so immutability comes from the
absence of a rule rather than the presence of one. Do not add those policies later.

**Grants are revoked before being re-granted.** Supabase's default privileges `GRANT ALL` on
every new table in `public` to `anon` and `authenticated`, and those grants were applied when
`schema.sql` created the tables. `ALL` includes `TRUNCATE`, and **`TRUNCATE` is not governed by
RLS** — an authenticated VIEWER holding it could wipe a table outright. `policies.sql` strips
everything from both client roles first, then grants back exactly the DML each needs.

**`get_user_role()` is `SECURITY DEFINER`.** It reads `public.profiles`, which is itself
RLS-protected; without elevation the profiles policies that call it would recurse infinitely.

**RLS with no policy is how `trash` and `invitations` are closed.** Neither table grants a
client anything, so every read and write goes through a SECURITY DEFINER function that checks
the role itself. That inverts one thing: inside a DEFINER function `current_user` is the owner,
so `require_schema_admin()`'s "direct database session" branch would let a caller with no JWT
through. What stops that is the grant — EXECUTE is revoked from `anon` on all of them, so only
a signed-in caller, who always has an `auth.uid()`, can reach the check at all.

**Server actions re-check anyway.** A Server Action is a public POST endpoint. Every mutation
calls `requireSchemaAdmin()` or `requireDataEditor()` before touching anything. The SQL
functions do the same via `require_schema_admin()` / `require_data_editor()`. A NULL
`auth.uid()` is trusted only when the session is not `anon` or `authenticated` — the SQL editor,
the service role, a migration — since those already bypass RLS as table owner. A client with no
JWT reaches PostgREST as `anon`, so it is refused rather than waved through.

---

## 5. Search

`items.search_vector` is a **generated, stored** `tsvector` with a GIN index. Two details in the
expression are load-bearing:

- **`'english'::regconfig`, explicitly.** A generated column requires an `IMMUTABLE` expression.
  The two-argument `jsonb_to_tsvector(jsonb, jsonb)` reads `default_text_search_config` and is
  only `STABLE`, so the `ALTER` is rejected. Only the explicit-regconfig form is immutable.
- **`data - '__orphaned'`, not `data`.** `jsonb_to_tsvector` recurses into nested objects, so
  orphaned values would otherwise be searchable — and matching an item on a value whose field
  was deleted months ago, with nothing in the result explaining the match, is a bug that looks
  like magic. Search reflects the live schema.

`try_numeric()`, `try_boolean()` and `try_date()` (`functions.sql` §1b–1c) guard every cast on
item data — here, in the Items tab's filters and sorts, and in the resolver's `position` sort.
Each yields NULL for a value it cannot read. They use a regex and `CASE` rather than a
`BEGIN/EXCEPTION` block, so they stay plain `IMMUTABLE`, inlinable SQL and parallel-safe; an
exception block would open a subtransaction per row.

The **query DSL** (`src/lib/query-dsl.ts`) parses `brand:Sony price:>500 in:electronics
missing:sku` into filters plus a scope. Its governing rule: an unparseable fragment becomes free
text and records a note. It never throws and never blocks the search — a search box that rejects
what you typed is a search box you stop typing into. Negation is refused where no honest
inversion exists: `-price:>500` is not `<=500` for a row with no value at all, and there is no
`not_in`.

---

## 6. Inference

`src/lib/inference.ts`, pure and heavily tested. Type priority: `boolean` → `number` → `date` →
`url` → `multiselect` → `select` → `text` → `string`, requiring ≥95% of non-empty values to
match before a type is assigned.

Two rules exist specifically to avoid a confident wrong answer:

**The 0/1 collision.** A column of only `0` and `1` is a **number** unless the *header* says
otherwise (`is_`, `has_`, `_flag`, `_enabled`). `quantity` holding 0s and 1s is a small count;
typing it boolean turns a numeric column into checkboxes.

**The date collision.** `03/04/2024` fits both DD/MM and MM/DD. When no value in the column
disambiguates — no day above 12 — inference **refuses to pick** and the review step asks. A
guess here shifts an entire column by up to eleven months with nothing on screen looking wrong.

`multiselect` is tested *before* `select`, despite being lower in the stated priority: `"S,M"`
and `"M,L"` pass the select test as raw strings, and typing them as `select` would make `"S,M"`
a single option.

---

## 7. Conventions

- **Dates are normalised on the client.** `normaliseCell()` converts to ISO before sending,
  because the client is the only place that knows which reading the user picked for an ambiguous
  column, and casting server-side would depend on the session's `DateStyle`.
- **Dynamic SQL validates keys against `^[a-z][a-z0-9_]*$` before interpolating**, and passes
  every value through `%L`. A key that does not match is ignored rather than run.
- **Loops that update the table they iterate materialise the id list first.** The unlink trigger
  in `attributes.sql` strips the very key its predicate matches on.
- **`--border` and `--input` are different tokens.** `--border` draws decorative separators,
  which WCAG 1.4.11 exempts. `--input` draws control boundaries, which need 3:1.

---

## 8. Trash: deleting never destroys

`ON DELETE CASCADE` makes deleting one category take its whole subtree, every item in it, and
its version history. That is the plainest break of "never lose a value" in the product, so it is
now caught at the lowest level available: an `AFTER DELETE` row trigger on `items`, `categories`
and `schema_versions` copies each deleted row into `public.trash`.

**Why a trigger rather than a "soft delete" flag.** A `deleted_at` column would have to be
honoured by every read path — the Items tab, search, facets, the dashboard, impact analysis,
uniqueness checks — and one missed `WHERE` is a bug that shows deleted data to users. A trigger
leaves the live tables holding only live rows, so no read path changed at all. It also captures
routes the application does not control: a direct PostgREST `DELETE`, and cascades, which are
executed as ordinary deletes and fire their triggers.

**Batches.** Rows deleted together must restore together, so each captured row carries a
`batch`. The first design used `txid_current()` and was wrong in a way a dry run caught: one
transaction that deletes twice merged unrelated deletions into one entry. The batch now comes
from a sequence, held in a transaction-local setting, and `start_trash_batch()` clears it so
`delete_items()` and `delete_category_safely()` each begin one of their own.

**Restoring.** `restore_trash()` is all-or-nothing. Categories go back parents-first under their
original ids — the ordinary insert triggers run, so a restore that would now break a rule (a
field key an ancestor has taken since, a slug someone reused) fails with that reason rather than
half-restoring. Items are reconciled with their category's schema **as it is now**, exactly as
`move_items()` does it: a value whose field no longer exists returns under `__orphaned`.
`schema_version` is left as it was, so an item written against an older schema still says so.

**The one-way door.** `purge_trash()` is the second and last path that destroys data (the first
is the `discard` remediation). SCHEMA_ADMIN, and a separate `confirm` argument.

`TRUNCATE` fires no row triggers, which is why the seed files can replace the catalog without
filling the trash — and why they truncate `trash` too.

---

## 9. Two people, one record

Last-writer-wins was the old behaviour everywhere, and it loses work silently.

**Items** carry `updated_at` into the save, which matches on it: `UPDATE … WHERE id = $1 AND
updated_at = $2`. Zero rows means somebody got there first, and the action then reads the row to
say who. One statement, so there is no window between checking and writing.

**Schemas** cannot use a timestamp: reordering siblings touches `categories.updated_at` without
changing any schema, and an ancestor's change alters this category's effective schema without
touching its row. The version number is the honest token — `record_schema_versions()` writes one
for the category and every descendant — so the editor sends the version it loaded.
`apply_schema_change()` takes the category's row lock FIRST, then compares: a second save waits
there, sees the first one's version, and stops with SQLSTATE `PT409`.

Both surface as a choice rather than an error to dismiss. Reloading keeps the editor's draft,
and saving again re-runs impact analysis against the new schema — where anything the other
person added that this draft lacks shows up as a removal, which is precisely what that dialog is
for.

---

## 10. Invitations

An invitation names the role someone lands in and travels as a link. Three properties matter:

- **The token is stored only as SHA-256.** A copy of the table is not a set of working links,
  and a lost link is replaced rather than looked up.
- **The role is granted on confirmation, not on signup.** `claim_invitation()` runs from the
  `auth.users` trigger that fires when `email_confirmed_at` goes from NULL to set, and matches
  the invitation's address against the account's. Granting at signup would mean anyone holding
  a leaked link could take the role by typing the invited address into the form. With email
  confirmation switched off in the Supabase project, the same claim runs at insert instead —
  the weaker guarantee follows the project's own setting rather than being baked in here.
- **One open invitation per address**, enforced by a partial unique index, so inviting someone
  twice replaces the link instead of leaving two that both work.

The first account on an empty instance is still the admin, invitation or not.

---

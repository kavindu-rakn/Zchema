# Phase 5 — Schema Impact Analysis & Versioning

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **6 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> **Next.js 16.2.11.** Read `node_modules/next/dist/docs/01-app/` before touching server
> actions or caching.

**Depends on:** Phases 1, 3, 4 complete and committed.

---

## 1. This is the phase that answers "so what?"

The peer review was *"okay, cool, it's another e-commerce platform where you define templates —
no big deal."* That reaction is correct about every phase up to this one. Inheritance is good
engineering, but from the outside it still looks like CRUD with indentation.

This phase changes the category the product competes in. The pitch becomes:

> **Changing a data model against live records is the scariest routine operation in software.
> SchemaShift shows you the blast radius before you pull the trigger, executes the change with
> a chosen remediation, and keeps a versioned record you can diff and roll back.**

That is a schema-migration tool with a catalog attached, not a catalog with a schema editor.
It is also honest — every claim above is something this phase actually builds.

**Concretely:** the user makes `warranty_months` required on `Electronics` and, before saving,
sees:

```
⚠  This change affects 4 categories and 48 items.

    ● warranty_months  →  now required          WARNING
      31 of 48 items have no value.
      Sample rows: "Sony WH-1000XM5", "Anker PowerCore", "Logi MX Master" …
      → Backfill all with [ 12 ] · Leave blank and flag incomplete · Cancel

    ● screen_size_in   →  number → string       DESTRUCTIVE
      20 items hold numeric values. 20 will cast cleanly, 0 will not.
      → Convert values · Move to orphaned data · Cancel

    ● has_rgb          →  removed                DESTRUCTIVE
      8 items hold a value. Nothing is deleted — values move to orphaned
      data and can be restored.
      → Move to orphaned · Cancel

    Version 4 → 5.                        [ Cancel ]  [ Apply changes ]
```

Nobody expects that in a project like this. Build it well; it is the demo.

---

## 2. Increment 1 — `analyze_schema_change` in SQL

New file `supabase/impact.sql`.

```sql
CREATE OR REPLACE FUNCTION public.analyze_schema_change(
  p_category_id   UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB
) RETURNS JSONB
```

**Returns**

```jsonc
{
  "category_id": "...",
  "current_version": 4,
  "next_version": 5,
  "affected_categories": [ { "id": "...", "name": "Laptops", "depth": 1, "item_count": 20 } ],
  "total_affected_items": 48,
  "changes": [ /* SchemaChange[] — see Phase 1 §3 */ ],
  "max_severity": "destructive",
  "blocked": false,
  "blocked_reason": null
}
```

**Algorithm**

1. Resolve the current effective schema. Resolve the proposed one by substituting the new
   `own_fields` / `overrides` for this category. Diff by key.
2. Compute the affected set: this category **plus every descendant** (`get_category_subtree`),
   since inherited fields propagate down. Only descendants that do not shadow the key are
   affected — with the Phase 1 uniqueness trigger, none can, but structure the query so it
   stays correct if that rule ever loosens.
3. For each change, classify and measure against real item data:

| Change | Severity | Measure |
|---|---|---|
| Add optional field | `safe` | affected count only |
| Add required field | `warning` | items lacking the key |
| Remove field | `destructive` | items holding a non-null value, + 5 sample values |
| Type change | `destructive` | attempt the cast per value; report `lossy_item_count` and up to 5 failing samples |
| Optional → required | `warning` | items with null/missing/empty |
| Required → optional | `safe` | 0 |
| Remove a `select` option | `destructive` | items holding the removed option |
| Add a `select` option | `safe` | 0 |
| Label / help text change | `safe` | 0 |
| Add / remove override | `warning` if it changes `required`, else `safe` | as per the underlying effect |

Type-cast probing: use a `SECURITY DEFINER` helper `try_cast(value JSONB, target TEXT)`
returning `NULL` on failure, wrapping each attempt in a `BEGIN … EXCEPTION WHEN others THEN
RETURN NULL; END` block. Do **not** attempt this in application code — round-tripping every
item value to the client to test castability defeats the point.

4. Set `blocked = true` for conditions that must never be applied: a new key colliding with an
   ancestor or descendant, an override targeting a non-inherited key, malformed field objects.
   Populate `blocked_reason` with something a human can act on.

**This function is read-only.** It must not write. Verify by calling it and confirming no rows
change.

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(db): schema change impact analysis function`

---

## 3. Increment 2 — `apply_schema_change` with remediation

```sql
CREATE OR REPLACE FUNCTION public.apply_schema_change(
  p_category_id    UUID,
  p_new_own_fields JSONB,
  p_new_overrides  JSONB,
  p_remediations   JSONB,   -- { "<field_key>": { "strategy": "...", "value": ... } }
  p_changed_by     UUID
) RETURNS JSONB
```

**Strategies**

| Strategy | Effect |
|---|---|
| `backfill` | Write `value` into every affected item missing the key |
| `cast` | Convert existing values to the new type; anything that fails to cast goes to `__orphaned` |
| `orphan` | Move values to `data.__orphaned.<key>`, preserving them |
| `discard` | Hard-delete the key. Only permitted with an explicit confirm flag; never the default |
| `leave` | Do nothing; items become incomplete and are flagged |

**Must-haves**

1. **One transaction.** Re-run `analyze_schema_change` inside it and abort if `blocked` became
   true (the tree may have changed since the dialog opened). Abort if a `destructive` change
   arrives with no remediation specified — refuse to guess.
2. Update `categories.own_fields` / `overrides`.
3. Apply remediations to items across the affected subtree.
4. Insert a `schema_versions` row: `version = current + 1`, `snapshot` = the new effective
   schema, `change_summary` = the analysis `changes[]` with the chosen strategies recorded.
   Do the same for **every affected descendant**, since their effective schema changed too.
5. Bump `items.schema_version` for every touched item.
6. Return `{ version, items_updated, items_orphaned, items_incomplete }` for the success toast.

Also add `rollback_schema_version(p_category_id UUID, p_target_version INT)` — restores
`own_fields`/`overrides` from a snapshot and writes a **new forward version** recording the
rollback. Never rewrite history; an append-only audit trail that can be edited is not an audit
trail. Item data is *not* reverted; state that plainly in the confirm dialog.

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(db): apply schema change with remediation strategies`

---

## 4. Increment 3 — The impact dialog

`src/components/data-center/impact-dialog.tsx`. Opened by "Review changes" on the schema
editor (Phase 3 wired the call site for exactly this swap).

**Structure**
- Header: severity summary — *"4 categories · 48 items · 1 destructive change"*, colour-keyed.
- One card per change, sorted **destructive → warning → safe**:
  - Field name, `from → to` rendered as a visual delta.
  - Severity chip.
  - A plain-language sentence. Never *"31 items affected"* alone — write
    *"31 of 48 items have no value for this field and will be flagged incomplete."*
  - Sample values as chips, with a "view all N" link opening the Items tab pre-filtered.
  - A remediation radio group, defaulting to the **safest** option, never to `discard`.
- Safe changes collapse into a single summary line: *"3 safe changes"*, expandable.
- Footer: `Version 4 → 5`, `Cancel`, and a primary button that is **disabled until every
  destructive change has a remediation selected**.
- If `blocked`, replace the footer with the reason and a single `Close`.

**Behaviour**
- Debounced live analysis while editing (400ms) driving a persistent severity badge on the
  "Review changes" button — the user should feel the risk building *as they type*, not
  discover it at the end. This is the detail that makes the feature feel alive.
- Post-apply toast with real numbers and an `Undo` that calls `rollback_schema_version`.
- On failure, keep the dialog open with the draft intact.

**Guard the whole flow behind `SCHEMA_ADMIN` server-side**, not just by hiding the button.

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(schema): blast-radius impact dialog with remediation choices`

---

## 5. Increment 4 — History tab and schema diff

The fourth detail-pane tab, finally real.

**Timeline** — newest first, one row per version: `v5 · 2 days ago · kvn · +1 field, 1 retyped`
with a severity dot. Expanding shows the recorded `change_summary` including which remediation
was chosen and how many items each touched.

**Diff view** — pick any two versions:

```
        v3                              v5
  ▪ brand           string    ═   ▪ brand           string
  ▪ warranty_months number    ~   ▪ warranty_months number  required   ← changed
  ▪ has_rgb         boolean   −                                        ← removed
                              +   ▪ refresh_rate_hz number             ← added
```

Field-level, colour-coded, with a "changed" row showing which properties differ. Reuse
`diffSchemas()` from `src/lib/schema.ts` so the diff shown here and the diff computed for the
impact dialog cannot drift apart.

**Actions** — `Restore this version` (calls `rollback_schema_version`, with a dialog stating
that item data is unaffected) and `Export snapshot as JSON`.

**Stale items** — a strip showing `12 items were written against v3 and older`, linking to the
Items tab filtered by `schema_version`. Add a `schema_version` column to that table's optional
columns.

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `feat(history): version timeline with visual schema diff and rollback`

---

## 6. Increment 5 — Impact for structural operations

Route the destructive operations Phases 3 and 4 stubbed through the same machinery, so there
is exactly one place where "this will break things" is explained.

1. **Reparenting** — Phase 3 shipped a plain-language warning. Replace it with a real analysis:
   which inherited fields are lost, which are gained, how many items in the moved subtree hold
   values for the lost fields, and the remediation choice. Reuse `impact-dialog.tsx` with a
   different analyser input.
2. **Deleting a category** — show subtree counts and item counts, and offer
   `Move items to parent` (running the field-intersection logic from Phase 4's `moveItems`) as
   an alternative to cascade deletion. Cascade-deleting 48 items behind a plain
   `confirm()` — which is what the code does today — is the single most dangerous thing in the
   app.
3. **Deleting a blueprint** — trivial now (`SET NULL`), but state the count of categories that
   used it as a starting point.
4. **Bulk item delete** — a typed confirmation past 20 rows.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `feat(impact): route reparent and delete operations through impact analysis`

---

## 7. Increment 6 — Verification

Impact analysis that is *wrong* is worse than none — it manufactures false confidence before a
destructive act. Test it properly.

1. `supabase/tests/impact_test.sql` — for each row of the severity table in Increment 1,
   construct the scenario against seed data, call `analyze_schema_change`, and assert the
   severity and counts. Include the awkward ones:
   - retype `number → string` where all values cast cleanly (lossy = 0)
   - retype `string → number` where some values are `"12 months"` (lossy > 0)
   - remove a `select` option that 3 items currently hold
   - add a required field to a category whose descendants hold 48 items
   - a change on a leaf with zero items (all counts 0, still valid)
2. `apply_schema_change` round-trip tests: apply each strategy, assert item data landed as
   promised, assert a `schema_versions` row exists for the category **and each descendant**,
   assert `items.schema_version` bumped.
3. Assert `analyze_schema_change` wrote nothing — snapshot `count(*)` and a checksum of
   `items.data` before and after.
4. Assert `apply_schema_change` rolls back **entirely** when a mid-transaction failure is
   injected. A partial schema migration is the worst possible outcome; prove it cannot happen.
5. Paste all output into the increment summary. Do not report a passing test you did not run.

✋ **Increment 6 complete — please review and commit manually.**
Suggested message: `test(impact): SQL test suite for analysis and application`

---

## 8. Definition of done for Phase 5

- [ ] Every severity classification in the Increment 1 table has a passing test
- [ ] `analyze_schema_change` provably writes nothing
- [ ] `apply_schema_change` is atomic; injected failure leaves zero partial state
- [ ] Destructive changes cannot be applied without an explicit remediation choice
- [ ] `discard` is never a default and requires a separate confirm
- [ ] No item value is ever silently lost — `__orphaned` is the floor
- [ ] History tab diffs any two versions; rollback writes a new forward version
- [ ] Live severity badge updates as the schema is edited
- [ ] Reparent and delete both route through impact analysis
- [ ] `npm run build` passes
- [ ] No `git commit` was run by the agent at any point

## 9. Out of scope

Attribute library and cross-category search (Phase 6). Schema inference (Phase 7). Scheduled
or background migrations — everything here is synchronous and transactional, which is correct
at this data scale.

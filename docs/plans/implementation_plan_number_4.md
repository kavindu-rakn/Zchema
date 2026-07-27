# Phase 4 — The Items Workspace

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **5 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> **Next.js 16.2.11.** Read `node_modules/next/dist/docs/01-app/` before touching server
> actions, `revalidatePath`, or `useSearchParams`.

**Depends on:** Phases 1–3 complete and committed.

---

## 1. What changes

Items previously rendered against `category.template.fields` — a flat list from one template.
They now render against `get_effective_schema(category_id)` — a composed list where each field
knows where it came from. Every surface that touches item data has to be rebuilt on that.

Two questions must be answerable on every screen in this phase:

1. **"Which fields here are mine and which came from above?"** → provenance in the table and
   the form.
2. **"Do my items still match the schema?"** → completeness and orphan surfacing.

Nothing else here is novel. Keep it tight and finish it.

---

## 2. Increment 1 — Dynamic form on the effective schema

Rewrite `src/components/dynamic-form.tsx`.

**Correctness fixes carried over from the current implementation:**

- It validates only via the browser's `required` attribute. Add real validation: type
  coercion, `select` value ∈ `options`, number bounds if present, URL shape for `url`.
  Return per-field errors, not one banner at the top.
- `initialData` is spread into `useState` once, so the form does not reset when the dialog is
  reused for a different item. Key the form on item id, or reset on `initialData` change.
- Number inputs store `""` for empty, which lands in the JSONB as an empty string where a
  number is expected. Normalise to `null` on submit and strip keys whose value is `null`
  **unless** the field is required.

**New behaviour:**

- Group by provenance: `Inherited from Electronics` / `Inherited from Laptops` /
  `Defined on Gaming Laptops`. Collapsible groups, defaults expanded. Required fields never
  hide inside a collapsed group — hoist any group containing an unfilled required field.
- Honour `default`, `help_text` (below the input), `unit` (input suffix), `position`.
- Support the expanded `FieldType` union: `text` → `<Textarea>`, `multiselect` → multi-select
  with chips, `url` → input with pattern validation and an open-link affordance.
- **Orphaned data.** If `data.__orphaned` is non-empty, render a collapsed
  *"3 values from removed fields"* section: read-only key/value pairs, each with
  `Restore as field` (admin only — creates the field on this category) and `Discard`.
  Making orphaned data visible and recoverable is what earns the right to never hard-delete.
- Autosave draft to `sessionStorage` keyed by category + item id, so an accidental dialog
  close does not lose a half-filled form. Clear on successful submit.

Keep it a controlled component with an `onSubmit(data)` contract so the dialog, the inline
row editor, and the bulk editor can all reuse it.

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(items): rebuild dynamic form on effective schema with provenance`

---

## 3. Increment 2 — Items data table

Rewrite `src/components/items-data-table.tsx` as
`src/components/data-center/items-table.tsx`.

**Columns**
- Derived from the effective schema. Header cells carry a small source indicator — a muted
  parenthetical `(Electronics)` or a tinted top border keyed to the source depth.
- **Column visibility control**: nine columns will not fit. A dropdown with checkboxes,
  grouped by source category, defaulting to: all own fields + required inherited fields.
  Persist per category to `localStorage`.
- A pinned first column showing the item's "display value" — the first `string` field in the
  effective schema, or the item id prefix if none. Every table needs a human-readable handle.
- A completeness indicator column: `7/9` with a tooltip listing missing fields; red when a
  **required** field is missing.

**Behaviour**
- Sort by any column (JSONB-aware: numbers numerically, dates chronologically, booleans
  grouped, strings by locale). Sort server-side via `data->>'key'` with a cast, so it stays
  correct beyond the current page.
- Per-column filters: text contains, number range, select multi-choice, boolean tri-state.
  Encode active filters in the URL so a filtered view is shareable.
- Server-side pagination, 50/page. The current implementation fetches every item in the
  category and filters client-side; that is fine at 20 items and not at 2,000.
- Row selection with a header checkbox → bulk actions bar (delete, set field value, move to
  another category).
- Row click opens a detail sheet (view/edit). Double-click a cell for inline edit of that
  single field — optimistic update with rollback on failure.
- Density respects the Appearance setting from Phase 2.
- Empty state distinguishes *no items* from *no matches for these filters*, and the former
  offers "Add the first item" plus "Import from CSV" (wired in Phase 7).

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(items): server-paginated table with provenance-grouped columns`

---

## 4. Increment 3 — Item CRUD and server actions

`src/app/(dashboard)/data-center/[categoryId]/items/actions.ts`:

```ts
createItem(categoryId, data)
updateItem(itemId, data)
deleteItem(itemId)
deleteItems(itemIds[])            // bulk
moveItems(itemIds[], targetCategoryId)
setFieldValue(itemIds[], key, value)   // bulk edit
restoreOrphanedValue(itemId, key)
discardOrphanedValue(itemId, key)
```

Every one of them must:

1. **Re-check the caller's role server-side.** `DATA_EDITOR` or `SCHEMA_ADMIN` for writes.
   Do not rely on the UI having hidden the button, and do not rely on RLS alone — return a
   clear error rather than a Postgres policy violation.
2. **Validate against the effective schema fetched server-side**, never against a schema
   passed in from the client. A client-supplied schema is a trivial way to write arbitrary
   keys into `data`.
3. **Strip unknown keys** from `data`, except `__orphaned`.
4. **Stamp `schema_version`** with the category's current version at write time.
5. `revalidatePath` the specific category route only.

**`moveItems` needs care.** Moving an item between categories means its data was written
against a different schema. Compute the intersection: keys present in both effective schemas
carry over; keys only in the source schema go to `__orphaned`; required keys only in the
target are left empty and the item is flagged incomplete. Show all three counts in the confirm
dialog before executing. Do it in a single transaction via an RPC.

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(items): server-validated CRUD with bulk and move operations`

---

## 5. Increment 4 — Subtree item view

Currently a category page shows only items filed directly on that node — so `Electronics`
shows `0 items` while its children hold 48. That reads as a bug even though it is technically
correct, and it is visible in the current screenshots.

Add a toggle on the Items tab: **`This category`** / **`Include subcategories`**.

- When including the subtree, add a `Category` column showing the owning node, linked.
- Columns become the **intersection** of all effective schemas in the subtree (the fields every
  item is guaranteed to have), with a note: *"Showing 3 fields common to all 4 subcategories.
  Switch to a single category to see its full schema."* This is the honest way to present a
  heterogeneous set, and it makes the inheritance model pay off visibly — the common columns
  are exactly the inherited ones.
- Editing from the subtree view opens that item's own category's full form.
- Default the toggle to `Include subcategories` when the node has children **and** zero direct
  items. That single default removes the "why is this empty" reaction entirely.

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `feat(items): subtree item view with common-column intersection`

---

## 6. Increment 5 — Completeness and item health

1. `get_incomplete_items(p_category_id UUID, p_include_subtree BOOLEAN)` — items missing a
   value for any `required` field in their effective schema. Implement in SQL so the dashboard
   can call it cheaply across the whole tree.
2. Items tab header strip: `48 items · 5 incomplete · 2 with orphaned data`, each segment a
   one-click filter.
3. Bulk "fix incomplete" flow: filter to incomplete items, pick a field, set one value for all
   selected. This is the fastest path out of the mess a required-field addition creates, and
   Phase 5's impact dialog will link straight to it.
4. Feed the Phase 2 dashboard attention panel with real numbers from these queries — it was
   built against placeholders.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `feat(items): completeness tracking and bulk fix flow`

---

## 7. Definition of done for Phase 4

- [ ] Form renders inherited and own fields in labelled provenance groups
- [ ] All eight field types render, validate, and round-trip through JSONB correctly
- [ ] Empty number inputs store `null`, not `""`
- [ ] Table sorts and filters **server-side**; correct beyond page 1
- [ ] Column visibility persists per category
- [ ] Every server action re-checks role and validates against a server-fetched schema
- [ ] `moveItems` reports carried / orphaned / missing counts before executing
- [ ] `Electronics` no longer reads `0 items` when its subtree holds 48
- [ ] Orphaned data is visible and restorable, never silently lost
- [ ] `npm run build` passes
- [ ] No `git commit` was run by the agent at any point

## 8. Out of scope

Impact analysis and versioning UI (Phase 5). Cross-category search (Phase 6) — the table's
filters stay scoped to the selected category or its subtree. CSV import (Phase 7) — leave the
button visible and disabled.

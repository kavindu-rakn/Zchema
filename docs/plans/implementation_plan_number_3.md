# Phase 3 — The Real Tree & The Schema Composition UI

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **5 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> **Next.js 16.2.11.** Read `node_modules/next/dist/docs/01-app/` before touching server
> actions, `revalidatePath`, or `useSearchParams` usage.

**Depends on:** Phases 1 and 2 complete and committed.

---

## 1. What this phase is for

This is the phase where the inheritance model becomes **visible**. Phase 1 made it true in the
database; nobody can see a database. Two surfaces do the work:

- **The tree** — makes the hierarchy legible at a glance. Fixes "everything is dumped in flat
  sections with no link between parent and child."
- **The schema tab** — makes inheritance legible per node, and makes "a child can add its own
  attributes" an obvious, one-click thing. Fixes the original modelling complaint at the UI level.

If someone opens the app after this phase and cannot immediately tell that `Gaming Laptops`
gets `brand` from `Electronics`, the phase has failed regardless of what compiles.

---

## 2. Increment 1 — The tree, properly

Replace `src/components/category-tree.tsx` entirely with
`src/components/data-center/category-tree.tsx`. The existing one has three defects worth
naming so they are not reproduced:

- `TreeNode` is **defined inside** the parent component body, so it is a new component type on
  every render — React unmounts and remounts the whole subtree, which is why expansion state
  feels unstable. Hoist it to module scope.
- Expansion state is `useState` **inside each node**, so it resets on every parent re-render
  and cannot be controlled (no expand-all, no auto-expand-to-match).
- Nesting is conveyed only by `paddingLeft`. With one level that reads fine; with three it
  is guesswork.

**Requirements**

*Structure*
- Lift expansion into a single `Set<string>` in the rail, persisted to `localStorage`.
- Auto-expand the ancestor chain of the currently selected node on mount and on navigation.
- Default state: roots expanded, deeper levels collapsed.

*Visual hierarchy* — this is the actual fix for the complaint:
- **Indent guides**: a 1px vertical line per ancestor level, running the full height of the
  child block, with a short elbow into each node. This is what makes parent→child readable
  without counting pixels.
- Chevron (rotates on expand) separate from the row's click target, so clicking the **name**
  selects the node and clicking the **chevron** expands it. Conflating them is a common and
  irritating bug.
- Per row: chevron · icon (from `category.icon`, tinted `category.color`) · name ·
  field-count chip (`2+3` meaning 2 own, 3 inherited) · item count, right-aligned and muted.
- Selected row: filled background + left accent bar. Hover: subtle background only.
- A node with children but zero own fields is a *pure grouping node* — render its name in
  muted weight so the tree distinguishes organisation from definition.

*Interaction*
- Hover reveals `+` (add child) and `⋯` (rename, duplicate, move, delete) — admin only.
  Reserve the space so rows do not reflow on hover.
- **Keyboard navigation** over the flattened visible list: `↑`/`↓` move, `→` expand or descend,
  `←` collapse or ascend, `Enter` open, `Home`/`End` jump. `role="tree"`, `role="treeitem"`,
  `aria-expanded`, `aria-level`, `aria-selected`. Roving `tabIndex`.
- **Filter box**: fuzzy match on name; show matches **plus their ancestor chains** so results
  keep their context, auto-expand to reveal them, and highlight the matched substring.
  Filtering a tree into a flat list throws away the only thing a tree is good for.

*Performance* — memoise `TreeNode` with `React.memo`, key on `id`, and derive the flattened
visible list with `useMemo`. Do not virtualise; the dataset does not warrant it.

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(tree): rebuild category tree with indent guides and keyboard nav`

---

## 3. Increment 2 — Category create/edit flow

Replace the current single dialog (name + template select) with a flow that matches the new
model.

**Creating a category** — a sheet, not a cramped dialog, because there is now a real choice
to make:

```
New category under  Electronics ›

  Name          [ Laptops                    ]
  Description   [ optional                   ]
  Icon / Colour [ 🖥  ] [ ● ● ● ● ● ]

  Fields
  ┌──────────────────────────────────────────────────────┐
  │ Inherits 3 fields from Electronics                   │
  │   brand · model_number · warranty_months             │
  └──────────────────────────────────────────────────────┘

  Start from
  ( ) Inherited fields only          ← default
  ( ) Inherited + a blueprint's fields   [ Physical Goods ▾ ]
  ( ) Inherited + fields I define now

  [ Cancel ]                          [ Create category ]
```

Key points:

- **Show what will be inherited before the category exists.** Resolve the parent's effective
  schema and display it read-only. This single panel teaches the entire mental model at the
  exact moment the user needs it, and it is the answer to "the flow doesn't align with the
  real world" — you are told what you already have before being asked what to add.
- Blueprint selection **copies** fields into `own_fields`; say so inline
  (*"Copies 4 fields. Later edits to the blueprint won't affect this category."*).
- Live slug preview under the name field; live duplicate-name check against siblings.
- Root creation is the same sheet with the inherit panel replaced by
  *"Root category — defines its own fields from scratch."*

**Editing** reuses the sheet minus the "start from" block. **Moving** (reparenting) gets its
own dialog because it is consequential: pick a new parent from a tree picker, then show
*"`screen_size` and `gpu` stay. `brand` and `warranty_months` will be replaced by
`Vehicles`' fields. 8 items hold values for `brand` — those values will be moved to orphaned
data."* Block the move if the new parent's chain collides with a key this subtree defines,
and name the colliding key. Full impact machinery arrives in Phase 5; a correct blocking check
plus a plain-language warning is enough here.

**Deleting** — `ON DELETE CASCADE` means deleting `Electronics` silently destroys four
categories and 48 items. Require the user to type the category name to confirm, and state the
exact counts above the input.

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(data-center): category create, edit, move and delete flows`

---

## 4. Increment 3 — The Schema tab

`src/components/data-center/schema-editor.tsx`. This is the most important screen in the app.

**Layout — two columns, editor left, live preview right.**

```
Schema · Gaming Laptops                        9 fields  (7 inherited · 2 own)

┌─ INHERITED ────────────────────────────────┐  ┌─ PREVIEW ──────────────┐
│ from Electronics                    ⌃      │  │ The form a Data Editor │
│  ▪ brand           string  required        │  │ will see:              │
│  ▪ model_number    string           [⤵]   │  │                        │
│  ▪ warranty_months number   required ●     │  │  Brand *      [_____]  │
│      overridden here: label, required      │  │  Model no.    [_____]  │
│                                     [↺]   │  │  Warranty *   [_____]  │
│ from Laptops                        ⌃      │  │  Screen size  [_____]  │
│  ▪ screen_size_in  number                  │  │  RAM (GB)     [_____]  │
│  ▪ ram_gb          number  required        │  │  ...                   │
│  ▪ cpu             string                  │  │                        │
│  ▪ gpu             string                  │  └────────────────────────┘
└────────────────────────────────────────────┘
┌─ DEFINED HERE ─────────────────────────────┐
│  ⠿ refresh_rate_hz  number   required  ✎ 🗑 │
│  ⠿ has_rgb          boolean            ✎ 🗑 │
│                                            │
│  [ + Add field ]  [ ⊞ From attribute library ]  [ ⧉ From blueprint ] │
└────────────────────────────────────────────┘

                                    [ Discard ]  [ Review changes → ]
```

**Inherited section**
- Grouped by source category, each group header linking to that category, collapsible.
- Rows are read-only. Two actions: `⤵` **Override here** and, once overridden, `↺` **Revert**.
- An overridden field is visually marked (dot + a one-line "overridden here: label, required")
  so it is obvious this node is diverging from its parent.
- The override editor exposes **only** `label`, `required`, `options`, `default`, `help_text`.
  `key` and `type` render as disabled inputs with a tooltip: *"Type is fixed by
  `Electronics`. Changing it would invalidate stored item data."* Explaining the *why* here
  prevents the user filing it as a missing feature.

**Defined-here section**
- Full editor: drag to reorder (`framer-motion`'s `Reorder` is already a dependency and is
  already used in `template-builder.tsx` — reuse that pattern), inline edit, delete.
- Adding a field auto-derives `key` from `label` (`Screen Size` → `screen_size`), editable
  until first save, then locked. Live validation: pattern, and collision against the **whole
  effective chain** — the error must say where the conflict is
  (*"`brand` is already defined by Electronics"*), not just "duplicate key".
- `select`/`multiselect` get an options editor with paste-multiline support.

**Live preview**
- Render the real `<DynamicForm>` in disabled mode against the resolved effective schema.
- Inherited inputs get a subtle left border tint; own fields get the accent. One legend line.
- This is the highest-value element on the page: it collapses "edit schema" and "see result"
  into one glance, and it is the thing to screenshot when someone says "so what does it do?"

**Saving**
- Local draft state; the page is dirty-tracked with an unsaved-changes guard on navigation.
- The button says **"Review changes"**, not "Save" — in Phase 5 it opens the impact dialog.
  For this phase, wire it to a simple confirm listing added/removed/renamed fields, computed
  by `diffSchemas()` from `src/lib/schema.ts`. Keep the call site identical to what Phase 5
  will need so that phase is a swap, not a rewrite.

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(schema): inheritance-aware schema editor with live preview`

---

## 5. Increment 4 — Inheritance visualisation

Small, cheap, disproportionately effective for demos.

1. **Field provenance popover.** Clicking any inherited field row shows the chain that
   produced it: `Electronics ▸ defined here` → `Laptops ▸ inherited` →
   `Gaming Laptops ▸ overridden (label, required)`. It answers "where did this come from"
   in one click.
2. **Tree hover preview.** Hovering a tree node for ~500ms shows a small card: effective
   field count, the first five field names, item count.
3. **"Inheritance flow" panel on the Overview tab.** A compact SVG: the ancestor chain as
   stacked bands, each band listing the fields it contributes, with the total accumulating
   downward. Static SVG, no library, ~120 lines. This is the single clearest picture of what
   the product does — put it above the fold on Overview.

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `feat(schema): field provenance popover and inheritance flow diagram`

---

## 6. Increment 5 — Blueprint library rework

`/data-center/blueprints`, reusing the Data Center shell (list rail + detail pane).

1. Reframe the copy throughout: blueprints are **starting points**, not owners. The library
   header carries the one-liner from Phase 2 and each blueprint card shows
   *"Used as a starting point by 3 categories"* (via `categories.blueprint_id`) — provenance,
   explicitly not a live link.
2. Reuse `template-builder.tsx` as `blueprint-builder.tsx`, updated for the expanded
   `FieldType` union and the `position` / `help_text` / `unit` fields.
3. **"Apply to category"** action: pick a target, preview the merge (which fields are added,
   which are skipped because the chain already has that key), confirm. Skipped fields must be
   listed with their reason.
4. **"Save as blueprint"** from any category's schema tab — extracts `own_fields` into a new
   blueprint. This is how a blueprint library actually gets built in practice: by promoting
   something that already worked, not by authoring in the abstract.
5. Deleting a blueprint is now safe (`ON DELETE SET NULL`) — say so in the confirm, since
   under the old model it was `ON DELETE RESTRICT` and users may expect it to be blocked.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `feat(blueprints): rework template library as optional starting points`

---

## 7. Definition of done for Phase 3

- [ ] Tree shows indent guides; parent→child is readable at three levels without counting
- [ ] Full keyboard navigation with correct ARIA tree semantics
- [ ] Filter shows matches with ancestors intact and auto-expands
- [ ] Creating a child category shows the inherited fields **before** creation
- [ ] Schema tab visibly separates inherited from own fields, with source attribution
- [ ] A child can add a field the parent lacks — **the original bug — verify end to end**
- [ ] Overriding an inherited field's label/required works and does not affect the parent
- [ ] Duplicate-key errors name the conflicting category
- [ ] Live preview matches what the Items tab will render
- [ ] `npm run build` passes
- [ ] No `git commit` was run by the agent at any point

## 8. Out of scope

Item CRUD (Phase 4). Real impact analysis (Phase 5) — the confirm dialog stays simple.
Attribute library wiring — leave "From attribute library" visible but disabled with a
`Coming in Phase 6` tooltip, or hidden behind a flag.

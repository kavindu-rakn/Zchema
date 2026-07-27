# Phase 7 — Schema Inference, Onboarding & Polish

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **6 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> **Next.js 16.2.11.** Read `node_modules/next/dist/docs/01-app/` before touching routes,
> streaming, metadata, or caching.

**Depends on:** Phases 1–6 complete and committed.

---

## 1. The remaining gap

After Phase 6 the product is capable and, to a new user, still a blank page with a
`+ New root category` button. The original complaint was that no one *"of any IQ level in any
company could instantly pick it up."* Capability was only half of that. This phase closes the
other half: **the first five minutes**.

The mechanism is inference. A user pastes a CSV they already have; the app reads it, works out
the field types and enum options, proposes a category with a ready schema, and imports the
rows. They go from nothing to a populated, correctly-typed catalog without having learned a
single concept first — and the concepts they later need are then attached to something real
they can already see.

---

## 2. Increment 1 — The inference engine

`src/lib/inference.ts` — pure, no I/O, heavily unit-tested. This is a self-contained algorithm;
write the tests alongside it, not after.

```ts
inferSchema(rows: Record<string, string>[], opts?): InferenceResult
```

```ts
interface InferredField extends SchemaField {
  confidence: number;          // 0–1
  reason: string;              // "412/500 values parse as numbers"
  sample_values: string[];
  null_count: number;
  distinct_count: number;
  alternatives: FieldType[];   // other plausible types, best first
}
interface InferenceResult {
  fields: InferredField[];
  row_count: number;
  warnings: string[];          // duplicate headers, ragged rows, unparseable cells
  suggested_name: string;
}
```

**Type inference, in priority order.** Sample up to 1,000 rows; require ≥95% of non-empty
values to match before assigning a type, else fall back to `string`.

1. `boolean` — every non-empty value ∈ {true,false,yes,no,y,n,1,0,t,f} case-insensitively.
   Guard against a numeric column of only 0s and 1s: if the header does not look boolean
   (`is_`, `has_`, `_flag`), prefer `number` and offer `boolean` as an alternative.
2. `number` — parses after stripping thousands separators, currency symbols and a trailing
   unit. **Capture the stripped unit** — a column of `"16 GB"`, `"32 GB"` should infer
   `type: number, unit: "GB"`. This is the detail that makes the feature feel clever rather
   than mechanical.
3. `date` — ISO first, then `DD/MM/YYYY` and `MM/DD/YYYY`. When both are possible and no value
   disambiguates (no day > 12), say so in `warnings` and ask rather than guessing.
4. `url` — starts with `http://` / `https://`.
5. `select` — distinct count ≤ 20 **and** ≤ 30% of row count **and** every value repeats at
   least twice. Options sorted by frequency.
6. `multiselect` — values consistently contain a separator (`,` `;` `|`) and the resulting
   token set satisfies the `select` test.
7. `text` — string whose median length > 120 chars.
8. `string` — the fallback.

**Key derivation** — `slugify(header)`, deduplicating collisions with `_2`. Preserve the
original header in `help_text` when it differs meaningfully from the label.

**`required`** — true when the column has zero empty values **and** row count ≥ 10. Below that
the sample is too small to justify the constraint; leave it false.

**JSON input** — same pipeline after flattening one level of nesting with `_` (`specs.weight`
→ `specs_weight`). Arrays of scalars → `multiselect`; arrays of objects → skip with a warning.
Do not attempt deep flattening.

**Parsing** — write a small correct CSV parser (quoted fields, embedded commas and newlines,
escaped quotes, BOM stripping, CRLF) rather than adding a dependency. Auto-detect the
delimiter from `, ; \t |` by consistency of field count across the first ten lines.

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(inference): CSV/JSON schema inference engine with unit tests`

---

## 3. Increment 2 — Import wizard

Four steps, in a sheet, with a persistent back button.

**1 · Source** — drop a file, paste text, or paste a URL. Live row/column count as it parses.
Cap at 10,000 rows with a clear message rather than a hang.

**2 · Review schema** — the heart of it. One row per detected column:

```
✓ Brand              string      ✎    412 values · 8 distinct
✓ RAM                number  GB  ✎    "16 GB", "32 GB", "8 GB" …
⚠ Release Date       date    ✎        ambiguous: 03/04/2024 could be 3 Apr or 4 Mar
                                      ( ) DD/MM/YYYY   ( ) MM/DD/YYYY
✓ Condition          select  ✎        New · Refurbished · Used
✗ Internal Notes     — skip          97% empty
```

Every field is editable — type, label, required, options — and every inference states its
reason. Low-confidence rows sort to the top. A column can be skipped, or **mapped to an
existing attribute** from the Phase 6 library, which is where the two features compound: a
`Brand` column recognised as the shared `brand` attribute makes the import immediately
searchable across the whole catalog.

**3 · Destination** — create a new root category, create a child of an existing one, or import
into an existing category. For the latter two, show the inherited fields and **automatically
match incoming columns to them by key and by fuzzy label**, so `Brand` maps onto the inherited
`brand` rather than creating a duplicate. Unmatched columns become `own_fields`. Show the
mapping as an explicit two-column table the user can correct — never silently guess.

**4 · Preview and import** — first 10 rows rendered exactly as the Items table will show them,
a summary (`N items · M fields · K skipped columns`), and per-row errors listed with line
numbers. Import in a transaction, streaming progress, with a rollback on failure.

Errors must always name the line and the value. *"Row 47: `Release Date` value `n/a` is not a
date — imported as empty."*

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(import): four-step import wizard with schema mapping`

---

## 4. Increment 3 — First-run onboarding

Triggered when the catalog is empty. Not a tour with coach-marks — a decision:

```
        Nothing here yet. Three ways to start:

  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │  ⇪ Import    │  │  ⌗ Sample    │  │  ✎ Build     │
  │              │  │              │  │              │
  │ Paste a CSV. │  │ Load a ready │  │ Start from   │
  │ We'll work   │  │ catalog and  │  │ an empty     │
  │ out the      │  │ poke at it.  │  │ tree.        │
  │ fields.      │  │              │  │              │
  └──────────────┘  └──────────────┘  └──────────────┘
```

- **Sample** seeds the Amazon or Vehicle dataset from Phase 1 client-side and drops the user
  onto `Gaming Laptops` → Schema tab — the one screen where inheritance is self-evident. One
  dismissible callout points at the inherited block. That is the entire tutorial.
- **Import** opens the wizard. **Build** opens the create-root sheet.
- After first success, a single non-blocking hint bar suggests the next unexplored capability
  (add a child category → override a field → run a schema change). Dismissible permanently,
  tracked in `profiles.onboarding_state JSONB`.

Also add **empty-state quality** everywhere it is still generic. Every empty state names the
thing that is empty, says why it matters in one line, and offers exactly one primary action.
A category with children but no items should say *"Items live on subcategories. Laptops has
20."* with a link — not *"No items found."*

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(onboarding): first-run paths and meaningful empty states`

---

## 5. Increment 4 — Drag-and-drop tree reorganisation

Deferred from Phase 3 because it needs Phase 5's impact machinery.

- Drag a node onto another to reparent; drop between nodes to reorder (persisting `position`).
- Drop targets: highlight for valid, strike for invalid. Invalid = own descendant, or a field
  key collision — show the colliding key in the drag tooltip **during** the drag, not after
  the drop.
- Dropping opens the reparent impact dialog from Phase 5. No silent moves.
- Keyboard equivalent: `⌘↑`/`⌘↓` reorder, `⌘→` indent under previous sibling, `⌘←` outdent.
  A drag-only feature is not accessible.
- Multi-select drag is out of scope.

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `feat(tree): drag-and-drop reparenting with impact confirmation`

---

## 6. Increment 5 — Accessibility, performance, resilience

**Accessibility**
- Keyboard-complete: tree, tabs, table, dialogs, palette. Focus trapped in dialogs and
  restored on close.
- Contrast audit — the dark theme's muted text on card backgrounds is the likely failure.
  Verify 4.5:1 for body text and 3:1 for large text and UI boundaries.
- `aria-live` for async results: toasts, search result counts, import progress.
- Every icon-only button gets an accessible name. There are many in the current code.
- Respect `prefers-reduced-motion` — `framer-motion` is used throughout and currently ignores it.

**Performance**
- `EXPLAIN ANALYZE` the five hottest queries: tree fetch, effective schema, item list, search,
  impact analysis. Paste the output. Add indexes only where the plan justifies it.
- Seed a stress dataset (5,000 items, 50 categories, 6 levels) in
  `supabase/seedStress.sql` and record real timings. Fix anything over 300ms.
- Audit `revalidatePath` calls — several currently revalidate more than needed.
- Check for waterfalls in the Data Center layout: tree and detail should fetch in parallel.

**Resilience**
- Error boundaries per pane, so a failing detail pane does not take the tree with it.
- Every server action returns a typed result rather than throwing raw Postgres errors at the
  UI. Map constraint violations to human sentences — the Phase 1 triggers were written with
  readable messages for exactly this.
- Optimistic updates roll back visibly on failure.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `perf/a11y: accessibility audit, query tuning, error boundaries`

---

## 7. Increment 6 — Documentation and the demo path

The project needs to be explicable in 90 seconds. That is a deliverable.

1. **Rewrite `README.md`.** It is still the `create-next-app` boilerplate. It needs: the
   one-line pitch, the problem, a screenshot of the schema editor showing inherited vs own,
   a screenshot of the impact dialog, the data model diagram, setup instructions, and the
   architecture decisions with their reasoning. Written for someone deciding in 30 seconds
   whether to keep reading.
2. **`docs/ARCHITECTURE.md`** — the composition algorithm, the override rules and why type
   changes are excluded, the impact severity table, the RLS matrix. Reference-grade.
3. **`docs/DEMO.md`** — a scripted five-minute walkthrough:
   *load sample → open `Gaming Laptops` schema, show 7 inherited from two ancestors →
   add `refresh_rate_hz`, note `Smartphones` is untouched → make `warranty_months` required
   on `Electronics`, watch the severity badge turn amber, open the impact dialog, backfill 31
   items → open History, diff v4 against v5 → search `brand:Sony` across the whole catalog →
   import a CSV and watch the schema get inferred.*
   That sequence is the counter-argument to *"it's just another e-commerce platform."*
4. Refresh `docs/postman_collection.json` against the current server actions and RPCs.
5. Update `AGENTS.md` / `CLAUDE.md` with the new model so future sessions do not reintroduce
   template-first thinking.

✋ **Increment 6 complete — please review and commit manually.**
Suggested message: `docs: rewrite README, architecture notes, and demo script`

---

## 8. Definition of done for Phase 7

- [ ] Inference unit tests cover every type rule, including the boolean/0-1 and ambiguous-date
      edge cases
- [ ] CSV parser handles quotes, embedded newlines, CRLF, BOM, and mixed delimiters
- [ ] Import maps incoming columns onto inherited fields instead of duplicating them
- [ ] A 500-row CSV goes from paste to populated category in under a minute, unaided
- [ ] Empty catalog offers three real starting paths
- [ ] Drag reparent routes through impact analysis and has a keyboard equivalent
- [ ] Keyboard-only operation of every primary flow
- [ ] No query over 300ms on the 5,000-item stress dataset (timings pasted)
- [ ] README sells the product in its first paragraph
- [ ] `npm run build` passes, zero lint errors
- [ ] No `git commit` was run by the agent at any point

## 9. Where to go after this

Noted, not built: attribute-level validation rules (regex, min/max); computed fields derived
from others; a public read-only catalog view; scheduled exports; multi-tenant workspaces;
an approval workflow for schema changes (the versioning table already supports it).

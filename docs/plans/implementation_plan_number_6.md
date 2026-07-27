# Phase 6 — Attribute Library & Cross-Category Search

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **5 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> **Next.js 16.2.11.** Read `node_modules/next/dist/docs/01-app/` before touching routes,
> server actions, or `useSearchParams` (Suspense requirements changed).

**Depends on:** Phases 1 and 4 complete and committed. Benefits from 5 but does not require it.

---

## 1. Why these two features are one phase

They are the same idea seen from two ends.

Right now `brand` is defined independently on `Electronics`, `Clothing`, and `Home & Kitchen`.
Three unrelated strings that happen to spell the same word. So the question *"show me
everything by Sony, anywhere in the catalog"* is unanswerable — not because the query is hard,
but because the data model never asserted those three fields were the same thing.

The **attribute library** makes that assertion: one canonical `brand` definition, referenced by
many categories. **Cross-category search** is what the assertion buys you. Build the registry
and immediately spend it on search, or the registry looks like bureaucracy.

This is also the standard architecture of real PIM systems (Akeneo, Pimcore, Salsify) — worth
knowing, because it is the sentence that makes an interviewer sit up: *"attributes are a
first-class registry, categories compose them, which is how commercial PIMs are built."*

---

## 2. Increment 1 — Attribute registry backend

The `attributes` table exists from Phase 1. Wire it up.

1. Extend it with usage tracking:
   ```sql
   ALTER TABLE public.attributes
     ADD COLUMN group_name TEXT,          -- "Physical", "Commercial", "Media"
     ADD COLUMN is_system  BOOLEAN NOT NULL DEFAULT false;
   ```
2. `get_attribute_usage(p_attribute_id UUID)` → categories referencing it via
   `own_fields[].attribute_id`, with item counts. Uses the `idx_categories_own_fields` GIN
   index; verify with `EXPLAIN` that it does.
3. `find_duplicate_field_definitions()` → scans every category's `own_fields` and returns keys
   defined in 2+ categories that are **not** linked to an attribute, with their types and
   whether the types agree. This powers the "you have defined `brand` in 3 places — promote it
   to an attribute?" prompt, which is how the library gets populated without anyone doing
   data-modelling homework up front.
4. `promote_field_to_attribute(p_category_id, p_field_key)` → creates the attribute and
   back-links every matching field across all categories **whose type matches**. Report
   skipped mismatches rather than coercing them.
5. Sync semantics — decide once and document it in the SQL comment: editing an attribute's
   `label`/`options`/`unit` **propagates** to linked fields; editing its `type` does **not**
   and is rejected outright. Type changes must go through Phase 5's per-category impact flow,
   because a global retype could touch thousands of items across unrelated categories with no
   single blast radius to show.

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(db): attribute registry with usage tracking and promotion`

---

## 3. Increment 2 — Attribute library UI

Route `/data-center/attributes`, same shell as blueprints.

- **List rail**: grouped by `group_name`, searchable, each row showing
  `label · type · used in N categories`.
- **Detail pane**: editor (label, key, type, options, unit, help text, group) plus a
  **Used by** panel listing every category with its item count, each linking into the Data
  Center. Editing `label` warns that it will propagate to N categories. `type` is disabled
  with the reason stated inline.
- **Duplicates panel**, pinned at the top of the list when
  `find_duplicate_field_definitions()` returns anything:
  *"`brand` is defined separately on Electronics, Clothing and Home & Kitchen — all `string`.
  Promote to a shared attribute?"* with a one-click promote. Suppressible per key.
- **Schema editor integration**: enable the "From attribute library" button stubbed in Phase 3.
  It opens a picker (grouped, searchable, multi-select), and inserts the chosen attributes into
  `own_fields` with `attribute_id` set, skipping any key already in the effective chain and
  saying which and why.
- Fields linked to an attribute get a small link glyph in the schema editor, with a tooltip
  *"Linked to the shared `brand` attribute — used by 3 categories"*.

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(attributes): library UI with duplicate detection and promotion`

---

## 4. Increment 3 — Search backend

1. Generated tsvector column and index:
   ```sql
   ALTER TABLE public.items
     ADD COLUMN search_vector tsvector
     GENERATED ALWAYS AS (jsonb_to_tsvector('english', data, '["string","numeric"]')) STORED;
   CREATE INDEX idx_items_search ON public.items USING gin (search_vector);
   ```
   Confirm `jsonb_to_tsvector`'s filter-array argument behaves as expected on this Postgres
   version before relying on it — check the actual output, do not assume.

2. ```sql
   CREATE OR REPLACE FUNCTION public.search_items(
     p_query       TEXT,           -- free text
     p_filters     JSONB,          -- [{ key, op, value }]
     p_category_id UUID DEFAULT NULL,   -- scope root; NULL = whole catalog
     p_limit       INT DEFAULT 50,
     p_offset      INT DEFAULT 0
   ) RETURNS TABLE (
     id UUID, category_id UUID, category_name TEXT, category_path TEXT,
     data JSONB, rank REAL, total_count BIGINT
   )
   ```
   - Free text hits `search_vector` via `websearch_to_tsquery`.
   - Filters are ANDed. Operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`,
     `starts_with`, `in`, `is_null`, `not_null`. Numeric comparisons must cast
     (`(data->>key)::numeric`) inside a guard so a non-numeric value in one row does not error
     the whole query — this is the classic JSONB footgun. Use a `try_numeric()` helper.
   - `p_category_id` scopes to that node's subtree.
   - `rank` via `ts_rank_cd`; `total_count` via a window function so pagination has a total.

3. `get_searchable_fields(p_category_id UUID DEFAULT NULL)` → the distinct set of field keys
   across the scope with their types and how many categories define each. Drives autocomplete.

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(db): full-text and structured cross-category item search`

---

## 5. Increment 4 — Search UI and query DSL

**Query DSL** — parsed in `src/lib/query-dsl.ts`, pure and unit-testable:

```
sony wireless                 free text
brand:Sony                    equality
price:>500                    comparison
price:500..1200               range
size:in(S,M,L)                set membership
has_5g:true                   boolean
-discontinued:true            negation
brand:Sony price:>500         implicit AND
in:electronics                scope to a subtree by slug
missing:warranty_months       items lacking a value
```

`parseQuery(input) → { text, filters, scope, errors }`. Unparseable fragments fall back to free
text rather than erroring — a search box that rejects input is a search box people stop using.
Test the parser directly; it is the piece most likely to be subtly wrong.

**Search page** `/search?q=…`

- Sticky query bar with autocomplete: after `:` suggest values from existing data; before it
  suggest field keys from `get_searchable_fields`, marked with how many categories define each.
- Left: facets — category tree with result counts per node (click to scope), plus value facets
  for low-cardinality fields.
- Centre: results as cards showing the display value, the breadcrumb path, and the 3–4 fields
  that matched, with matched terms highlighted. Grouping toggle: flat / grouped by category.
- Saved searches in `localStorage`, and the URL always reflects the full query so any search
  is shareable.
- Empty state suggests relaxing the narrowest filter, naming it.

**Command palette integration** — typing in `⌘K` runs a debounced search and shows the top 5
items inline alongside navigation commands, with `See all N results →`. This is what makes the
palette the fastest path to any record in the system.

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `feat(search): query DSL, faceted search page, palette integration`

---

## 6. Increment 5 — Comparison and export

Two small features that make search feel like a tool rather than a lookup.

1. **Compare** — select 2–5 items from search results (they may be from different categories)
   and open a side-by-side table: union of all their fields as rows, items as columns,
   differing rows highlighted. Rows only some items have show `—` for the rest. Comparing a
   laptop against a smartphone works and is quietly impressive — it is inheritance doing
   visible work, since the shared rows are exactly the inherited fields.
2. **Export** — current result set to CSV or JSON, respecting active filters and column
   selection. Union of all fields present, empty cells for absent ones, a `_category` column,
   and `__orphaned` excluded unless explicitly requested. Stream it; do not build the whole
   file in memory.
3. Add `Export` to the Items tab too, scoped to the current category or subtree.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `feat(search): cross-category comparison and CSV/JSON export`

---

## 7. Definition of done for Phase 6

- [ ] Attribute library CRUD works; label edits propagate, type edits are refused with a reason
- [ ] Duplicate detection finds the seeded `brand` triplication and promotes it in one click
- [ ] Schema editor can pull attributes in, skipping and explaining collisions
- [ ] `search_items` returns correct results across every operator, with a query plan that uses
      the GIN indexes (`EXPLAIN` output pasted)
- [ ] Numeric comparison does not error on rows holding non-numeric values in that key
- [ ] `parseQuery` has unit tests covering every DSL form plus malformed input
- [ ] Searching `brand:Sony` with no scope returns items from multiple categories
- [ ] Command palette surfaces item results
- [ ] Export produces a valid CSV that round-trips through the Phase 7 importer
- [ ] `npm run build` passes
- [ ] No `git commit` was run by the agent at any point

## 8. Out of scope

Schema inference from imports (Phase 7). Fuzzy/semantic search — Postgres full text is
sufficient and honest. Attribute-level validation rules (regex, min/max) are a good future
addition; note them in the file and move on.

# Phase 2 — Navigation Shell & The Data Center

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **5 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> This project runs **Next.js 16.2.11**. Routing, layouts, `params` as a Promise, caching
> directives and middleware conventions differ from training data. Read
> `node_modules/next/dist/docs/01-app/` before touching routes. Note this repo already renamed
> `middleware.ts` → `proxy.ts` for that reason — respect it.

**Depends on:** Phase 1 complete and committed.

---

## 1. The problem being solved

Four issues, one root cause — the app's information architecture mirrors its *database tables*
rather than the user's *task*.

1. **`/categories` and `/catalog` are the same thing rendered twice.** One shows a tree for
   editing, the other shows cards for browsing. Users cannot tell which one to use.
2. **`/catalog` dumps roots into one grid and children into another**, so `Laptops` sits
   next to `Fiction` with nothing indicating that `Laptops` belongs to `Electronics`.
   The parent→child relationship — the entire point of the product — is invisible.
3. **The sidebar carries five links that are not peers.** Dashboard is a destination,
   Settings is a preference, and the other three are all the same workspace.
4. **There is no sense of arrival.** The app opens onto a stat grid and offers no obvious
   next action.

## 2. The target shape

```
/                      public landing
/login  /signup
/dashboard             HOME. Stats + activity + alerts + one large "Enter Data Center" action
/data-center           the workspace — tree on the left, detail on the right
/data-center/[categoryId]?tab=overview|schema|items|history
/data-center/blueprints    blueprint library (its own detail pane, same shell)
/data-center/attributes    attribute library (Phase 6, route reserved now)
/search                global cross-category item search (Phase 6, route reserved now)
/settings              reached from the avatar menu, not from nav
```

**Shell rules**

- **No left sidebar anywhere.** A slim top bar replaces it: wordmark (links to `/dashboard`),
  a global search trigger (`⌘K`), a role badge, and an avatar menu holding
  Settings / Sign out / Switch role.
- **Inside `/data-center` the category tree *is* the navigation.** It occupies the left rail,
  is resizable, and persists across tab changes. This is the meaningful sidebar the current
  one is only pretending to be.
- `/categories` and `/catalog` are **deleted** and redirected. They were never two things.

```
┌──────────────────────────────────────────────────────────────┐
│  ◈ SchemaShift        ⌘K Search        [SCHEMA_ADMIN]  (kv)▾ │  ← top bar, 56px
├───────────────────┬──────────────────────────────────────────┤
│ ⌕ filter tree     │  Electronics › Laptops › Gaming Laptops  │
│                   │  ┌────────────────────────────────────┐  │
│ ▾ ▣ Electronics   │  │ Overview │ Schema │ Items │ History │  │
│   ▾ ▣ Laptops  20 │  └────────────────────────────────────┘  │
│     ▪ Gaming    8 │                                          │
│     ▪ Ultrabooks  │   ← detail pane, tab-driven              │
│   ▪ Smartphones 20│                                          │
│ ▸ ▣ Books         │                                          │
│ ▸ ▣ Home & Kitchen│                                          │
│                   │                                          │
│ + New root        │                                          │
└───────────────────┴──────────────────────────────────────────┘
```

---

## 3. Increments

### Increment 1 — Top bar shell, sidebar removal

1. New `src/components/shell/top-bar.tsx`:
   - Left: wordmark `SchemaShift`, subtle `SLT` mark. Links to `/dashboard`.
   - Centre: search trigger button (`Search…  ⌘K`) — wire it to the **existing**
     `src/components/command-palette.tsx`; do not build a second palette.
   - Right: role badge, then avatar dropdown → `Settings`, `Switch role` (dev only, move the
     existing `RoleSwitcher` in here), `Sign out`.
   - Sticky, `h-14`, `border-b`, background `bg-background/80 backdrop-blur`.
2. New `src/components/shell/breadcrumbs.tsx` — takes an ancestor chain, renders
   `Electronics › Laptops › Gaming Laptops` with every segment linking to its own node.
   Collapse the middle with `…` beyond four levels.
3. Rewrite `src/app/(dashboard)/layout.tsx`: `<TopBar/>` + `<main>`. Delete the
   `<Sidebar/>` and the floating `<RoleSwitcher/>`.
4. **Delete** `src/components/sidebar.tsx`. Keep `role-switcher.tsx` but strip its fixed
   positioning — it is now a dropdown item.
5. Keep the layout's auth guard and profile fetch exactly as-is. Pass `user` and `profile`
   into `<TopBar/>`.

> The current layout has `overflow-hidden` on the outer div and `overflow-auto` on `<main>`.
> The new shell needs the *tree* to scroll independently of the *detail pane*, so drop the
> outer `overflow-hidden` and let each pane own its own scroll container. Getting this wrong
> produces a double scrollbar — check it visually before moving on.

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(shell): replace sidebar with top bar and breadcrumbs`

---

### Increment 2 — Dashboard as home

Rewrite `src/app/(dashboard)/dashboard/page.tsx`. It should answer "what is in here, what
needs my attention, and where do I go" in one screen.

**Hero.** Full-width card, the primary action of the entire app:

```
Data Center
12 categories · 4 levels deep · 145 items · 38 fields defined

                                        [ Enter Data Center → ]
```

Make this button unmissable — it is the app's front door.

**Stat row.** Keep the existing four-card grid but change what it counts, because the current
counts are vanity metrics:

| Card | Value | Why it earns its place |
|---|---|---|
| Categories | total, + "N root · max depth D" | conveys shape, not just size |
| Schema fields | distinct effective fields across the tree, + "N inherited" | shows inheritance is doing work |
| Items | total | fine as-is |
| Schema changes | count in last 7 days, links to history | replaces "Recent Activity", which currently counts items and is uninformative |

**Attention panel.** Only render when non-empty — an empty panel is worse than none:

- categories with a schema but zero items ("`Gaming Laptops` has 9 fields and no data")
- items missing a value for a `required` field
- items on a stale `schema_version` (Phase 5 populates this; render the empty state now)
- categories with no `own_fields` and no children (dead nodes)

**Recent activity.** Last 5 schema versions and last 5 items, interleaved by timestamp,
each linking into the Data Center at the right tab.

Server-render everything. Add the queries to `src/lib/data/dashboard.ts`. Keep
`export const dynamic = "force-dynamic"`.

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(dashboard): rebuild as home with Data Center entry point`

---

### Increment 3 — Data Center route + master-detail layout

1. New route group `src/app/(dashboard)/data-center/`:
   - `layout.tsx` — renders the persistent tree rail + `{children}`. Fetches the whole tree
     **once** here via `get_category_tree()` so navigating between nodes does not refetch it.
   - `page.tsx` — no node selected. Show a genuine empty-selection state: a short
     "pick a category, or create one" plus the three most recently touched categories as
     quick links. Not a blank pane.
   - `[categoryId]/page.tsx` — the detail pane. Reads `?tab=` (default `overview`).
   - `[categoryId]/not-found.tsx`.
2. `src/components/data-center/rail.tsx` — the left rail container: filter input at top,
   tree in the middle (scrolls), `+ New root category` pinned at the bottom. Width
   resizable by drag, clamped 220–480px, persisted to `localStorage`.
   > `localStorage` is fine here — this is a real Next.js app, not a sandboxed artifact.
3. `src/components/data-center/detail-tabs.tsx` — tab bar driven by the URL search param so
   tabs are linkable and back/forward works. Use `useRouter` + `useSearchParams`; wrap in
   `<Suspense>` per Next 16 requirements for `useSearchParams`.
4. Tab contents for now:
   - **Overview** — real: name, description, breadcrumb, parent, direct children with counts,
     field summary (`3 inherited · 2 own`), item count, created/updated, danger zone (delete).
   - **Schema** — placeholder, built in Phase 3.
   - **Items** — placeholder, built in Phase 4.
   - **History** — placeholder, built in Phase 5.

Ship Overview properly. A tab bar where three of four tabs are stubs looks broken; make
Overview substantial enough that the phase feels finished.

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(data-center): master-detail workspace with persistent tree rail`

---

### Increment 4 — Retire `/categories` and `/catalog`

1. Move `/templates` → `/data-center/blueprints`, reusing the Data Center shell. Rename the
   UI copy from "Templates" to "Blueprints" and reframe them: the library page's subtitle
   should say what they now are — *"Reusable starting points. Applying a blueprint copies its
   fields onto a category; there is no live link afterwards."* That sentence prevents the
   single most likely misunderstanding of the new model.
2. Delete `src/app/(dashboard)/categories/` and `src/app/(dashboard)/catalog/` page files.
   Keep `categories/actions.ts` (Phase 1 rewrote it) but move it to
   `src/app/(dashboard)/data-center/actions.ts`.
3. Add redirects in `next.config.ts` — permanent, so old links and any bookmarks survive:
   `/categories → /data-center`, `/catalog → /data-center`,
   `/catalog/:id → /data-center/:id?tab=items`, `/templates → /data-center/blueprints`,
   `/templates/:id → /data-center/blueprints/:id`.
4. Update `command-palette.tsx`: commands become `Go to Dashboard`, `Go to Data Center`,
   `Search items`, `New category`, `New blueprint`, `Settings`, plus **live category
   results** — typing `lap` should offer `Electronics › Laptops`. That last part is what makes
   the palette worth keeping.
5. Grep the repo for `/catalog`, `/categories`, `/templates`, `template_id`, `Template`,
   `TEMPLATE_ADMIN`, `DATA_CONTRIBUTOR` and fix every remaining reference.

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `refactor(nav): merge categories and catalog into data-center`

---

### Increment 5 — Settings, states, and visual pass

1. `/settings` — reachable only from the avatar menu. Sections: Profile (email, role,
   read-only unless admin), Appearance (density toggle: comfortable/compact — the current
   spacing is loose for a data tool), Users (admin-only role management table), Danger zone
   (sign out everywhere). Remove Settings from all nav lists.
2. Rebuild `loading.tsx`, `error.tsx`, `not-found.tsx` for the new shell — skeletons that
   match the actual layout (tree rail skeleton + detail skeleton), not a centred spinner.
3. **Colour discipline.** The codebase mixes semantic tokens (`bg-sidebar`, `text-primary`)
   with hardcoded Tailwind (`bg-zinc-900`, `text-emerald-400`) — often in the same component
   (`category-tree.tsx` is the worst offender). Convert every hardcoded `zinc-*` and
   `emerald-*` to the `globals.css` token equivalents. This is not cosmetic housekeeping:
   Phase 5 needs `warning` and `destructive` semantics to read consistently, and it cannot if
   half the app hardcodes its palette. Add `--color-warning` / `--color-warning-foreground`
   tokens now if they are absent.
4. Responsive: below `lg`, the tree rail becomes a `<Sheet>` triggered by a hamburger in the
   top bar. Do not attempt a fully mobile-optimised tree — a working drawer is enough.
5. Focus states and keyboard reachability on the top bar, tabs, and rail.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `feat(shell): settings, loading states, and design token cleanup`

---

## 4. Definition of done for Phase 2

- [ ] No `sidebar.tsx` remains; every route renders under the top bar
- [ ] `/dashboard` is the post-login landing route and its "Enter Data Center" action works
- [ ] `/data-center` shows the tree rail on every child route without refetching it
- [ ] Tab state lives in the URL — `?tab=items` is linkable, back button works
- [ ] `/categories`, `/catalog`, `/templates` all redirect; no dead links anywhere
- [ ] Command palette navigates and returns live category matches
- [ ] Zero hardcoded `zinc-*` / `emerald-*` classes remain (`grep -r "zinc-\|emerald-" src/`)
- [ ] `npm run build` passes
- [ ] No `git commit` was run by the agent at any point

## 5. Out of scope

The tree rail in this phase can be a straightforward recursive list — Phase 3 rebuilds it
properly with indent guides, keyboard navigation and inline actions. Do not gold-plate it
here. Schema, Items and History tabs stay stubbed.

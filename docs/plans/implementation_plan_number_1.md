# Phase 1 — Data Model: Schema Inheritance & Composition

> ### ⛔ DO NOT COMMIT ANYTHING
> Do **not** run `git commit`, `git add`, `git push`, or `gh pr create` at any point.
> This plan has **6 increments**. At the end of each one, **stop**, summarise what changed, and
> print: `✋ Increment N complete — please review and commit manually before I continue.`
> Wait for the human to say "continue" before starting the next increment.

> ### 📕 Next.js version warning
> This project runs **Next.js 16.2.11**. APIs, conventions and file structure differ from
> training data. Before writing any route, server-action, or caching code, read the relevant
> guide under `node_modules/next/dist/docs/01-app/`. Heed deprecation notices.

---

## 1. Why this phase exists

The current model is:

```
templates (fields JSONB)  ──1──<  categories (template_id NOT NULL)  ──1──<  items (data JSONB)
```

A category has **exactly one** template and **zero** ability to add anything of its own. So
`Laptops` and `Smartphones` both inherit `Electronics Template` and neither can add
`screen_size` or `gpu` without polluting the other. That is the bug the user hit, and it is
not a UI bug — it is a modelling bug. Everything else in this overhaul sits on top of the fix.

**The new model: schema lives on the category node, and is composed down the tree.**

```
blueprints (optional presets)      attributes (reusable field defs)
        │ copied-from                       │ referenced-by
        ▼                                   ▼
categories (own_fields JSONB, overrides JSONB, parent_id)
        │  effective_schema = fold(ancestors.own_fields) + own_fields, with overrides applied
        ▼
items (data JSONB, schema_version INT)
        │
        ▼
schema_versions (immutable snapshots)
```

`Electronics` owns `brand`, `warranty_months`. `Laptops` inherits both and *adds* `screen_size`,
`gpu`. `Smartphones` inherits both and adds `battery_mah`. Neither can see the other's fields.
That is the whole idea.

---

## 2. Design decisions (already settled — do not re-litigate)

| Decision | Ruling |
|---|---|
| Migration style | **Destructive.** Drop and recreate. Rewrite `schema.sql` wholesale. Reseed. No back-compat shims. |
| Override semantics | Child may **add** fields and **override** `label` / `required` / `options` / `default` / `help_text` / `position` of an inherited field. Child may **not** delete an inherited field or change its `type`. |
| `templates` | Renamed to **`blueprints`** and demoted to optional starter presets. `categories.blueprint_id` is nullable and is *provenance only* — applying a blueprint **copies** its fields into `own_fields`. There is no live link. |
| Tree walk | Recursive CTE. No `ltree` extension, no materialised path. Depth is small; correctness beats micro-optimisation. |
| Key uniqueness | A field `key` must be unique across a category's **entire effective chain**. Enforced by trigger, not by hope. |
| Role names | `TEMPLATE_ADMIN` → `SCHEMA_ADMIN`, `DATA_CONTRIBUTOR` → `DATA_EDITOR`, `VIEWER` unchanged. "Template admin" stops making sense once templates are demoted. |
| Data loss | **Never silently drop item data.** Values whose field disappears move to `data.__orphaned.<key>`. Phase 5 exposes them in the UI. |

---

## 3. Canonical type shapes

Write these into `src/lib/types.ts` (Increment 5). Every later phase depends on these exact
names — do not rename them.

```ts
export type UserRole = "SCHEMA_ADMIN" | "DATA_EDITOR" | "VIEWER";

export type FieldType =
  | "string" | "text" | "number" | "boolean"
  | "date" | "select" | "multiselect" | "url";

/** A field as authored on a category (or inside a blueprint). */
export interface SchemaField {
  key: string;                 // snake_case, unique across the effective chain
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];          // select | multiselect
  default?: unknown;
  help_text?: string;
  unit?: string;               // e.g. "kg", "GB" — display only
  position: number;            // ordering within its own level
  attribute_id?: string | null; // set when pulled from the attribute library (Phase 6)
}

/** Patch a descendant applies to an inherited field. Type & key are NOT patchable. */
export interface FieldOverride {
  label?: string;
  required?: boolean;
  options?: string[];
  default?: unknown;
  help_text?: string;
  position?: number;
}

/** A field after resolution, as returned by get_effective_schema(). */
export interface EffectiveField extends SchemaField {
  source_category_id: string;
  source_category_name: string;
  depth: number;               // 0 = defined on the target category itself
  inherited: boolean;          // depth > 0
  overridden_by: string[];     // category ids that patched it, root→leaf order
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  parent_id: string | null;
  blueprint_id: string | null;
  own_fields: SchemaField[];
  overrides: Record<string, FieldOverride>;  // keyed by inherited field key
  icon: string | null;
  color: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
  item_count: number;          // items directly on this node
  subtree_item_count: number;  // items on this node + all descendants
  own_field_count: number;
  inherited_field_count: number;
}

export interface Blueprint {
  id: string;
  name: string;
  description: string | null;
  fields: SchemaField[];
  created_at: string;
  updated_at: string;
}

export interface Item {
  id: string;
  category_id: string;
  data: Record<string, unknown>;   // may contain a `__orphaned` sub-object
  schema_version: number;
  created_at: string;
  updated_at: string;
}

export interface SchemaVersion {
  id: string;
  category_id: string;
  version: number;
  snapshot: EffectiveField[];
  change_summary: SchemaChange[];
  changed_by: string | null;
  created_at: string;
}

export type ChangeKind =
  | "add_field" | "remove_field" | "retype_field"
  | "require_field" | "unrequire_field"
  | "rename_label" | "change_options" | "add_override" | "remove_override";

export type ChangeSeverity = "safe" | "warning" | "destructive";

export interface SchemaChange {
  kind: ChangeKind;
  field_key: string;
  severity: ChangeSeverity;
  from?: unknown;
  to?: unknown;
  affected_item_count: number;
  lossy_item_count?: number;      // values that will not survive a type cast
  sample_values?: unknown[];      // up to 5, for the impact dialog in Phase 5
}
```

---

## 4. Increments

Each increment ends with a **manual commit checkpoint**.

---

### Increment 1 — Rewrite `supabase/schema.sql`

Replace the file entirely. Structure it in numbered sections as the current file does.

**Tables**

```sql
-- profiles: unchanged shape, new role vocabulary
role TEXT NOT NULL DEFAULT 'VIEWER'
  CHECK (role IN ('SCHEMA_ADMIN','DATA_EDITOR','VIEWER'))

-- blueprints (was templates)
CREATE TABLE public.blueprints (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- categories: now owns its schema
CREATE TABLE public.categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  description  TEXT,
  parent_id    UUID REFERENCES public.categories(id) ON DELETE CASCADE,
  blueprint_id UUID REFERENCES public.blueprints(id) ON DELETE SET NULL,
  own_fields   JSONB NOT NULL DEFAULT '[]'::jsonb,
  overrides    JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon         TEXT,
  color        TEXT,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- items: gains schema_version
CREATE TABLE public.items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- schema_versions: immutable audit trail (populated in Phase 5, table exists now)
CREATE TABLE public.schema_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  snapshot       JSONB NOT NULL,
  change_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
  changed_by     UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_id, version)
);

-- attributes: reusable field registry (populated in Phase 6, table exists now)
CREATE TABLE public.attributes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL UNIQUE,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,
  unit        TEXT,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Indexes** — keep the existing four, add:

```sql
CREATE UNIQUE INDEX unique_category_slug_parent
  ON public.categories (parent_id, slug) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX unique_category_slug_root
  ON public.categories (slug) WHERE parent_id IS NULL;
CREATE INDEX idx_categories_own_fields ON public.categories USING gin (own_fields);
CREATE INDEX idx_schema_versions_category ON public.schema_versions (category_id, version DESC);
```

Keep `updated_at` triggers for all tables including the two new ones. Keep
`handle_new_user()` but map the seed emails to the **new** role names, and add
`admin@zchema.com` → `SCHEMA_ADMIN`, `contributor@zchema.com` → `DATA_EDITOR`.
Keep `protect_role_update()` with the new admin role name.

**Cycle guard** — a category must not become its own ancestor:

```sql
CREATE OR REPLACE FUNCTION public.prevent_category_cycle()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE cur UUID := NEW.parent_id;
BEGIN
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'Cannot move category % under its own descendant', NEW.name;
    END IF;
    SELECT parent_id INTO cur FROM public.categories WHERE id = cur;
  END LOOP;
  RETURN NEW;
END; $$;

CREATE TRIGGER categories_no_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.prevent_category_cycle();
```

✋ **Increment 1 complete — please review and commit manually.**
Suggested message: `feat(db): rewrite schema for category-owned schema composition`

---

### Increment 2 — Resolver functions

New file `supabase/functions.sql`, sourced after `schema.sql`. These are the contract every
later phase reads from — get them exactly right.

**`get_category_ancestors(p_category_id UUID) RETURNS TABLE(id UUID, name TEXT, own_fields JSONB, overrides JSONB, depth INT)`**

Recursive CTE walking **upward** from the target. `depth = 0` for the target itself,
increasing toward the root. Order the result **root-first** (i.e. `ORDER BY depth DESC`) so
the caller can fold in inheritance order.

**`get_effective_schema(p_category_id UUID) RETURNS JSONB`**

Algorithm, in this exact order:

1. Start with an empty ordered accumulator.
2. For each ancestor **root → target**:
   a. Append every entry of `own_fields`, stamped with `source_category_id`,
      `source_category_name`, `depth` (distance from target), `inherited = depth > 0`,
      `overridden_by = []`.
   b. If a key already exists in the accumulator, **skip the duplicate** and continue — the
      trigger in Increment 3 makes this unreachable, but the resolver must never throw.
3. Second pass, **root → target** again: for each ancestor's `overrides` object, patch any
   accumulated field whose key matches. Only `label`, `required`, `options`, `default`,
   `help_text`, `position` may be patched — ignore any other key in the patch object.
   Append the patching category's id to `overridden_by`.
4. Sort by `(depth DESC, position ASC, label ASC)` so inherited fields appear above own
   fields and ordering is stable.
5. Return a JSONB array of `EffectiveField`.

Mark it `LANGUAGE plpgsql STABLE SECURITY INVOKER` and `SET search_path = ''`.

**`get_category_subtree(p_category_id UUID) RETURNS TABLE(id UUID, depth INT)`**
Recursive CTE walking **downward**, including the target. Used everywhere "and all its
descendants" is needed.

**`count_subtree_items(p_category_id UUID) RETURNS INTEGER`**
`SELECT count(*) FROM items WHERE category_id IN (SELECT id FROM get_category_subtree(...))`.

**`get_category_tree() RETURNS JSONB`**
One call that returns the whole tree with counts, so the UI never N+1s. Each node:
`id, name, slug, parent_id, icon, color, position, own_field_count,
inherited_field_count, item_count, subtree_item_count`. Nesting can be assembled
client-side from the flat list — return **flat**, it is easier to memoise.

**Verification for this increment.** Write `supabase/tests/effective_schema_test.sql`
containing assertions runnable in the SQL editor:

- `Electronics` (own: brand, warranty_months) → 2 effective fields, all `inherited=false`.
- `Laptops` (child, own: screen_size, gpu) → 4 effective fields; brand/warranty have
  `inherited=true, depth=1, source_category_name='Electronics'`; screen_size/gpu have `depth=0`.
- `Smartphones` → 3 fields, and **does not contain** `screen_size`.
- `Laptops` with `overrides = {"warranty_months": {"required": true, "label": "Warranty (months)"}}`
  → that field shows the new label, `required=true`, `overridden_by=['<laptops-id>']`,
  and `Electronics` itself is unaffected.
- A three-level chain resolves in root→leaf order.

Run each and paste the actual output into the increment summary. Do not claim it works
without running it.

✋ **Increment 2 complete — please review and commit manually.**
Suggested message: `feat(db): add recursive schema resolver functions`

---

### Increment 3 — Integrity triggers

**Duplicate-key guard.** On insert/update of `categories.own_fields`, reject a key that
already exists anywhere in the ancestor chain, and reject a key that any *descendant*
already defines:

```sql
CREATE OR REPLACE FUNCTION public.validate_category_fields()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  dup TEXT;
BEGIN
  -- 1. keys must be unique within own_fields itself
  SELECT f->>'key' INTO dup
  FROM jsonb_array_elements(NEW.own_fields) f
  GROUP BY f->>'key' HAVING count(*) > 1 LIMIT 1;
  IF dup IS NOT NULL THEN
    RAISE EXCEPTION 'Duplicate field key "%" within this category', dup;
  END IF;

  -- 2. keys must not collide with any ancestor's field
  -- 3. keys must not collide with any descendant's field
  -- (implement both with get_category_ancestors / get_category_subtree)
  ...
END; $$;
```

Also validate each field object's **shape**: `key` matches `^[a-z][a-z0-9_]*$`, `type` is one
of the eight allowed values, `options` is non-empty when type is `select`/`multiselect`,
`position` is an integer. Raise a clear, human-readable exception — these messages surface
directly in toasts.

**Override guard.** Reject an `overrides` entry whose key is not present in the ancestor
chain, and reject any patch containing `type` or `key`.

**Slug generation.** `BEFORE INSERT`: if `slug` is null, derive it from `name`
(lowercase, non-alphanumerics → `-`, collapse repeats, trim). On collision within the same
parent, append `-2`, `-3`, …

✋ **Increment 3 complete — please review and commit manually.**
Suggested message: `feat(db): add field-key uniqueness and override validation triggers`

---

### Increment 4 — RLS policies

Same three-tier shape as before, with the new role names, plus the two new tables.

| Table | SELECT | INSERT / UPDATE / DELETE |
|---|---|---|
| `profiles` | own row; all rows for `SCHEMA_ADMIN` | own row; any row for `SCHEMA_ADMIN` |
| `blueprints` | all authenticated | `SCHEMA_ADMIN` |
| `categories` | all authenticated | `SCHEMA_ADMIN` |
| `attributes` | all authenticated | `SCHEMA_ADMIN` |
| `items` | all authenticated | `SCHEMA_ADMIN`, `DATA_EDITOR` |
| `schema_versions` | all authenticated | **INSERT only**, `SCHEMA_ADMIN`. No UPDATE or DELETE policy at all — the audit trail is append-only by omission. |

Keep the `get_user_role()` helper as-is (it is `SECURITY DEFINER STABLE` — correct).

✋ **Increment 4 complete — please review and commit manually.**
Suggested message: `feat(db): RLS policies for new roles and tables`

---

### Increment 5 — TypeScript layer

1. Replace `src/lib/types.ts` with the shapes from §3 above. Delete `Template`,
   `TemplateField`, `ItemWithCategory`.
2. New `src/lib/schema.ts` — pure, dependency-free, **unit-testable** functions mirroring the
   SQL resolver so the client can preview changes without a round trip:
   - `resolveEffectiveSchema(chain: Category[]): EffectiveField[]` — same algorithm as
     `get_effective_schema`, root-first input.
   - `buildCategoryTree(flat: CategoryNode[]): CategoryNode[]`
   - `diffSchemas(before: EffectiveField[], after: EffectiveField[]): SchemaChange[]`
     (severity assignment lands in Phase 5; return `severity: "safe"` placeholders for now)
   - `validateFieldKey(key: string): string | null`
   - `slugify(name: string): string`
   > These two implementations **must agree**. Any divergence is a bug that will surface as
   > a UI that lies about what will happen. Keep the algorithm comment blocks identical.
3. New `src/lib/data/categories.ts`, `src/lib/data/blueprints.ts`, `src/lib/data/items.ts` —
   typed Supabase query helpers. Move the ad-hoc queries currently inlined in pages here.
   Every function returns typed data or throws with a message fit for a toast.
4. Delete `src/app/(dashboard)/templates/actions.ts`; create
   `src/app/(dashboard)/blueprints/actions.ts` as its successor with renamed functions.
   Rewrite `src/app/(dashboard)/categories/actions.ts`:
   `createCategory`, `updateCategory`, `deleteCategory`, `updateCategorySchema`,
   `applyBlueprint`, `moveCategory` — all `SCHEMA_ADMIN`-gated **server-side**, not just in the UI.

> The existing actions only check `if (!user) throw`. That is an authorisation hole: any
> logged-in VIEWER can call the server action directly. Every mutating action in this phase
> must re-check the caller's role server-side even though RLS also guards it.

✋ **Increment 5 complete — please review and commit manually.**
Suggested message: `refactor(types): category-owned schema types and data layer`

---

### Increment 6 — Reseed

Rewrite all three seed scripts against the new model. **Delete `supabase/seed.sql`'s old
template-first structure**; each script should be idempotent (`TRUNCATE ... CASCADE` at the
top, guarded by a comment warning it is destructive).

`seedAmazon.sql` — this is the demo that must sell the feature:

```
Electronics            own: brand, model_number, warranty_months
├── Laptops            own: screen_size_in, ram_gb, cpu, gpu          → 20 items
│   └── Gaming Laptops own: refresh_rate_hz, has_rgb                  → 8 items
│       override: warranty_months → { label: "Warranty (months)", required: true }
└── Smartphones        own: battery_mah, storage_gb, has_5g           → 20 items

Clothing, Shoes & Jewelry  own: brand, material, care_instructions
├── Mens Clothing          own: size (select), fit                    → 15 items
└── Womens Clothing        own: size (select), fit, is_maternity      → 15 items

Books                  own: author, isbn, page_count, language
├── Fiction            own: genre (select), is_series                 → 15 items
└── Non-Fiction        own: subject, has_index                        → 15 items

Home & Kitchen         own: brand, material, dimensions_cm
├── Furniture          own: assembly_required, weight_kg              → 10 items
└── Kitchen Appliances own: wattage, is_dishwasher_safe               → 10 items
```

`Gaming Laptops` is deliberately three levels deep **and** carries an override — it is the
single node that proves the whole model in one screenshot. Do not omit it.

Give every category an `icon` (lucide name) and a `color`. Seed 2–3 `blueprints` as
*presets* only (`Basic Product`, `Media Item`, `Physical Goods`) with no category linked to
them, to make it obvious blueprints are now optional.

`seedVehicle.sql` — a second, structurally different domain (Vehicles → Cars/Motorcycles →
Sedans/SUVs) to prove the model is not e-commerce-specific. This is worth doing well; it is
the answer to "this is just another e-commerce platform."

**Verification.** After seeding, run and paste output:
```sql
SELECT jsonb_array_length(public.get_effective_schema(id)) AS fields, name
FROM public.categories ORDER BY name;
```
`Gaming Laptops` must show 9 fields (3 from Electronics + 4 from Laptops + 2 own).

✋ **Increment 6 complete — please review and commit manually.**
Suggested message: `feat(db): reseed with multi-level inheritance demo data`

---

## 5. Definition of done for Phase 1

- [ ] `schema.sql` + `functions.sql` apply cleanly to a fresh Supabase project, no errors
- [ ] All five assertions in `effective_schema_test.sql` pass, output pasted
- [ ] Duplicate field key across a parent/child chain is **rejected** with a readable error
- [ ] An override on a non-inherited key is **rejected**
- [ ] Attempting to reparent a category under its own descendant is **rejected**
- [ ] `npm run build` passes with zero TypeScript errors
- [ ] All three seed scripts run clean, `Gaming Laptops` resolves to 9 fields
- [ ] No `git commit` was run by the agent at any point

## 6. Explicitly out of scope for Phase 1

UI work of any kind. The existing pages **will break** — that is expected and fine. Phase 2
rebuilds the shell and Phase 3 rebuilds the schema editor. Do not attempt to keep
`/templates` or `/categories` rendering; if a page fails to compile, stub it with a
`<p>Rebuilt in Phase 2</p>` placeholder and move on.

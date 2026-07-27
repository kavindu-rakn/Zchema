// ── Pure schema-composition helpers ──────────────────────────
// Dependency-free and unit-testable. These mirror the SQL resolver in
// supabase/functions.sql so the client can preview a change without a
// round trip.
//
// ⚠️  resolveEffectiveSchema() and get_effective_schema() MUST agree.
// Any divergence surfaces as a UI that lies about what will happen.
// The algorithm comment block below is kept identical in both files —
// if you change one, change the other in the same commit.

import type {
  Category,
  CategoryNode,
  EffectiveField,
  FieldOverride,
  SchemaChange,
  SchemaField,
} from "./types";

/** The only properties a descendant may patch on an inherited field. */
export const OVERRIDABLE_KEYS = [
  "label",
  "required",
  "options",
  "default",
  "help_text",
  "position",
] as const satisfies readonly (keyof FieldOverride)[];

/**
 * Resolve a category's effective schema from its ancestor chain.
 *
 * @param chain Ancestors ROOT-FIRST, with the target category last —
 *              the same order `get_category_ancestors()` returns
 *              (`ORDER BY depth DESC`).
 *
 * Algorithm:
 *   1. Empty ordered accumulator.
 *   2. Root → target: append every own_field, stamped with source
 *      + depth + inherited + overridden_by=[]. Skip a key already
 *      accumulated (duplicates are trigger-prevented, but never throw).
 *   3. Root → target again: apply each ancestor's overrides to the
 *      matching accumulated field. Only label/required/options/
 *      default/help_text/position are patchable; append the patching
 *      category id to overridden_by.
 *   4. Sort by (depth DESC, position ASC, label ASC).
 *   5. Return an array of EffectiveField.
 */
export function resolveEffectiveSchema(chain: Category[]): EffectiveField[] {
  // 1. Empty ordered accumulator.
  const acc: EffectiveField[] = [];
  const seen = new Set<string>();
  const lastIndex = chain.length - 1;

  // 2. Root → target: append own_fields, stamped with provenance.
  chain.forEach((category, index) => {
    const depth = lastIndex - index; // distance from the target category
    const ownFields = Array.isArray(category.own_fields) ? category.own_fields : [];

    for (const field of ownFields) {
      const key = field?.key;
      if (!key) continue;
      if (seen.has(key)) continue; // duplicate: skip, never throw
      seen.add(key);
      acc.push({
        ...field,
        source_category_id: category.id,
        source_category_name: category.name,
        depth,
        inherited: depth > 0,
        overridden_by: [],
      });
    }
  });

  // 3. Root → target again: apply overrides to matching fields.
  for (const category of chain) {
    const overrides = category.overrides;
    if (!overrides || typeof overrides !== "object") continue;

    for (const [key, patch] of Object.entries(overrides)) {
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) continue;
      const target = acc.find((f) => f.key === key);
      if (!target) continue;

      // Only the allow-listed properties are patchable — anything else in
      // the patch object is ignored, exactly as get_effective_schema does.
      const patchRecord = patch as Record<string, unknown>;
      const targetRecord = target as unknown as Record<string, unknown>;
      for (const prop of OVERRIDABLE_KEYS) {
        if (prop in patchRecord) targetRecord[prop] = patchRecord[prop];
      }
      target.overridden_by = [...target.overridden_by, category.id];
    }
  }

  // 4. Sort by (depth DESC, position ASC, label ASC).
  return acc.sort((a, b) => {
    if (a.depth !== b.depth) return b.depth - a.depth;
    const posA = typeof a.position === "number" ? a.position : 0;
    const posB = typeof b.position === "number" ? b.position : 0;
    if (posA !== posB) return posA - posB;
    return (a.label ?? "").localeCompare(b.label ?? "");
  });
}

/**
 * Assemble a nested tree from the flat list returned by get_category_tree().
 * Children are ordered by (position ASC, name ASC), matching the SQL.
 * Nodes whose parent is missing from the input are treated as roots so
 * that nothing is silently dropped.
 */
export function buildCategoryTree(flat: CategoryNode[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const node of flat) {
    byId.set(node.id, { ...node, children: [] });
  }

  const roots: CategoryNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (nodes: CategoryNode[]) => {
    nodes.sort((a, b) =>
      a.position !== b.position
        ? a.position - b.position
        : a.name.localeCompare(b.name)
    );
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);

  return roots;
}

/**
 * Compare two resolved schemas and describe what changed.
 *
 * NOTE (Phase 1): severity is a `"safe"` placeholder and
 * `affected_item_count` is 0 — this function is pure and has no access
 * to item data. Phase 5 assigns real severities and counts.
 */
export function diffSchemas(
  before: EffectiveField[],
  after: EffectiveField[]
): SchemaChange[] {
  const changes: SchemaChange[] = [];
  const beforeByKey = new Map(before.map((f) => [f.key, f]));
  const afterByKey = new Map(after.map((f) => [f.key, f]));

  const base = (kind: SchemaChange["kind"], key: string): SchemaChange => ({
    kind,
    field_key: key,
    severity: "safe",
    affected_item_count: 0,
  });

  // Added fields
  for (const field of after) {
    if (!beforeByKey.has(field.key)) {
      changes.push({ ...base("add_field", field.key), to: field });
    }
  }

  // Removed fields
  for (const field of before) {
    if (!afterByKey.has(field.key)) {
      changes.push({ ...base("remove_field", field.key), from: field });
    }
  }

  // Modified fields
  for (const field of after) {
    const prev = beforeByKey.get(field.key);
    if (!prev) continue;

    if (prev.type !== field.type) {
      changes.push({ ...base("retype_field", field.key), from: prev.type, to: field.type });
    }
    if (!prev.required && field.required) {
      changes.push({ ...base("require_field", field.key), from: false, to: true });
    }
    if (prev.required && !field.required) {
      changes.push({ ...base("unrequire_field", field.key), from: true, to: false });
    }
    if (prev.label !== field.label) {
      changes.push({ ...base("rename_label", field.key), from: prev.label, to: field.label });
    }
    if (!sameOptions(prev.options, field.options)) {
      changes.push({ ...base("change_options", field.key), from: prev.options, to: field.options });
    }

    const prevOverrides = prev.overridden_by ?? [];
    const nextOverrides = field.overridden_by ?? [];
    for (const id of nextOverrides) {
      if (!prevOverrides.includes(id)) {
        changes.push({ ...base("add_override", field.key), to: id });
      }
    }
    for (const id of prevOverrides) {
      if (!nextOverrides.includes(id)) {
        changes.push({ ...base("remove_override", field.key), from: id });
      }
    }
  }

  return changes;
}

function sameOptions(a?: string[], b?: string[]): boolean {
  if (a === b) return true;
  if (!a || !b) return (a?.length ?? 0) === (b?.length ?? 0);
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * Validate a field key against the same rule the database trigger
 * enforces (`^[a-z][a-z0-9_]*$`).
 *
 * @returns an error message fit for a toast, or null when the key is valid.
 */
export function validateFieldKey(key: string): string | null {
  if (!key || !key.trim()) return "Field key is required";
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    return `Invalid field key "${key}": use snake_case — lowercase letters, digits and underscores, starting with a letter`;
  }
  return null;
}

/**
 * Derive a URL slug from a category name.
 * Mirrors generate_category_slug() in supabase/triggers.sql:
 * lowercase → non-alphanumerics to "-" → collapse repeats → trim.
 */
export function slugify(name: string): string {
  const slug = (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "category";
}

/** Convenience: the fields a category owns, ordered for display. */
export function sortOwnFields(fields: SchemaField[]): SchemaField[] {
  return [...fields].sort((a, b) =>
    a.position !== b.position
      ? (a.position ?? 0) - (b.position ?? 0)
      : (a.label ?? "").localeCompare(b.label ?? "")
  );
}

// ── TypeScript types for SchemaShift ─────────────────────────
// Canonical shapes for the category-owned schema model (Phase 1).
// Every later phase depends on these exact names — do not rename them.

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

/** profiles table row */
export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
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

/**
 * A reusable field definition in the shared registry (Phase 6).
 *
 * A category's `SchemaField.attribute_id` points here. That back-link is
 * what turns `brand` defined on three unrelated categories into one
 * queryable concept — without it, cross-category search cannot know the
 * three fields mean the same thing.
 *
 * `label` / `options` / `unit` / `description` propagate to linked
 * fields when edited. `key` and `type` are immutable: a global retype
 * has no single blast radius to show, so it must go through the
 * per-category impact flow instead.
 */
export interface Attribute {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  options: string[];
  unit: string | null;
  description: string | null;
  /** Presentational grouping, e.g. "Physical", "Commercial". */
  group_name: string | null;
  /** Relied on by the app itself; deletion is refused. */
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

/** An attribute plus how widely it is used — from get_attributes_with_usage(). */
export interface AttributeWithUsage extends Attribute {
  category_count: number;
  item_count: number;
}

/** One category's use of an attribute — from get_attribute_usage(). */
export interface AttributeUsage {
  category_id: string;
  category_name: string;
  category_icon: string | null;
  category_color: string | null;
  field_key: string;
  required: boolean;
  item_count: number;
  subtree_item_count: number;
}

/**
 * A field key authored on several categories with no attribute linking
 * them — a promotion candidate, from find_duplicate_field_definitions().
 */
export interface DuplicateFieldDefinition {
  key: string;
  label: string;
  /** The most common type among the definitions. */
  type: FieldType;
  /** False when the definitions disagree — promotion would have to coerce. */
  types_agree: boolean;
  types: string[];
  category_count: number;
  item_count: number;
  categories: { id: string; name: string; type: FieldType; item_count: number }[];
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
  /** The AUTHORED state that produced `snapshot`. What rollback restores. */
  authored: { own_fields: SchemaField[]; overrides: Record<string, FieldOverride> };
  change_summary: SchemaChange[];
  changed_by: string | null;
  created_at: string;
}

export type ChangeKind =
  | "add_field" | "remove_field" | "retype_field"
  | "require_field" | "unrequire_field"
  | "rename_label" | "change_help_text"
  | "change_options" | "add_override" | "remove_override"
  // Not field changes: markers prepended to a version's change_summary so
  // the timeline can say what a version WAS, rather than only how its
  // fields differ. `field_key` is "__schema" / "__parent" for these.
  | "rollback" | "reparent";

export type ChangeSeverity = "safe" | "warning" | "destructive";

/**
 * How a destructive consequence is dealt with. `discard` is the only one
 * that loses data, and apply_schema_change refuses it without `confirm`.
 */
export type RemediationStrategy =
  | "backfill" | "cast" | "orphan" | "discard" | "leave";

export interface Remediation {
  strategy: RemediationStrategy;
  value?: unknown;     // required by `backfill`
  confirm?: boolean;   // required by `discard`
}

export interface SchemaChange {
  kind: ChangeKind;
  field_key: string;
  severity: ChangeSeverity;
  from?: unknown;
  to?: unknown;
  affected_item_count: number;
  lossy_item_count?: number;      // values that will not survive a type cast
  sample_values?: unknown[];      // up to 5, for the impact dialog in Phase 5
  /** Present only in a recorded change_summary: what was actually done. */
  strategy?: RemediationStrategy;
  remediated_item_count?: number;
}

/** Return shape of analyze_schema_change(). */
export interface SchemaImpact {
  category_id: string;
  current_version: number;
  next_version: number;
  affected_categories: { id: string; name: string; depth: number; item_count: number }[];
  total_affected_items: number;
  changes: SchemaChange[];
  max_severity: ChangeSeverity;
  blocked: boolean;
  blocked_reason: string | null;
}

/** Return shape of apply_schema_change(). */
export interface SchemaApplyResult {
  category_id: string;
  version: number;
  items_updated: number;
  items_orphaned: number;
  items_incomplete: number;
  change_summary: SchemaChange[];
  /** Set only by rollback_schema_version(). */
  restored_from?: number;
}

/**
 * Uniform server-action return shape. Actions resolve rather than throw
 * so the caller can surface `error` in a toast; the message is always
 * safe to show a user.
 */
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string };

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
  | "rename_label" | "change_options" | "add_override" | "remove_override"
  // Not a field change: the marker rollback_schema_version() prepends to a
  // version's change_summary so the timeline can say what a version WAS.
  | "rollback";

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

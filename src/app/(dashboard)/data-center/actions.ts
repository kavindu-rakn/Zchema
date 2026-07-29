"use server";

// ── Category server actions ──────────────────────────────────
// A Server Action is a public POST endpoint. Every mutation here
// re-checks the caller's role server-side (requireSchemaAdmin) even
// though RLS also guards the tables — rendering a button conditionally
// is not a security boundary.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import { validateFieldKey } from "@/lib/schema";
import type {
  ActionResult,
  FieldOverride,
  Remediation,
  SchemaApplyResult,
  SchemaField,
  SchemaImpact,
} from "@/lib/types";

function revalidateCategoryViews() {
  // `layout` so the Data Center's persistent tree rail refreshes too —
  // it is fetched in the layout, not the page.
  revalidatePath("/data-center", "layout");
  revalidatePath("/dashboard");
}

/**
 * Fast, precise validation of authored fields.
 *
 * The database triggers remain the authority — they also enforce
 * uniqueness across the whole ancestor/descendant chain, which the
 * client cannot see. This just produces a better message sooner.
 *
 * @returns an error message, or null when the fields are acceptable.
 */
function validateOwnFields(fields: SchemaField[]): string | null {
  const seen = new Set<string>();
  for (const field of fields) {
    const keyError = validateFieldKey(field.key);
    if (keyError) return keyError;
    if (seen.has(field.key)) {
      return `Duplicate field key "${field.key}" within this category.`;
    }
    seen.add(field.key);

    if ((field.type === "select" || field.type === "multiselect") && !field.options?.length) {
      return `Field "${field.label || field.key}" is a ${field.type} and needs at least one option.`;
    }
  }
  return null;
}

export async function createCategory(input: {
  name: string;
  parent_id?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  position?: number;
  blueprint_id?: string | null;
  /**
   * Fields to author on the new category. When the user starts from a
   * blueprint these are the COPIED fields — the category is created with
   * them in one insert rather than created-then-patched, so a failure
   * cannot leave a half-configured category behind.
   */
  own_fields?: SchemaField[];
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSchemaAdmin();

    const name = input.name?.trim();
    if (!name) return { ok: false, error: "Category name is required." };

    const ownFields = input.own_fields ?? [];
    const fieldError = validateOwnFields(ownFields);
    if (fieldError) return { ok: false, error: fieldError };

    const supabase = await createClient();
    // slug is derived by the generate_category_slug trigger when omitted.
    const { data, error } = await supabase
      .from("categories")
      .insert({
        name,
        parent_id: input.parent_id ?? null,
        description: input.description ?? null,
        icon: input.icon ?? null,
        color: input.color ?? null,
        position: input.position ?? 0,
        blueprint_id: input.blueprint_id ?? null,
        own_fields: ownFields,
      })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return actionError(error, "Could not create the category.");
  }
}

export async function updateCategory(
  id: string,
  input: {
    name?: string;
    description?: string | null;
    icon?: string | null;
    color?: string | null;
    position?: number;
  }
): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Category name cannot be empty." };
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description;
    if (input.icon !== undefined) patch.icon = input.icon;
    if (input.color !== undefined) patch.color = input.color;
    if (input.position !== undefined) patch.position = input.position;

    if (Object.keys(patch).length === 0) return { ok: true, data: null };

    const supabase = await createClient();
    const { error } = await supabase.from("categories").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not update the category.");
  }
}

/**
 * Replace a category's own_fields and/or overrides.
 *
 * Keys are checked here for a fast, precise message; the database
 * triggers remain the authority (they also enforce uniqueness across
 * the whole ancestor/descendant chain, which the client cannot see).
 */
export async function updateCategorySchema(
  id: string,
  input: {
    own_fields?: SchemaField[];
    overrides?: Record<string, FieldOverride>;
  }
): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const patch: Record<string, unknown> = {};

    if (input.own_fields !== undefined) {
      const fieldError = validateOwnFields(input.own_fields);
      if (fieldError) return { ok: false, error: fieldError };
      patch.own_fields = input.own_fields;
    }

    if (input.overrides !== undefined) patch.overrides = input.overrides;

    if (Object.keys(patch).length === 0) return { ok: true, data: null };

    const supabase = await createClient();
    const { error } = await supabase.from("categories").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not save the schema.");
  }
}

// ── Impact analysis (Phase 5) ────────────────────────────────

/**
 * What a proposed schema change would do to live item data.
 *
 * READ-ONLY, and called on every keystroke (debounced) by the schema
 * editor's severity badge, so it stays a single RPC round trip. The
 * measurement has to happen in SQL: deciding whether 48 stored values
 * survive a type cast by shipping them all to the client and casting
 * them in JavaScript would be both slow and a different answer from
 * the one Postgres will give when the change is applied.
 */
export async function analyzeSchemaChange(
  categoryId: string,
  input: { own_fields: SchemaField[]; overrides: Record<string, FieldOverride> }
): Promise<ActionResult<SchemaImpact>> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("analyze_schema_change", {
      p_category_id: categoryId,
      p_new_own_fields: input.own_fields,
      p_new_overrides: input.overrides,
    });

    if (error) throw new Error(error.message);
    return { ok: true, data: data as SchemaImpact };
  } catch (error) {
    return actionError(error, "Could not analyse the impact of this change.");
  }
}

/**
 * Apply a schema change with an explicit remediation per destructive
 * consequence.
 *
 * The whole migration — category rewrite, item remediation, version
 * rows for the category and every descendant — happens inside one
 * database function, so it is one transaction. Splitting it across
 * several PostgREST calls would make a partial migration possible.
 *
 * Note this does NOT go through updateCategorySchema: that path writes
 * the category and nothing else, which is exactly the silent data loss
 * this phase exists to prevent.
 */
export async function applySchemaChange(
  categoryId: string,
  input: {
    own_fields: SchemaField[];
    overrides: Record<string, FieldOverride>;
    /** Keyed by `<field_key>` or `<field_key>:<kind>`. */
    remediations?: Record<string, Remediation>;
  }
): Promise<ActionResult<SchemaApplyResult>> {
  try {
    const profile = await requireSchemaAdmin();

    const fieldError = validateOwnFields(input.own_fields);
    if (fieldError) return { ok: false, error: fieldError };

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("apply_schema_change", {
      p_category_id: categoryId,
      p_new_own_fields: input.own_fields,
      p_new_overrides: input.overrides,
      p_remediations: input.remediations ?? {},
      p_changed_by: profile.id,
    });

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: data as SchemaApplyResult };
  } catch (error) {
    return actionError(error, "Could not apply the schema change.");
  }
}

/**
 * Restore a recorded version's authored schema.
 *
 * Writes a NEW forward version rather than deleting the ones after it —
 * an audit trail that can be edited is not an audit trail. Item data is
 * not reverted; the caller must say so before invoking this.
 */
export async function rollbackSchemaVersion(
  categoryId: string,
  targetVersion: number
): Promise<ActionResult<SchemaApplyResult>> {
  try {
    const profile = await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("rollback_schema_version", {
      p_category_id: categoryId,
      p_target_version: targetVersion,
      p_changed_by: profile.id,
    });

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: data as SchemaApplyResult };
  } catch (error) {
    return actionError(error, "Could not restore that version.");
  }
}

/**
 * Copy a blueprint's fields into a category's own_fields.
 *
 * Blueprints are presets, not live links: this COPIES. `blueprint_id`
 * is recorded as provenance only. Fields whose key already exists on
 * the category (or is inherited) are skipped rather than clobbering.
 */
export async function applyBlueprint(
  categoryId: string,
  blueprintId: string
): Promise<ActionResult<{ added: number; skipped: string[] }>> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();

    const [{ data: blueprint, error: blueprintError }, { data: category, error: categoryError }] =
      await Promise.all([
        supabase.from("blueprints").select("fields").eq("id", blueprintId).single(),
        supabase.from("categories").select("own_fields").eq("id", categoryId).single(),
      ]);

    if (blueprintError) throw new Error(blueprintError.message);
    if (categoryError) throw new Error(categoryError.message);

    const existing: SchemaField[] = Array.isArray(category?.own_fields) ? category.own_fields : [];
    const incoming: SchemaField[] = Array.isArray(blueprint?.fields) ? blueprint.fields : [];

    const existingKeys = new Set(existing.map((f) => f.key));
    const skipped: string[] = [];
    const added: SchemaField[] = [];

    let nextPosition = existing.reduce((max, f) => Math.max(max, f.position ?? 0), -1) + 1;

    for (const field of incoming) {
      if (existingKeys.has(field.key)) {
        skipped.push(field.key);
        continue;
      }
      existingKeys.add(field.key);
      added.push({ ...field, position: nextPosition++ });
    }

    const { error } = await supabase
      .from("categories")
      .update({ own_fields: [...existing, ...added], blueprint_id: blueprintId })
      .eq("id", categoryId);

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: { added: added.length, skipped } };
  } catch (error) {
    return actionError(error, "Could not apply the blueprint.");
  }
}

// ── Structural operations (Phase 5) ──────────────────────────
// Re-parenting and deleting are routed through the same impact
// machinery as a schema edit. There is exactly one place where "this
// will break things" is explained, and one set of remediation rules
// deciding what happens to the values caught in the middle.

/**
 * What a re-parent would do, before doing it.
 *
 * Returns the same shape as `analyzeSchemaChange`, because it is the
 * same question: a move swaps the entire inherited half of the
 * subtree's schema, so fields appear, fields disappear, and values
 * have to go somewhere.
 */
export async function analyzeCategoryMove(
  categoryId: string,
  newParentId: string | null
): Promise<ActionResult<SchemaImpact>> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("analyze_category_move", {
      p_category_id: categoryId,
      p_new_parent_id: newParentId,
    });

    if (error) throw new Error(error.message);
    return { ok: true, data: data as SchemaImpact };
  } catch (error) {
    return actionError(error, "Could not work out what this move would do.");
  }
}

/**
 * Re-parent a category, applying the chosen remediation to every value
 * that the move strands. One transaction, in the database.
 */
export async function applyCategoryMove(
  categoryId: string,
  newParentId: string | null,
  remediations?: Record<string, Remediation>
): Promise<ActionResult<SchemaApplyResult>> {
  try {
    const profile = await requireSchemaAdmin();

    if (categoryId === newParentId) {
      return { ok: false, error: "A category cannot be its own parent." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("apply_category_move", {
      p_category_id: categoryId,
      p_new_parent_id: newParentId,
      p_remediations: remediations ?? {},
      p_changed_by: profile.id,
    });

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: data as SchemaApplyResult };
  } catch (error) {
    return actionError(error, "Could not move the category.");
  }
}

export interface CategoryDeletePreview {
  category_id: string;
  parent_id: string | null;
  parent_name: string | null;
  descendant_count: number;
  item_count: number;
  can_move_to_parent: boolean;
  /** Item values that would survive a move to the parent. */
  carried_keys: string[];
  /** Item values that would become orphaned data on the parent. */
  orphaned_keys: string[];
}

/** What a delete would destroy, and whether the items can be rescued. */
export async function previewCategoryDelete(
  categoryId: string
): Promise<ActionResult<CategoryDeletePreview>> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("preview_category_delete", {
      p_category_id: categoryId,
    });

    if (error) throw new Error(error.message);
    return { ok: true, data: data as CategoryDeletePreview };
  } catch (error) {
    return actionError(error, "Could not work out what deleting this would do.");
  }
}

/**
 * Delete a category, optionally rescuing its items to the parent first.
 *
 * Cascade-deleting 48 items behind a plain confirm is the single most
 * dangerous thing this app can do, so the alternative is offered in the
 * same transaction rather than left to the user to arrange by hand.
 */
export async function deleteCategory(
  id: string,
  options?: { moveItemsToParent?: boolean }
): Promise<
  ActionResult<{
    deleted_categories: number;
    moved_items: number;
    orphaned_values: number;
    deleted_items: number;
  }>
> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("delete_category_safely", {
      p_category_id: id,
      p_move_items_to_parent: options?.moveItemsToParent ?? false,
    });

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return {
      ok: true,
      data: data as {
        deleted_categories: number;
        moved_items: number;
        orphaned_values: number;
        deleted_items: number;
      },
    };
  } catch (error) {
    return actionError(error, "Could not delete the category.");
  }
}

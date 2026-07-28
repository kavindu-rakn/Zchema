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
import type { ActionResult, FieldOverride, SchemaField } from "@/lib/types";

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

export async function deleteCategory(id: string): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not delete the category.");
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

/**
 * What a re-parent would do, before doing it.
 *
 * Full impact analysis lands in Phase 5; this is the blocking check
 * plus enough plain language to make the consequence obvious:
 *   - which inherited fields are lost and gained
 *   - which items hold values for a field that is about to disappear
 *   - whether a key collision makes the move impossible at all
 */
export async function previewCategoryMove(
  categoryId: string,
  newParentId: string | null
): Promise<
  ActionResult<{
    blocked: boolean;
    collisions: string[];
    losing: string[];
    gaining: string[];
    keeping: string[];
    affectedItemCount: number;
  }>
> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();

    // Descendants (plus self) — a move re-roots the whole subtree.
    const { data: subtreeRows, error: subtreeError } = await supabase.rpc(
      "get_category_subtree",
      { p_category_id: categoryId }
    );
    if (subtreeError) throw new Error(subtreeError.message);
    const subtreeIds = ((subtreeRows ?? []) as { id: string }[]).map((row) => row.id);

    if (newParentId && subtreeIds.includes(newParentId)) {
      return {
        ok: false,
        error: "You cannot move a category into itself or one of its own descendants.",
      };
    }

    const [currentRes, parentRes, subtreeCatsRes] = await Promise.all([
      supabase.rpc("get_effective_schema", { p_category_id: categoryId }),
      newParentId
        ? supabase.rpc("get_effective_schema", { p_category_id: newParentId })
        : Promise.resolve({ data: [], error: null }),
      supabase.from("categories").select("id, own_fields").in("id", subtreeIds),
    ]);

    if (currentRes.error) throw new Error(currentRes.error.message);
    if (parentRes.error) throw new Error(parentRes.error.message);
    if (subtreeCatsRes.error) throw new Error(subtreeCatsRes.error.message);

    const current = (currentRes.data ?? []) as { key: string; inherited: boolean }[];
    const newInherited = (parentRes.data ?? []) as { key: string }[];

    const currentInheritedKeys = current.filter((f) => f.inherited).map((f) => f.key);
    const newInheritedKeys = newInherited.map((f) => f.key);

    const losing = currentInheritedKeys.filter((key) => !newInheritedKeys.includes(key));
    const gaining = newInheritedKeys.filter((key) => !currentInheritedKeys.includes(key));
    const keeping = current.filter((f) => !f.inherited).map((f) => f.key);

    // A key this subtree AUTHORS cannot also be inherited from the new
    // parent — the DB trigger rejects it, so block here with the name.
    const subtreeOwnKeys = new Set<string>();
    for (const row of (subtreeCatsRes.data ?? []) as { own_fields: SchemaField[] }[]) {
      for (const field of row.own_fields ?? []) subtreeOwnKeys.add(field.key);
    }
    const collisions = newInheritedKeys.filter((key) => subtreeOwnKeys.has(key));

    // Items in the subtree holding a value for a field about to vanish.
    let affectedItemCount = 0;
    if (losing.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from("items")
        .select("data")
        .in("category_id", subtreeIds);
      if (itemsError) throw new Error(itemsError.message);

      affectedItemCount = ((items ?? []) as { data: Record<string, unknown> }[]).filter((item) =>
        losing.some((key) => {
          const value = item.data?.[key];
          return value !== undefined && value !== null && value !== "";
        })
      ).length;
    }

    return {
      ok: true,
      data: {
        blocked: collisions.length > 0,
        collisions,
        losing,
        gaining,
        keeping,
        affectedItemCount,
      },
    };
  } catch (error) {
    return actionError(error, "Could not work out what this move would do.");
  }
}

/**
 * Re-parent a category. The database rejects cycles
 * (prevent_category_cycle) and any move that would make a descendant
 * redefine a newly-inherited field (validate_category_fields).
 */
export async function moveCategory(
  id: string,
  newParentId: string | null
): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    if (id === newParentId) {
      return { ok: false, error: "A category cannot be its own parent." };
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("categories")
      .update({ parent_id: newParentId })
      .eq("id", id);

    if (error) throw new Error(error.message);

    revalidateCategoryViews();
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not move the category.");
  }
}

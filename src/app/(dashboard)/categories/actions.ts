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
  revalidatePath("/categories");
  revalidatePath("/dashboard");
}

export async function createCategory(input: {
  name: string;
  parent_id?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  position?: number;
  blueprint_id?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSchemaAdmin();

    const name = input.name?.trim();
    if (!name) return { ok: false, error: "Category name is required." };

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
      const seen = new Set<string>();
      for (const field of input.own_fields) {
        const keyError = validateFieldKey(field.key);
        if (keyError) return { ok: false, error: keyError };
        if (seen.has(field.key)) {
          return { ok: false, error: `Duplicate field key "${field.key}" within this category.` };
        }
        seen.add(field.key);

        if ((field.type === "select" || field.type === "multiselect") && !field.options?.length) {
          return {
            ok: false,
            error: `Field "${field.label || field.key}" is a ${field.type} and needs at least one option.`,
          };
        }
      }
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

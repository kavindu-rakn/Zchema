"use server";

// ── Blueprint server actions ─────────────────────────────────
// Successor to the old templates/actions.ts. Blueprints are optional
// starter presets: creating or editing one never changes an existing
// category, because applying a blueprint copies its fields.
//
// The predecessor left updateTemplate/deleteTemplate with NO auth check
// at all. Every mutation here is SCHEMA_ADMIN-gated server-side.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import { validateFieldKey } from "@/lib/schema";
import type { ActionResult, SchemaField } from "@/lib/types";

/** Shared field validation for blueprint payloads. */
function validateFields(fields: SchemaField[]): string | null {
  const seen = new Set<string>();
  for (const field of fields) {
    const keyError = validateFieldKey(field.key);
    if (keyError) return keyError;
    if (seen.has(field.key)) return `Duplicate field key "${field.key}" in this blueprint.`;
    seen.add(field.key);

    if ((field.type === "select" || field.type === "multiselect") && !field.options?.length) {
      return `Field "${field.label || field.key}" is a ${field.type} and needs at least one option.`;
    }
  }
  return null;
}

export async function createBlueprint(input: {
  name: string;
  description?: string | null;
  fields?: SchemaField[];
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSchemaAdmin();

    const name = input.name?.trim();
    if (!name) return { ok: false, error: "Blueprint name is required." };

    const fields = input.fields ?? [];
    const fieldError = validateFields(fields);
    if (fieldError) return { ok: false, error: fieldError };

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("blueprints")
      .insert({ name, description: input.description ?? null, fields })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath("/data-center/blueprints");
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return actionError(error, "Could not create the blueprint.");
  }
}

export async function updateBlueprint(
  id: string,
  input: { name?: string; description?: string | null; fields?: SchemaField[] }
): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const patch: Record<string, unknown> = {};

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) return { ok: false, error: "Blueprint name cannot be empty." };
      patch.name = name;
    }
    if (input.description !== undefined) patch.description = input.description;
    if (input.fields !== undefined) {
      const fieldError = validateFields(input.fields);
      if (fieldError) return { ok: false, error: fieldError };
      patch.fields = input.fields;
    }

    if (Object.keys(patch).length === 0) return { ok: true, data: null };

    const supabase = await createClient();
    const { error } = await supabase.from("blueprints").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/data-center/blueprints");
    revalidatePath(`/data-center/blueprints/${id}`);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not update the blueprint.");
  }
}

export async function deleteBlueprint(id: string): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    // Categories keep their fields: applying a blueprint copied them,
    // and `blueprint_id` is ON DELETE SET NULL, so this only erases the
    // provenance note.
    const { error } = await supabase.from("blueprints").delete().eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/data-center/blueprints");
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not delete the blueprint.");
  }
}

/**
 * What applying a blueprint to a category would copy, and what it
 * would skip.
 *
 * A field is skipped when its key already exists anywhere in the
 * category's effective chain — the database would reject the write, and
 * "skipped 3 fields" without saying why is not an explanation.
 */
export async function previewBlueprintApply(
  blueprintId: string,
  categoryId: string
): Promise<
  ActionResult<{
    categoryName: string;
    adding: { key: string; label: string; type: string }[];
    skipped: { key: string; reason: string }[];
  }>
> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const [blueprintRes, categoryRes, schemaRes] = await Promise.all([
      supabase.from("blueprints").select("fields").eq("id", blueprintId).single(),
      supabase.from("categories").select("name").eq("id", categoryId).single(),
      supabase.rpc("get_effective_schema", { p_category_id: categoryId }),
    ]);

    if (blueprintRes.error) throw new Error(blueprintRes.error.message);
    if (categoryRes.error) throw new Error(categoryRes.error.message);
    if (schemaRes.error) throw new Error(schemaRes.error.message);

    const fields = (blueprintRes.data?.fields ?? []) as SchemaField[];
    const effective = (schemaRes.data ?? []) as {
      key: string;
      inherited: boolean;
      source_category_name: string;
    }[];
    const existing = new Map(effective.map((field) => [field.key, field]));

    const adding: { key: string; label: string; type: string }[] = [];
    const skipped: { key: string; reason: string }[] = [];

    for (const field of fields) {
      const clash = existing.get(field.key);
      if (clash) {
        skipped.push({
          key: field.key,
          reason: clash.inherited
            ? `already inherited from ${clash.source_category_name}`
            : "already defined on this category",
        });
      } else {
        adding.push({ key: field.key, label: field.label, type: field.type });
      }
    }

    return {
      ok: true,
      data: { categoryName: categoryRes.data?.name ?? "", adding, skipped },
    };
  } catch (error) {
    return actionError(error, "Could not preview the blueprint.");
  }
}

/**
 * Promote a category's own fields into a reusable blueprint.
 *
 * This is how a blueprint library actually gets built: by promoting
 * something that already worked, not by authoring in the abstract.
 * Only `own_fields` are captured — inherited fields belong to the
 * ancestors that define them.
 */
export async function createBlueprintFromCategory(
  categoryId: string,
  input: { name: string; description?: string | null }
): Promise<ActionResult<{ id: string; fieldCount: number }>> {
  try {
    await requireSchemaAdmin();

    const name = input.name?.trim();
    if (!name) return { ok: false, error: "Blueprint name is required." };

    const supabase = await createClient();
    const { data: category, error: categoryError } = await supabase
      .from("categories")
      .select("own_fields")
      .eq("id", categoryId)
      .single();
    if (categoryError) throw new Error(categoryError.message);

    const fields = (category?.own_fields ?? []) as SchemaField[];
    if (fields.length === 0) {
      return {
        ok: false,
        error: "This category defines no fields of its own, so there is nothing to save.",
      };
    }

    const { data, error } = await supabase
      .from("blueprints")
      .insert({ name, description: input.description ?? null, fields })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath("/data-center/blueprints");
    return { ok: true, data: { id: data.id as string, fieldCount: fields.length } };
  } catch (error) {
    return actionError(error, "Could not save this category as a blueprint.");
  }
}

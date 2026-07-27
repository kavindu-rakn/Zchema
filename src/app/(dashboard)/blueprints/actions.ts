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

    revalidatePath("/blueprints");
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

    revalidatePath("/blueprints");
    revalidatePath(`/blueprints/${id}`);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not update the blueprint.");
  }
}

export async function deleteBlueprint(id: string): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { error } = await supabase.from("blueprints").delete().eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath("/blueprints");
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not delete the blueprint.");
  }
}

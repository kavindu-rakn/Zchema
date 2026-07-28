"use server";

// ── Item server actions ──────────────────────────────────────
// Items are validated against the category's EFFECTIVE schema
// (inherited + own + overrides), not against a single template.
//
// Reads live in src/lib/data/items.ts — a 'use server' module may only
// export async functions, and queries do not need to be actions.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireDataEditor } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import { getEffectiveSchema } from "@/lib/data/categories";
import type { ActionResult, EffectiveField } from "@/lib/types";

/** Reject blank values for fields the effective schema marks required. */
function findMissingRequired(
  schema: EffectiveField[],
  data: Record<string, unknown>
): string | null {
  for (const field of schema) {
    if (!field.required) continue;
    const value = data[field.key];
    const isBlank =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);
    if (isBlank) return `"${field.label}" is required.`;
  }
  return null;
}

export async function createItem(
  categoryId: string,
  data: Record<string, unknown>
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireDataEditor();

    const schema = await getEffectiveSchema(categoryId);
    const missing = findMissingRequired(schema, data);
    if (missing) return { ok: false, error: missing };

    const supabase = await createClient();
    const { data: created, error } = await supabase
      .from("items")
      .insert({ category_id: categoryId, data })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    revalidatePath(`/data-center/${categoryId}`);
    return { ok: true, data: { id: created.id as string } };
  } catch (error) {
    return actionError(error, "Could not create the item.");
  }
}

export async function updateItem(
  id: string,
  categoryId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  try {
    await requireDataEditor();

    const schema = await getEffectiveSchema(categoryId);
    const missing = findMissingRequired(schema, data);
    if (missing) return { ok: false, error: missing };

    const supabase = await createClient();
    const { error } = await supabase.from("items").update({ data }).eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath(`/data-center/${categoryId}`);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not update the item.");
  }
}

export async function deleteItem(id: string, categoryId: string): Promise<ActionResult> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const { error } = await supabase.from("items").delete().eq("id", id);
    if (error) throw new Error(error.message);

    revalidatePath(`/data-center/${categoryId}`);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not delete the item.");
  }
}

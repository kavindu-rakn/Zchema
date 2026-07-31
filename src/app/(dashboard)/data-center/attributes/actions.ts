"use server";

// ── Attribute registry server actions ────────────────────────
// Every mutation re-checks the caller's role server-side. A Server
// Action is a public POST endpoint; hiding a button is not a boundary.
//
// The interesting constraint here is what these actions REFUSE. An
// attribute's key and type are immutable — the database rejects them
// too, but failing here gives a message written for a toast rather
// than a trigger error.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import { validateFieldKey } from "@/lib/schema";
import type { ActionResult, Attribute, FieldType } from "@/lib/types";

/** The library itself. Creating an attribute changes nothing else. */
function revalidateLibrary() {
  revalidatePath("/data-center/attributes", "layout");
}

/**
 * The library AND the category workspace.
 *
 * Only for mutations that actually reach into categories: a label edit
 * propagates into every linked field, promotion writes `attribute_id`
 * onto them, and deletion strips it. Creating an attribute touches no
 * category, so it does not pay for this.
 */
function revalidateLibraryAndCategories() {
  revalidatePath("/data-center/attributes", "layout");
  revalidatePath("/data-center", "layout");
}

export async function createAttribute(input: {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  unit?: string | null;
  description?: string | null;
  group_name?: string | null;
}): Promise<ActionResult<{ id: string }>> {
  try {
    await requireSchemaAdmin();

    const key = input.key?.trim();
    const keyError = validateFieldKey(key);
    if (keyError) return { ok: false, error: keyError };

    const label = input.label?.trim();
    if (!label) return { ok: false, error: "A label is required." };

    if (
      (input.type === "select" || input.type === "multiselect") &&
      !input.options?.length
    ) {
      return { ok: false, error: `A ${input.type} attribute needs at least one option.` };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("attributes")
      .insert({
        key,
        label,
        type: input.type,
        options: input.options ?? [],
        unit: input.unit?.trim() || null,
        description: input.description?.trim() || null,
        group_name: input.group_name?.trim() || null,
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        return { ok: false, error: `An attribute called “${key}” already exists.` };
      }
      throw new Error(error.message);
    }

    revalidateLibrary();
    return { ok: true, data: { id: data.id as string } };
  } catch (error) {
    return actionError(error, "Could not create the attribute.");
  }
}

/**
 * Update an attribute's presentation.
 *
 * `key` and `type` are deliberately absent from the input type. They
 * are not editable at any layer: the database trigger rejects them,
 * and a global retype has no single blast radius to show — that change
 * belongs on each category's Schema tab, where Phase 5 measures it
 * against that category's own items.
 */
export async function updateAttribute(
  id: string,
  input: {
    label?: string;
    options?: string[];
    unit?: string | null;
    description?: string | null;
    group_name?: string | null;
  }
): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const patch: Record<string, unknown> = {};

    if (input.label !== undefined) {
      const label = input.label.trim();
      if (!label) return { ok: false, error: "A label is required." };
      patch.label = label;
    }
    if (input.options !== undefined) patch.options = input.options;
    if (input.unit !== undefined) patch.unit = input.unit?.trim() || null;
    if (input.description !== undefined) patch.description = input.description?.trim() || null;
    if (input.group_name !== undefined) patch.group_name = input.group_name?.trim() || null;

    if (Object.keys(patch).length === 0) return { ok: true, data: null };

    const supabase = await createClient();
    const { error } = await supabase.from("attributes").update(patch).eq("id", id);
    if (error) throw new Error(error.message);

    revalidateLibraryAndCategories();
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not save the attribute.");
  }
}

/**
 * Delete an attribute.
 *
 * The linked FIELDS survive — they hold live item data, and the link is
 * provenance. The database trigger strips `attribute_id` and leaves
 * every field standing.
 */
export async function deleteAttribute(id: string): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { error } = await supabase.from("attributes").delete().eq("id", id);
    if (error) throw new Error(error.message);

    revalidateLibraryAndCategories();
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not delete the attribute.");
  }
}

/**
 * Promote a field defined on several categories into one attribute,
 * back-linking every definition whose type matches.
 *
 * Mismatched types are reported, not coerced.
 */
export async function promoteFieldToAttribute(
  categoryId: string,
  fieldKey: string,
  groupName?: string | null
): Promise<
  ActionResult<{
    attribute_id: string;
    key: string;
    type: FieldType;
    linked: number;
    skipped: { id: string; name: string; type: string }[];
  }>
> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("promote_field_to_attribute", {
      p_category_id: categoryId,
      p_field_key: fieldKey,
      p_group_name: groupName ?? null,
    });

    if (error) throw new Error(error.message);

    revalidateLibraryAndCategories();
    return {
      ok: true,
      data: data as {
        attribute_id: string;
        key: string;
        type: FieldType;
        linked: number;
        skipped: { id: string; name: string; type: string }[];
      },
    };
  } catch (error) {
    return actionError(error, "Could not promote that field.");
  }
}

/** Every attribute, for the schema editor's picker. */
export async function listAttributes(): Promise<ActionResult<Attribute[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("attributes")
      .select("*")
      .order("group_name", { ascending: true, nullsFirst: false })
      .order("label", { ascending: true });

    if (error) throw new Error(error.message);
    return { ok: true, data: (data ?? []) as Attribute[] };
  } catch (error) {
    return actionError(error, "Could not load the attribute library.");
  }
}

"use server";

// ── Item server actions ──────────────────────────────────────
// Every action here follows the same five rules:
//
//   1. Re-check the caller's role SERVER-SIDE. A Server Action is a
//      public POST endpoint; the UI having hidden the button proves
//      nothing, and an RLS policy violation is a poor error message.
//   2. Validate against an effective schema WE fetch. Accepting a
//      client-supplied schema would be a trivial way to write
//      arbitrary keys into `data`.
//   3. Strip unknown keys (except `__orphaned`).
//   4. Stamp `schema_version` at write time.
//   5. Revalidate only the affected category route.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireDataEditor, requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import { ORPHAN_KEY, isBlank, normaliseForSave, validateItemData } from "@/lib/items";
import type { ActionResult, EffectiveField, SchemaField } from "@/lib/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** The category's current schema version, defaulting to 1. */
async function currentSchemaVersion(
  supabase: Supabase,
  categoryId: string
): Promise<number> {
  const { data } = await supabase
    .from("schema_versions")
    .select("version")
    .eq("category_id", categoryId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.version as number) ?? 1;
}

/** Effective schema, fetched here rather than trusted from the caller. */
async function fetchSchema(
  supabase: Supabase,
  categoryId: string
): Promise<EffectiveField[]> {
  const { data, error } = await supabase.rpc("get_effective_schema", {
    p_category_id: categoryId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EffectiveField[];
}

/** First validation error, formatted for a toast. */
function firstError(errors: Record<string, string>): string | null {
  const keys = Object.keys(errors);
  if (keys.length === 0) return null;
  const extra = keys.length - 1;
  return extra > 0 ? `${errors[keys[0]]} (and ${extra} more)` : errors[keys[0]];
}

function revalidateCategory(categoryId: string) {
  revalidatePath(`/data-center/${categoryId}`);
}

export async function createItem(
  categoryId: string,
  data: Record<string, unknown>
): Promise<ActionResult<{ id: string }>> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const schema = await fetchSchema(supabase, categoryId);

    const invalid = firstError(validateItemData(schema, data));
    if (invalid) return { ok: false, error: invalid };

    const clean = normaliseForSave(schema, data);
    const version = await currentSchemaVersion(supabase, categoryId);

    const { data: created, error } = await supabase
      .from("items")
      .insert({ category_id: categoryId, data: clean, schema_version: version })
      .select("id")
      .single();

    if (error) throw new Error(error.message);

    revalidateCategory(categoryId);
    return { ok: true, data: { id: created.id as string } };
  } catch (error) {
    return actionError(error, "Could not create the item.");
  }
}

export async function updateItem(
  itemId: string,
  categoryId: string,
  data: Record<string, unknown>
): Promise<ActionResult> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const schema = await fetchSchema(supabase, categoryId);

    const invalid = firstError(validateItemData(schema, data));
    if (invalid) return { ok: false, error: invalid };

    const clean = normaliseForSave(schema, data);
    const version = await currentSchemaVersion(supabase, categoryId);

    const { error } = await supabase
      .from("items")
      .update({ data: clean, schema_version: version })
      .eq("id", itemId);

    if (error) throw new Error(error.message);

    revalidateCategory(categoryId);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not update the item.");
  }
}

export async function deleteItem(
  itemId: string,
  categoryId: string
): Promise<ActionResult> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const { error } = await supabase.from("items").delete().eq("id", itemId);
    if (error) throw new Error(error.message);

    revalidateCategory(categoryId);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not delete the item.");
  }
}

export async function deleteItems(
  itemIds: string[],
  categoryId: string
): Promise<ActionResult<{ deleted: number }>> {
  try {
    await requireDataEditor();
    if (itemIds.length === 0) return { ok: true, data: { deleted: 0 } };

    const supabase = await createClient();
    const { error, count } = await supabase
      .from("items")
      .delete({ count: "exact" })
      .in("id", itemIds);

    if (error) throw new Error(error.message);

    revalidateCategory(categoryId);
    return { ok: true, data: { deleted: count ?? itemIds.length } };
  } catch (error) {
    return actionError(error, "Could not delete those items.");
  }
}

/**
 * Set one field to one value across many items.
 *
 * The fastest way out of the mess a newly-required field creates —
 * Phase 5's impact dialog links straight here.
 */
export async function setFieldValue(
  itemIds: string[],
  categoryId: string,
  key: string,
  value: unknown
): Promise<ActionResult<{ updated: number }>> {
  try {
    await requireDataEditor();
    if (itemIds.length === 0) return { ok: true, data: { updated: 0 } };

    const supabase = await createClient();
    const schema = await fetchSchema(supabase, categoryId);

    const field = schema.find((candidate) => candidate.key === key);
    if (!field) {
      return { ok: false, error: `“${key}” is not a field on this category.` };
    }

    // Validate the single value the same way the form would.
    const invalid = firstError(validateItemData([field], { [key]: value }));
    if (invalid) return { ok: false, error: invalid };

    const { data: rows, error: readError } = await supabase
      .from("items")
      .select("id, data")
      .in("id", itemIds);
    if (readError) throw new Error(readError.message);

    const cleanValue = normaliseForSave([field], { [key]: value })[key];
    const version = await currentSchemaVersion(supabase, categoryId);

    let updated = 0;
    for (const row of (rows ?? []) as { id: string; data: Record<string, unknown> }[]) {
      const next = { ...row.data };
      if (isBlank(cleanValue)) delete next[key];
      else next[key] = cleanValue;

      const { error } = await supabase
        .from("items")
        .update({ data: next, schema_version: version })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
      updated += 1;
    }

    revalidateCategory(categoryId);
    return { ok: true, data: { updated } };
  } catch (error) {
    return actionError(error, "Could not update those items.");
  }
}

/**
 * What moving these items into another category would do — before it
 * happens. Three outcomes per value: carried, orphaned, or a required
 * gap opened up in the target.
 */
export async function previewItemMove(
  itemIds: string[],
  targetCategoryId: string
): Promise<
  ActionResult<{
    targetName: string;
    carried: string[];
    orphaned: string[];
    missingRequired: string[];
    itemCount: number;
  }>
> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const [{ data: items, error: itemsError }, { data: target, error: targetError }] =
      await Promise.all([
        supabase.from("items").select("id, category_id, data").in("id", itemIds),
        supabase.from("categories").select("name").eq("id", targetCategoryId).single(),
      ]);

    if (itemsError) throw new Error(itemsError.message);
    if (targetError) throw new Error(targetError.message);

    const targetSchema = await fetchSchema(supabase, targetCategoryId);
    const targetKeys = new Set(targetSchema.map((field) => field.key));

    const sourceIds = [
      ...new Set(
        ((items ?? []) as { category_id: string }[]).map((item) => item.category_id)
      ),
    ].filter((id) => id !== targetCategoryId);

    const sourceSchemas = await Promise.all(
      sourceIds.map((id) => fetchSchema(supabase, id))
    );

    const carried = new Set<string>();
    const orphaned = new Set<string>();
    for (const schema of sourceSchemas) {
      for (const field of schema) {
        if (targetKeys.has(field.key)) carried.add(field.key);
        else orphaned.add(field.key);
      }
    }

    // Required in the target but absent from every source schema: those
    // items land incomplete.
    const sourceKeys = new Set(sourceSchemas.flat().map((field) => field.key));
    const missingRequired = targetSchema
      .filter((field) => field.required && !sourceKeys.has(field.key))
      .map((field) => field.key);

    return {
      ok: true,
      data: {
        targetName: target?.name ?? "",
        carried: [...carried],
        orphaned: [...orphaned],
        missingRequired,
        itemCount: (items ?? []).length,
      },
    };
  } catch (error) {
    return actionError(error, "Could not work out what this move would do.");
  }
}

/**
 * Move items to another category, reconciling their data in a single
 * transaction (see move_items in functions.sql).
 */
export async function moveItems(
  itemIds: string[],
  targetCategoryId: string,
  fromCategoryId: string
): Promise<ActionResult<{ moved: number; carried: number; orphaned: number }>> {
  try {
    await requireDataEditor();
    if (itemIds.length === 0) {
      return { ok: true, data: { moved: 0, carried: 0, orphaned: 0 } };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("move_items", {
      p_item_ids: itemIds,
      p_target_category_id: targetCategoryId,
    });
    if (error) throw new Error(error.message);

    revalidateCategory(fromCategoryId);
    revalidateCategory(targetCategoryId);

    return {
      ok: true,
      data: (data ?? { moved: 0, carried: 0, orphaned: 0 }) as {
        moved: number;
        carried: number;
        orphaned: number;
      },
    };
  } catch (error) {
    return actionError(error, "Could not move those items.");
  }
}

/**
 * Recreate a removed field on the category and put the orphaned value
 * back into the item.
 *
 * Restoring the SCHEMA is an admin act, so this needs more than
 * DATA_EDITOR — the field reappears for every item in the category.
 */
export async function restoreOrphanedValue(
  itemId: string,
  categoryId: string,
  key: string
): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const [{ data: item, error: itemError }, { data: category, error: categoryError }] =
      await Promise.all([
        supabase.from("items").select("data").eq("id", itemId).single(),
        supabase.from("categories").select("own_fields").eq("id", categoryId).single(),
      ]);

    if (itemError) throw new Error(itemError.message);
    if (categoryError) throw new Error(categoryError.message);

    const data = (item?.data ?? {}) as Record<string, unknown>;
    const orphans = (data[ORPHAN_KEY] ?? {}) as Record<string, unknown>;
    if (!(key in orphans)) {
      return { ok: false, error: `“${key}” is no longer in this item's orphaned data.` };
    }

    const schema = await fetchSchema(supabase, categoryId);
    const value = orphans[key];

    // Recreate the field only if the chain does not already have it —
    // it may have been restored from another item already.
    if (!schema.some((field) => field.key === key)) {
      const ownFields = (category?.own_fields ?? []) as SchemaField[];
      const restored: SchemaField = {
        key,
        label: key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type: typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string",
        required: false,
        position: ownFields.length,
      };

      const { error: schemaError } = await supabase
        .from("categories")
        .update({ own_fields: [...ownFields, restored] })
        .eq("id", categoryId);
      if (schemaError) throw new Error(schemaError.message);
    }

    const nextOrphans = { ...orphans };
    delete nextOrphans[key];
    const nextData: Record<string, unknown> = { ...data, [key]: value };
    if (Object.keys(nextOrphans).length > 0) nextData[ORPHAN_KEY] = nextOrphans;
    else delete nextData[ORPHAN_KEY];

    const { error } = await supabase.from("items").update({ data: nextData }).eq("id", itemId);
    if (error) throw new Error(error.message);

    revalidatePath("/data-center", "layout");
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not restore that value.");
  }
}

/** Drop one orphaned value for good. */
export async function discardOrphanedValue(
  itemId: string,
  categoryId: string,
  key: string
): Promise<ActionResult> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const { data: item, error: itemError } = await supabase
      .from("items")
      .select("data")
      .eq("id", itemId)
      .single();
    if (itemError) throw new Error(itemError.message);

    const data = (item?.data ?? {}) as Record<string, unknown>;
    const orphans = { ...((data[ORPHAN_KEY] ?? {}) as Record<string, unknown>) };
    delete orphans[key];

    const nextData: Record<string, unknown> = { ...data };
    if (Object.keys(orphans).length > 0) nextData[ORPHAN_KEY] = orphans;
    else delete nextData[ORPHAN_KEY];

    const { error } = await supabase.from("items").update({ data: nextData }).eq("id", itemId);
    if (error) throw new Error(error.message);

    revalidateCategory(categoryId);
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not discard that value.");
  }
}

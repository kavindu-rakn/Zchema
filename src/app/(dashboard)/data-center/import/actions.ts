"use server";

// ── Import server actions ────────────────────────────────────
// Parsing and inference happen on the CLIENT — they are pure functions
// over text the user already has, and shipping a 5MB CSV to the server
// just to count its columns would make the first step feel broken.
//
// Only the final write crosses the wire, and it goes through one
// database function so the whole import is one transaction.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireDataEditor } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import type { ActionResult, EffectiveField, SchemaField } from "@/lib/types";

export interface ImportOutcome {
  category_id: string;
  created: boolean;
  fields_added: number;
  items_inserted: number;
  /** Capped at 100 by the database; error_count is the true total. */
  errors: { row: number; key: string; value: string; message: string }[];
  error_count: number;
}

export async function runImport(input: {
  /** Existing target, or null to create one. */
  categoryId: string | null;
  newCategory?: { name: string; parent_id: string | null; icon?: string | null; color?: string | null };
  ownFields: SchemaField[];
  rows: Record<string, string>[];
}): Promise<ActionResult<ImportOutcome>> {
  try {
    // The finer gate — creating a category or adding fields needs
    // SCHEMA_ADMIN — is enforced inside import_items(), which is the
    // only place that knows whether the schema is actually changing.
    const profile = await requireDataEditor();

    if (input.rows.length === 0) {
      return { ok: false, error: "There are no rows to import." };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("import_items", {
      p_category_id: input.categoryId,
      p_new_category: input.newCategory ?? {},
      p_own_fields: input.ownFields,
      p_rows: input.rows,
      p_changed_by: profile.id,
    });

    if (error) throw new Error(error.message);

    revalidatePath("/data-center", "layout");
    revalidatePath("/dashboard");
    return { ok: true, data: data as ImportOutcome };
  } catch (error) {
    return actionError(error, "The import failed and nothing was written.");
  }
}

/** The target's effective schema, for the mapping step. */
export async function getTargetSchema(
  categoryId: string
): Promise<ActionResult<EffectiveField[]>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_effective_schema", {
      p_category_id: categoryId,
    });

    if (error) throw new Error(error.message);
    return { ok: true, data: (data ?? []) as EffectiveField[] };
  } catch (error) {
    return actionError(error, "Could not load that category's schema.");
  }
}

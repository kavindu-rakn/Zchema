"use server";

// ── Trash server actions ─────────────────────────────────────
// Restore and purge. The database decides the finer rule — an entry
// holding categories needs a SCHEMA_ADMIN to restore — because only it
// knows what the entry holds; the checks here are the outer gate every
// Server Action needs regardless.

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireDataEditor, requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import type { ActionResult } from "@/lib/types";

export interface RestoreOutcome {
  categories: number;
  items: number;
  versions: number;
  /** Values whose field no longer exists, now under __orphaned. */
  orphaned_values: number;
}

/** Everything a restore or purge can change the look of. */
function revalidateAfterTrash() {
  revalidatePath("/data-center", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/search");
}

export async function restoreTrash(batch: string): Promise<ActionResult<RestoreOutcome>> {
  try {
    await requireDataEditor();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("restore_trash", { p_batch: batch });
    if (error) throw new Error(error.message);

    revalidateAfterTrash();
    return { ok: true, data: data as RestoreOutcome };
  } catch (error) {
    return actionError(error, "Could not restore that.");
  }
}

/**
 * Destroy a trash entry for good. `confirm` must be true — it is passed
 * through to purge_trash(), which refuses without it, so a stray call
 * cannot empty anything by default.
 */
export async function purgeTrash(
  batch: string,
  confirm: boolean
): Promise<ActionResult<{ purged: number }>> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("purge_trash", {
      p_batch: batch,
      p_confirm: confirm,
    });
    if (error) throw new Error(error.message);

    revalidateAfterTrash();
    return { ok: true, data: data as { purged: number } };
  } catch (error) {
    return actionError(error, "Could not empty that entry.");
  }
}

"use server";

// ── Settings server actions ──────────────────────────────────

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import type { ActionResult, UserRole } from "@/lib/types";

const VALID_ROLES: UserRole[] = ["SCHEMA_ADMIN", "DATA_EDITOR", "VIEWER"];

/**
 * Change another user's role.
 *
 * Three layers guard this: the role check here, the RLS policy on
 * profiles, and the protect_role_update() trigger which rejects any
 * role change whose acting user is not a SCHEMA_ADMIN.
 */
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<ActionResult> {
  try {
    const actor = await requireSchemaAdmin();

    if (!VALID_ROLES.includes(role)) {
      return { ok: false, error: `"${role}" is not a valid role.` };
    }

    // Demoting yourself can leave a project with no admin at all, and
    // you would lose the ability to undo it.
    if (actor.id === userId && role !== "SCHEMA_ADMIN") {
      return {
        ok: false,
        error: "You cannot remove your own admin role — ask another admin to do it.",
      };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("profiles").update({ role }).eq("id", userId);
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not update that user's role.");
  }
}

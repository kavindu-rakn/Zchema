"use server";

// ── Settings server actions ──────────────────────────────────

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { requireSchemaAdmin } from "@/lib/auth";
import { actionError } from "@/lib/action-result";
import type { ActionResult, UserRole } from "@/lib/types";

const VALID_ROLES: UserRole[] = ["SCHEMA_ADMIN", "DATA_EDITOR", "VIEWER"];

/**
 * Invite someone, with the role they should land in.
 *
 * Returns the token ONCE — it is not stored in a readable form, so a
 * link that is lost has to be replaced rather than looked up. Zchema
 * sends no mail: the caller shares the link however the team already
 * talks. The role is granted when the address is confirmed, never
 * merely because someone typed it (supabase/invites.sql).
 */
export async function createInvitation(
  email: string,
  role: UserRole
): Promise<ActionResult<{ id: string; email: string; role: UserRole; token: string; expires_at: string }>> {
  try {
    await requireSchemaAdmin();

    if (!VALID_ROLES.includes(role)) {
      return { ok: false, error: `"${role}" is not a valid role.` };
    }

    const supabase = await createClient();
    const { data, error } = await supabase.rpc("create_invitation", {
      p_email: email,
      p_role: role,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    return {
      ok: true,
      data: data as { id: string; email: string; role: UserRole; token: string; expires_at: string },
    };
  } catch (error) {
    return actionError(error, "Could not create that invitation.");
  }
}

/** Make an unaccepted invitation's link stop working. */
export async function revokeInvitation(id: string): Promise<ActionResult> {
  try {
    await requireSchemaAdmin();

    const supabase = await createClient();
    const { error } = await supabase.rpc("revoke_invitation", { p_id: id });
    if (error) throw new Error(error.message);

    revalidatePath("/settings");
    return { ok: true, data: null };
  } catch (error) {
    return actionError(error, "Could not revoke that invitation.");
  }
}

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

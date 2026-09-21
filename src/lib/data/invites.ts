// ── Invitation queries ───────────────────────────────────────
// The table is unreadable to clients; list_invitations() is the only
// view of it, and it refuses anyone but a SCHEMA_ADMIN.

import { createClient } from "@/utils/supabase/server";
import type { Invitation } from "@/lib/types";

/** Every invitation, newest first. */
export async function listInvitations(): Promise<Invitation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_invitations");

  if (error) throw new Error(`Could not load invitations: ${error.message}`);
  return (data ?? []) as Invitation[];
}

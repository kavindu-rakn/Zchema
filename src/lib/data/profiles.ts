// ── Profile queries ──────────────────────────────────────────

import { createClient } from "@/utils/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Every profile, oldest first.
 *
 * RLS only exposes all rows to a SCHEMA_ADMIN — a non-admin caller
 * simply sees their own row rather than an error, so callers should
 * still gate the UI on role.
 */
export async function getProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Could not load users: ${error.message}`);
  return (data ?? []) as Profile[];
}

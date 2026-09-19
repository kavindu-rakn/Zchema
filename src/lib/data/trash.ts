// ── Trash queries ────────────────────────────────────────────
// The trash itself is unreadable to clients; list_trash() is the only
// view of it, and refuses anyone below DATA_EDITOR.

import { createClient } from "@/utils/supabase/server";
import type { TrashEntry } from "@/lib/types";

/** Every trash entry, newest first. */
export async function listTrash(): Promise<TrashEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_trash");

  if (error) throw new Error(`Could not load the trash: ${error.message}`);
  return (data ?? []) as TrashEntry[];
}

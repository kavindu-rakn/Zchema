// ── Item queries ─────────────────────────────────────────────

import { createClient } from "@/utils/supabase/server";
import type { Item } from "@/lib/types";

/** Items belonging directly to one category, newest first. */
export async function getItems(categoryId: string): Promise<Item[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("category_id", categoryId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Could not load items: ${error.message}`);
  return (data ?? []) as Item[];
}

/** A single item by id. */
export async function getItem(id: string): Promise<Item> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("items")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(`Could not load that item: ${error.message}`);
  return data as Item;
}

/** Number of items directly on a category (excluding descendants). */
export async function countItems(categoryId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("items")
    .select("id", { count: "exact", head: true })
    .eq("category_id", categoryId);

  if (error) throw new Error(`Could not count items: ${error.message}`);
  return count ?? 0;
}

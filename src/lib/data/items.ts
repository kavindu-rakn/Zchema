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

export type FilterOp =
  | "contains"
  | "eq"
  | "in"
  | "range"
  | "bool"
  | "is_empty"
  | "not_empty";

export interface ItemFilter {
  key: string;
  type: string;
  op: FilterOp;
  value?: string;
  value2?: string;
}

export interface ItemRow extends Item {
  category_name: string;
}

export type ItemHealth = "incomplete" | "orphaned";

export interface ItemQuery {
  categoryId: string;
  includeSubtree?: boolean;
  sortKey?: string | null;
  sortType?: string;
  sortDir?: "asc" | "desc";
  filters?: ItemFilter[];
  page?: number;
  pageSize?: number;
  health?: ItemHealth | null;
}

export interface ItemHealthCounts {
  total: number;
  incomplete: number;
  orphaned: number;
}

/** Totals for the Items tab header strip. */
export async function getItemHealthCounts(
  categoryId: string,
  includeSubtree = false
): Promise<ItemHealthCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_item_health_counts", {
    p_category_id: categoryId,
    p_include_subtree: includeSubtree,
  });

  if (error) throw new Error(`Could not load item health: ${error.message}`);
  return (data ?? { total: 0, incomplete: 0, orphaned: 0 }) as ItemHealthCounts;
}

/**
 * Sorted, filtered, paginated items — all of it server-side.
 *
 * Fetching every item and filtering in the browser is fine at 20 rows
 * and wrong at 2,000; it also makes sorting silently incorrect beyond
 * page 1. The `query_items` RPC does the work with type-aware casts.
 */
export async function queryItems(
  query: ItemQuery
): Promise<{ rows: ItemRow[]; total: number }> {
  const pageSize = query.pageSize ?? 50;
  const page = Math.max(1, query.page ?? 1);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("query_items", {
    p_category_id: query.categoryId,
    p_include_subtree: query.includeSubtree ?? false,
    p_sort_key: query.sortKey ?? null,
    p_sort_type: query.sortType ?? "string",
    p_sort_dir: query.sortDir ?? "asc",
    p_filters: query.filters ?? [],
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
    p_health: query.health ?? null,
  });

  if (error) throw new Error(`Could not load items: ${error.message}`);

  const payload = (data ?? { total: 0, rows: [] }) as { total: number; rows: ItemRow[] };
  return { rows: payload.rows ?? [], total: payload.total ?? 0 };
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

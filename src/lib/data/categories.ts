// ── Category queries ─────────────────────────────────────────
// Typed Supabase helpers. Every function returns typed data or throws
// with a message fit for a toast.

import { createClient } from "@/utils/supabase/server";
import { buildCategoryTree } from "@/lib/schema";
import type { Category, CategoryNode, EffectiveField } from "@/lib/types";

/** A node as returned by get_category_tree() — flat, before nesting. */
export type CategoryTreeRow = Omit<CategoryNode, "children">;

/** Every category, ordered for display. */
export async function getCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("position", { ascending: true })
    .order("name", { ascending: true });

  if (error) throw new Error(`Could not load categories: ${error.message}`);
  return (data ?? []) as Category[];
}

/** A single category by id. */
export async function getCategory(id: string): Promise<Category> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(`Could not load that category: ${error.message}`);
  return data as Category;
}

/**
 * The whole tree with counts in ONE call, flat.
 * Nesting is assembled client-side by buildCategoryTree().
 */
export async function getCategoryTreeFlat(): Promise<CategoryNode[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_category_tree");

  if (error) throw new Error(`Could not load the category tree: ${error.message}`);

  const rows = (data ?? []) as CategoryTreeRow[];
  return rows.map((row) => ({ ...row, children: [] }));
}

/** The whole tree with counts, nested and ordered. */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  return buildCategoryTree(await getCategoryTreeFlat());
}

/**
 * A category's resolved schema — inherited fields folded in and
 * overrides applied. This is the authoritative resolver; the pure
 * mirror in lib/schema.ts exists only for optimistic client previews.
 */
export async function getEffectiveSchema(categoryId: string): Promise<EffectiveField[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_effective_schema", {
    p_category_id: categoryId,
  });

  if (error) throw new Error(`Could not resolve the schema: ${error.message}`);
  return (data ?? []) as EffectiveField[];
}

/** The ancestor chain, ROOT-FIRST (depth 0 = the target itself). */
export async function getCategoryAncestors(categoryId: string): Promise<
  { id: string; name: string; own_fields: Category["own_fields"]; overrides: Category["overrides"]; depth: number }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_category_ancestors", {
    p_category_id: categoryId,
  });

  if (error) throw new Error(`Could not load the category chain: ${error.message}`);
  return data ?? [];
}

/** Count of items on a category and all of its descendants. */
export async function countSubtreeItems(categoryId: string): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("count_subtree_items", {
    p_category_id: categoryId,
  });

  if (error) throw new Error(`Could not count items: ${error.message}`);
  return (data as number) ?? 0;
}

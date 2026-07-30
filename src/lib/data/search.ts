// ── Search queries ───────────────────────────────────────────
// Thin wrappers over search.sql. The DSL is parsed before these are
// called; they take the already-structured filters.

import { createClient } from "@/utils/supabase/server";
import type { SearchFilter, SearchResult, SearchableField } from "@/lib/types";

export interface SearchParams {
  text?: string;
  filters?: SearchFilter[];
  categoryId?: string | null;
  page?: number;
  pageSize?: number;
}

export async function searchItems(
  params: SearchParams
): Promise<{ rows: SearchResult[]; total: number }> {
  const pageSize = params.pageSize ?? 30;
  const page = Math.max(1, params.page ?? 1);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_items", {
    p_query: params.text?.trim() || null,
    p_filters: params.filters ?? [],
    p_category_id: params.categoryId ?? null,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });

  if (error) throw new Error(`Search failed: ${error.message}`);

  const rows = (data ?? []) as SearchResult[];
  // total_count is a window function, so it is identical on every row
  // and absent when there are none.
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export interface SearchFacets {
  total: number;
  categories: { id: string; name: string; slug: string; path: string; count: number }[];
  values: { key: string; total: number; values: { value: string; count: number }[] }[];
}

export async function searchFacets(params: SearchParams): Promise<SearchFacets> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_facets", {
    p_query: params.text?.trim() || null,
    p_filters: params.filters ?? [],
    p_category_id: params.categoryId ?? null,
  });

  if (error) throw new Error(`Could not build facets: ${error.message}`);
  return (data ?? { total: 0, categories: [], values: [] }) as SearchFacets;
}

/** Field keys in scope, for query-bar autocomplete. */
export async function getSearchableFields(
  categoryId?: string | null
): Promise<SearchableField[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_searchable_fields", {
    p_category_id: categoryId ?? null,
  });

  if (error) throw new Error(`Could not load searchable fields: ${error.message}`);
  return (data ?? []) as SearchableField[];
}

/**
 * Resolve an `in:<slug>` scope to a category.
 *
 * Returns null when nothing matches, so the page can say "no category
 * called that" rather than silently searching everything — a scope that
 * quietly does nothing is worse than one that fails.
 */
export async function resolveCategorySlug(
  slug: string
): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name")
    .eq("slug", slug)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Could not resolve the scope: ${error.message}`);
  return (data as { id: string; name: string } | null) ?? null;
}

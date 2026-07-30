"use client";

// ── Facets ───────────────────────────────────────────────────
// Clicking a facet REWRITES THE QUERY STRING rather than holding its
// own filter state. There is exactly one representation of a search —
// the text in the box — and the URL is it. Two representations is how
// the bar and the results drift apart, and how a shared link stops
// meaning what the sharer saw.

import { useRouter } from "next/navigation";
import { FolderTree, X } from "lucide-react";

import { describeFilter, parseQuery, serializeQuery } from "@/lib/query-dsl";
import { cn } from "@/lib/utils";
import type { SearchFilter } from "@/lib/types";
import type { SearchFacets as Facets } from "@/lib/data/search";

export function SearchFacets({
  facets,
  query,
  scopeSlug,
  filters,
}: {
  facets: Facets;
  /** The current raw query text — the single source of truth. */
  query: string;
  scopeSlug: string | null;
  filters: SearchFilter[];
}) {
  const router = useRouter();

  const go = (next: string) =>
    router.push(next.trim() ? `/search?q=${encodeURIComponent(next.trim())}` : "/search");

  /** Add or replace a filter by rewriting the query text. */
  const withFilter = (filter: SearchFilter) => {
    const parsed = parseQuery(query);
    const others = parsed.filters.filter(
      (existing) => !(existing.key === filter.key && existing.op === filter.op)
    );
    return serializeQuery({ ...parsed, filters: [...others, filter] });
  };

  const withoutFilter = (filter: SearchFilter) => {
    const parsed = parseQuery(query);
    return serializeQuery({
      ...parsed,
      filters: parsed.filters.filter(
        (existing) =>
          !(existing.key === filter.key && existing.op === filter.op && existing.value === filter.value)
      ),
    });
  };

  const withScope = (slug: string | null) => {
    const parsed = parseQuery(query);
    return serializeQuery({ ...parsed, scope: slug });
  };

  return (
    <div className="space-y-4">
      {/* ── Active filters ──────────────────────────────── */}
      {(filters.length > 0 || scopeSlug) && (
        <section className="space-y-1.5">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Active
          </h3>
          <ul className="flex flex-wrap gap-1.5">
            {scopeSlug && (
              <li>
                <button
                  type="button"
                  onClick={() => go(withScope(null))}
                  className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                >
                  in: {scopeSlug}
                  <X className="h-2.5 w-2.5" />
                </button>
              </li>
            )}
            {filters.map((filter, index) => (
              <li key={`${filter.key}-${filter.op}-${index}`}>
                <button
                  type="button"
                  onClick={() => go(withoutFilter(filter))}
                  className="flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-foreground hover:bg-accent"
                >
                  {describeFilter(filter)}
                  <X className="h-2.5 w-2.5 text-muted-foreground" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Categories ──────────────────────────────────── */}
      {facets.categories.length > 0 && (
        <section className="space-y-1">
          <h3 className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
            <FolderTree className="h-3 w-3" />
            Categories
          </h3>
          <ul>
            {facets.categories.slice(0, 12).map((category) => (
              <li key={category.id}>
                <button
                  type="button"
                  title={category.path}
                  onClick={() => go(withScope(category.slug))}
                  className="flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">
                    {category.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {category.count}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Value facets ────────────────────────────────── */}
      {facets.values.slice(0, 6).map((facet) => (
        <section key={facet.key} className="space-y-1">
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {facet.key}
          </h3>
          <ul>
            {facet.values.slice(0, 8).map((entry) => {
              const active = filters.some(
                (filter) =>
                  filter.key === facet.key && filter.op === "eq" && filter.value === entry.value
              );
              return (
                <li key={entry.value}>
                  <button
                    type="button"
                    onClick={() =>
                      go(
                        active
                          ? withoutFilter({ key: facet.key, op: "eq", value: entry.value })
                          : withFilter({ key: facet.key, op: "eq", value: entry.value })
                      )
                    }
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-accent",
                      active && "bg-accent"
                    )}
                  >
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        active ? "font-medium text-foreground" : "text-foreground"
                      )}
                    >
                      {entry.value}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {entry.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}


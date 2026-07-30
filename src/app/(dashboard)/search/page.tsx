import Link from "next/link";
import { AlertTriangle, Search as SearchIcon } from "lucide-react";

import { SearchBar } from "@/components/search/search-bar";
import { SearchResults } from "@/components/search/search-results";
import { SearchFacets } from "@/components/search/search-facets";
import { SavedSearches } from "@/components/search/saved-searches";
import { Button } from "@/components/ui/button";
import {
  getSearchableFields,
  resolveCategorySlug,
  searchFacets,
  searchItems,
} from "@/lib/data/search";
import { describeFilter, parseQuery } from "@/lib/query-dsl";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SearchPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const page = Math.max(1, Number.parseInt(String(params.page ?? "1"), 10) || 1);

  // The URL is the single source of truth: parsed here, on the server,
  // so a shared link produces exactly the search the sharer saw.
  const parsed = parseQuery(query);

  const scope = parsed.scope ? await resolveCategorySlug(parsed.scope) : null;
  const scopeMissing = Boolean(parsed.scope) && scope === null;

  const searchArgs = {
    text: parsed.text,
    filters: parsed.filters,
    categoryId: scope?.id ?? null,
  };

  const hasQuery = query.trim() !== "";

  const [result, facets, fields] = await Promise.all([
    hasQuery && !scopeMissing
      ? searchItems({ ...searchArgs, page, pageSize: PAGE_SIZE })
      : Promise.resolve({ rows: [], total: 0 }),
    hasQuery && !scopeMissing
      ? searchFacets(searchArgs)
      : Promise.resolve({ total: 0, categories: [], values: [] }),
    getSearchableFields(scope?.id ?? null),
  ]);

  const terms = parsed.text.split(/\s+/).filter((term) => term.length > 1).map((t) => t.replace(/"/g, ""));
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  /**
   * The narrowest filter, for the empty state.
   *
   * "No results" is a dead end; "no results — try removing brand:Sony,
   * which is the narrowest filter" is a next step. Narrowest is
   * approximated by the facet counts: a filter on a key that few
   * matched rows even have is the one most likely to be the culprit.
   */
  const narrowest = parsed.filters.length > 0 ? parsed.filters[parsed.filters.length - 1] : null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-6">
      <div className="sticky top-0 z-10 -mx-6 bg-background/95 px-6 pb-3 pt-1 backdrop-blur">
        <SearchBar initialQuery={query} fields={fields} />

        {parsed.errors.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {parsed.errors.map((error, index) => (
              <li
                key={index}
                className="flex items-start gap-1.5 text-[11px] text-muted-foreground"
              >
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                {error}
              </li>
            ))}
          </ul>
        )}
      </div>

      {!hasQuery ? (
        <EmptyPrompt />
      ) : scopeMissing ? (
        <div className="py-16 text-center">
          <p className="text-sm text-foreground">
            No category has the slug{" "}
            <code className="text-primary">{parsed.scope}</code>.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Scopes use the slug from the category&apos;s URL, not its display name.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-4">
            <SavedSearches currentQuery={query} />
            <SearchFacets
              facets={facets}
              query={query}
              scopeSlug={parsed.scope}
              filters={parsed.filters}
            />
          </aside>

          <main className="min-w-0 space-y-3">
            <p className="text-sm text-muted-foreground">
              <strong className="text-foreground">{result.total}</strong> result
              {result.total === 1 ? "" : "s"}
              {scope && (
                <>
                  {" in "}
                  <Link
                    href={`/data-center/${scope.id}`}
                    className="text-primary hover:underline"
                  >
                    {scope.name}
                  </Link>
                </>
              )}
              {facets.categories.length > 1 && (
                <> across {facets.categories.length} categories</>
              )}
            </p>

            {result.rows.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-16 text-center">
                <p className="text-sm font-medium text-foreground">Nothing matched.</p>
                {narrowest ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    The narrowest condition is{" "}
                    <strong className="text-foreground">{describeFilter(narrowest)}</strong> — try
                    removing it first.
                  </p>
                ) : scope ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try dropping <code className="text-foreground">in:{parsed.scope}</code> to
                    search the whole catalog.
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try fewer words, or a field filter like{" "}
                    <code className="text-foreground">brand:Sony</code>.
                  </p>
                )}
              </div>
            ) : (
              <SearchResults rows={result.rows} terms={terms} filters={parsed.filters} />
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 pt-2">
                <p className="text-xs text-muted-foreground">
                  Page {page} of {totalPages}
                </p>
                {/* Links rather than buttons — this is a server
                    component, and a link middle-clicks into a new tab.
                    At a boundary it becomes a genuinely disabled
                    button: `disabled` on an anchor is not a real thing
                    and would leave the control clickable. */}
                <div className="flex gap-1">
                  {page > 1 ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={
                        <Link href={`/search?q=${encodeURIComponent(query)}&page=${page - 1}`}>
                          Previous
                        </Link>
                      }
                    />
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Previous
                    </Button>
                  )}

                  {page < totalPages ? (
                    <Button
                      variant="outline"
                      size="sm"
                      render={
                        <Link href={`/search?q=${encodeURIComponent(query)}&page=${page + 1}`}>
                          Next
                        </Link>
                      }
                    />
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      Next
                    </Button>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

/** What to show before anyone has searched: teach the DSL by example. */
function EmptyPrompt() {
  const examples: [string, string][] = [
    ["brand:Sony", "an exact value, anywhere in the catalog"],
    ["price:>500", "a comparison — text values in that field are skipped, not errors"],
    ["price:500..1200", "a range"],
    ["size:in(S, M, L)", "any of several values"],
    ["missing:warranty_months", "items with nothing filled in for a field"],
    ["-discontinued:true", "negation"],
    ["in:electronics wireless", "free text, scoped to one subtree"],
  ];

  return (
    <div className="py-14">
      <div className="mx-auto max-w-lg space-y-4">
        <div className="flex items-center gap-2 text-primary">
          <SearchIcon className="h-5 w-5" />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            Search everything
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          One query across every category. Because fields are shared definitions rather than
          coincidences of spelling, <code className="text-foreground">brand:Sony</code> means the
          same thing in Electronics as it does in Cameras.
        </p>

        <dl className="space-y-1.5 rounded-lg border border-border bg-card/40 p-4">
          {examples.map(([syntax, meaning]) => (
            <div key={syntax} className="flex flex-wrap items-baseline gap-x-3">
              <dt className="w-44 shrink-0">
                <Link
                  href={`/search?q=${encodeURIComponent(syntax)}`}
                  className="font-mono text-xs text-primary hover:underline"
                >
                  {syntax}
                </Link>
              </dt>
              <dd className="min-w-0 flex-1 text-xs text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

"use client";

// ── Command palette (⌘K) ─────────────────────────────────────
// Navigation commands plus LIVE category results — typing "lap"
// offers "Electronics › Laptops". The live results are what make the
// palette worth keeping; a static list of four links was not.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Boxes,
  FolderTree,
  LayoutDashboard,
  Layers,
  Package,
  Tags,
  PlusCircle,
  Search,
  Settings,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { createClient } from "@/utils/supabase/client";
import { parseQuery } from "@/lib/query-dsl";
import type { SearchResult } from "@/lib/types";

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
}

/** Below this, an item search is noise — almost everything matches. */
const MIN_ITEM_QUERY = 2;

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const router = useRouter();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Load categories lazily — only once, and only if the palette is used.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;

    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("categories")
        .select("id, name, parent_id")
        .order("name");
      if (!cancelled) {
        setCategories((data ?? []) as CategoryRow[]);
        setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, loaded]);

  /**
   * Live ITEM results, debounced.
   *
   * This is what makes the palette the fastest path to any record: the
   * category list tells you where things live, but ⌘K → "airpods" →
   * Enter should land on the record itself. Debounced at 250ms and
   * serialised by a liveness flag so a slow response cannot overwrite
   * a newer one.
   */
  useEffect(() => {
    let live = true;

    const timer = setTimeout(async () => {
      const trimmed = query.trim();
      if (!open || trimmed.length < MIN_ITEM_QUERY) {
        setItems([]);
        return;
      }

      const parsed = parseQuery(trimmed);
      const supabase = createClient();
      const { data } = await supabase.rpc("search_items", {
        p_query: parsed.text.trim() || null,
        p_filters: parsed.filters,
        p_category_id: null,
        p_limit: 5,
        p_offset: 0,
      });

      if (!live) return;
      setItems((data ?? []) as SearchResult[]);
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, query]);

  /** "Electronics › Laptops › Gaming Laptops" for each category. */
  const withPaths = useMemo(() => {
    const byId = new Map(categories.map((c) => [c.id, c]));
    return categories.map((category) => {
      const parts: string[] = [category.name];
      const seen = new Set<string>([category.id]);
      let current = category;
      while (current.parent_id) {
        const parent = byId.get(current.parent_id);
        if (!parent || seen.has(parent.id)) break;
        seen.add(parent.id);
        parts.unshift(parent.name);
        current = parent;
      }
      return { ...category, path: parts.join(" › ") };
    });
  }, [categories]);

  const runCommand = useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <>
      <Button
        variant="outline"
        className="relative h-8 w-full justify-start rounded-[0.5rem] border-border/50 bg-background text-sm font-normal text-muted-foreground shadow-none hover:bg-accent/50 sm:pr-12 md:w-40 lg:w-64"
        onClick={() => setOpen(true)}
      >
        <Search className="mr-2 h-4 w-4" />
        <span className="hidden lg:inline-flex">Search or command…</span>
        <span className="inline-flex lg:hidden">Search…</span>
        <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.3rem] hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
          <span className="text-xs">⌘</span>K
        </kbd>
      </Button>

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Search items, categories, or type a command…"
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {/* Items first: when you know what you are looking for, the
              record beats the folder it lives in. */}
          {items.length > 0 && (
            <>
              <CommandGroup heading="Items">
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    // These rows are already filtered by the database.
                    // Seeding `value` with the raw query keeps cmdk's
                    // own client-side filter from hiding them again.
                    value={`${query} ${itemLabel(item.data)}`}
                    onSelect={() =>
                      runCommand(() =>
                        router.push(`/data-center/${item.category_id}?tab=items`)
                      )
                    }
                  >
                    <Package className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{itemLabel(item.data)}</span>
                    <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">
                      {item.category_name}
                    </span>
                  </CommandItem>
                ))}

                {items[0]?.total_count > items.length && (
                  <CommandItem
                    value={`${query} see all results`}
                    onSelect={() =>
                      runCommand(() =>
                        router.push(`/search?q=${encodeURIComponent(query.trim())}`)
                      )
                    }
                  >
                    <ArrowRight className="mr-2 h-4 w-4 shrink-0 text-primary" />
                    <span className="text-primary">
                      See all {items[0].total_count} results
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          {withPaths.length > 0 && (
            <>
              <CommandGroup heading="Categories">
                {withPaths.map((category) => (
                  <CommandItem
                    key={category.id}
                    // cmdk filters on `value`; include the whole path so
                    // "elec lap" and "laptops" both match.
                    value={`${category.path} ${category.name}`}
                    onSelect={() =>
                      runCommand(() => router.push(`/data-center/${category.id}`))
                    }
                  >
                    <FolderTree className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{category.path}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}

          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => runCommand(() => router.push("/dashboard"))}>
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Go to Dashboard
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/data-center"))}>
              <Boxes className="mr-2 h-4 w-4" />
              Go to Data Center
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/data-center/blueprints"))}
            >
              <Layers className="mr-2 h-4 w-4" />
              Go to Blueprints
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/data-center/attributes"))}
            >
              <Tags className="mr-2 h-4 w-4" />
              Go to Attributes
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/search"))}>
              <Search className="mr-2 h-4 w-4" />
              Go to Search
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => router.push("/settings"))}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading="Actions">
            <CommandItem onSelect={() => runCommand(() => router.push("/data-center"))}>
              <PlusCircle className="mr-2 h-4 w-4" />
              New category
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/data-center/blueprints"))}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              New blueprint
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}

/** The field most likely to name an item, mirroring the search page. */
function itemLabel(data: Record<string, unknown>): string {
  for (const key of ["name", "title", "model", "model_number", "label", "sku"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const first = Object.entries(data).find(
    ([key, value]) => key !== "__orphaned" && typeof value === "string" && value.trim()
  );
  return (first?.[1] as string) ?? "Untitled item";
}

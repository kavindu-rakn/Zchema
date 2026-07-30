"use client";

// ── Command palette (⌘K) ─────────────────────────────────────
// Navigation commands plus LIVE category results — typing "lap"
// offers "Electronics › Laptops". The live results are what make the
// palette worth keeping; a static list of four links was not.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Boxes,
  FolderTree,
  LayoutDashboard,
  Layers,
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

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loaded, setLoaded] = useState(false);
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
        <CommandInput placeholder="Search categories or type a command…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

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

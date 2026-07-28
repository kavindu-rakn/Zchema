"use client";

// ── Tree rail as a drawer, below `lg` ────────────────────────
// The rail costs too much width on a small screen, so it collapses
// into a sheet. Deliberately not a mobile-optimised tree — a working
// drawer is the goal.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TreeNav } from "@/components/data-center/tree-nav";
import { NewRootCategory } from "@/components/data-center/new-root-category";
import type { CategoryNode } from "@/lib/types";

export function MobileTreeDrawer({ tree }: { tree: CategoryNode[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  // Picking a category navigates; the drawer should get out of the way.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const activeId = pathname.startsWith("/data-center/")
    ? pathname.split("/")[2] ?? null
    : null;

  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/80 px-4 py-2 backdrop-blur lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Menu className="h-4 w-4" />
          Categories
        </SheetTrigger>

        <SheetContent side="left" className="w-[85vw] max-w-sm p-0">
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle>Categories</SheetTitle>
          </SheetHeader>

          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filter categories…"
                aria-label="Filter categories"
                className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto p-2">
            <TreeNav tree={tree} activeId={activeId} filter={filter} />
          </nav>

          <div className="border-t border-border p-2">
            <NewRootCategory />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

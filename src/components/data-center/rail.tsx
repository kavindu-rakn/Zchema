"use client";

// ── Data Center left rail ────────────────────────────────────
// Filter on top, tree in the middle (its own scroll container),
// "New root category" pinned at the bottom. Width is drag-resizable,
// clamped, and persisted — as is the set of expanded nodes, so the
// tree looks the same when you come back to it.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { CategoryTree } from "@/components/data-center/category-tree";
import { NewRootCategory } from "@/components/data-center/new-root-category";
import { ImportEntry } from "@/components/import/import-entry";
import { cn } from "@/lib/utils";
import type { CategoryNode } from "@/lib/types";

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288;
const WIDTH_KEY = "zchema:rail-width";
const EXPANDED_KEY = "zchema:tree-expanded";

/** Node id from `/data-center/<id>`, ignoring non-category children. */
export function activeIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/data-center/")) return null;
  const segment = pathname.split("/")[2];
  if (!segment || segment === "blueprints" || segment === "attributes") return null;
  return segment;
}

export function useTreeExpansion(tree: CategoryNode[]) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  // Restore after mount so server and client markup agree.
  useEffect(() => {
    let restored: string[] | null = null;
    try {
      const stored = window.localStorage.getItem(EXPANDED_KEY);
      if (stored) restored = JSON.parse(stored) as string[];
    } catch {
      restored = null;
    }
    // Default: roots open, deeper levels collapsed.
    setExpanded(new Set(restored ?? tree.map((node) => node.id)));
    setHydrated(true);
    // Only on mount — later tree changes must not clobber user state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((next: Set<string>) => {
    try {
      window.localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // Storage unavailable — expansion just won't persist.
    }
  }, []);

  const toggle = useCallback(
    (id: string) => {
      setExpanded((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const expand = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      setExpanded((previous) => {
        if (ids.every((id) => previous.has(id))) return previous;
        const next = new Set(previous);
        ids.forEach((id) => next.add(id));
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return { expanded, toggle, expand, hydrated };
}

export function Rail({
  tree,
  canEdit,
}: {
  tree: CategoryNode[];
  canEdit: boolean;
}) {
  const pathname = usePathname();
  const [filter, setFilter] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);
  const { expanded, toggle, expand } = useTreeExpansion(tree);

  useEffect(() => {
    const stored = window.localStorage.getItem(WIDTH_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    if (Number.isFinite(parsed)) {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)));
    }
  }, []);

  const activeId = activeIdFromPath(pathname);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const left = railRef.current?.getBoundingClientRect().left ?? 0;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - left)));
    },
    [dragging]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      window.localStorage.setItem(WIDTH_KEY, String(width));
    },
    [dragging, width]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 32 : 8;
      let next = width;
      if (event.key === "ArrowLeft") next = width - step;
      else if (event.key === "ArrowRight") next = width + step;
      else return;

      event.preventDefault();
      next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next));
      setWidth(next);
      window.localStorage.setItem(WIDTH_KEY, String(next));
    },
    [width]
  );

  return (
    <>
      {/* Below `lg` the tree lives in a drawer instead — see
          MobileTreeDrawer, rendered by the Data Center layout. */}
      <aside
        ref={railRef}
        style={{ width }}
        className="hidden shrink-0 flex-col border-r border-border bg-card/30 lg:flex"
        aria-label="Category tree"
      >
        <div className="shrink-0 border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter categories…"
              aria-label="Filter categories"
              className="h-8 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <CategoryTree
            tree={tree}
            activeId={activeId}
            filter={filter}
            expanded={expanded}
            onToggle={toggle}
            onExpand={expand}
            canEdit={canEdit}
          />
        </nav>

        <div className="shrink-0 space-y-0.5 border-t border-border p-2">
          <NewRootCategory />
          {canEdit && <ImportEntry tree={tree} />}
        </div>
      </aside>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize category tree"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        className={cn(
          "hidden w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:bg-primary/60 focus-visible:outline-none lg:block",
          dragging && "bg-primary/60"
        )}
      />
    </>
  );
}

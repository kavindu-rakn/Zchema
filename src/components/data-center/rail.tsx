"use client";

// ── Data Center left rail ────────────────────────────────────
// Filter on top, tree in the middle (its own scroll container),
// "New root category" pinned at the bottom. Width is drag-resizable,
// clamped, and persisted to localStorage.

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";

import { TreeNav } from "@/components/data-center/tree-nav";
import { NewRootCategory } from "@/components/data-center/new-root-category";
import { cn } from "@/lib/utils";
import type { CategoryNode } from "@/lib/types";

const MIN_WIDTH = 220;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 288;
const STORAGE_KEY = "schemashift:rail-width";

export function Rail({ tree }: { tree: CategoryNode[] }) {
  const pathname = usePathname();
  const [filter, setFilter] = useState("");
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [dragging, setDragging] = useState(false);
  const railRef = useRef<HTMLElement | null>(null);

  // Read persisted width after mount so SSR and first paint agree.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    if (Number.isFinite(parsed)) {
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, parsed)));
    }
  }, []);

  // `/data-center/<id>` → the active node.
  const activeId = pathname.startsWith("/data-center/")
    ? pathname.split("/")[2] ?? null
    : null;

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const left = railRef.current?.getBoundingClientRect().left ?? 0;
      const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX - left));
      setWidth(next);
    },
    [dragging]
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
      window.localStorage.setItem(STORAGE_KEY, String(width));
    },
    [dragging, width]
  );

  // Keyboard resize, so the divider is not mouse-only.
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
      window.localStorage.setItem(STORAGE_KEY, String(next));
    },
    [width]
  );

  return (
    <>
      <aside
        ref={railRef}
        style={{ width }}
        className="flex shrink-0 flex-col border-r border-border bg-card/30"
        aria-label="Category tree"
      >
        {/* Filter */}
        <div className="shrink-0 border-b border-border p-2">
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

        {/* Tree — owns its own scroll */}
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <TreeNav tree={tree} activeId={activeId} filter={filter} />
        </nav>

        {/* Pinned footer */}
        <div className="shrink-0 border-t border-border p-2">
          <NewRootCategory />
        </div>
      </aside>

      {/* Resize handle */}
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
          "w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-primary/40 focus-visible:outline-none focus-visible:bg-primary/60",
          dragging && "bg-primary/60"
        )}
      />
    </>
  );
}

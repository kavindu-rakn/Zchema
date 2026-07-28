"use client";

// ── Category tree navigation ─────────────────────────────────
// Inside the Data Center the tree IS the navigation. Deliberately a
// straightforward recursive list for now — Phase 3 rebuilds it with
// indent guides, keyboard navigation and inline actions.

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CategoryNode } from "@/lib/types";

/** Ids of every node matching the filter, plus their ancestors. */
function matchingIds(nodes: CategoryNode[], query: string): Set<string> {
  const keep = new Set<string>();
  const needle = query.trim().toLowerCase();
  if (!needle) return keep;

  const walk = (node: CategoryNode, ancestors: string[]): boolean => {
    const selfMatches = node.name.toLowerCase().includes(needle);
    let descendantMatches = false;
    for (const child of node.children) {
      if (walk(child, [...ancestors, node.id])) descendantMatches = true;
    }
    if (selfMatches || descendantMatches) {
      keep.add(node.id);
      ancestors.forEach((id) => keep.add(id));
      return true;
    }
    return false;
  };

  nodes.forEach((node) => walk(node, []));
  return keep;
}

function TreeItem({
  node,
  depth,
  activeId,
  filter,
  visible,
}: {
  node: CategoryNode;
  depth: number;
  activeId: string | null;
  filter: string;
  visible: Set<string>;
}) {
  const hasChildren = node.children.length > 0;
  // While filtering, force every surviving branch open so matches are visible.
  const [manuallyOpen, setManuallyOpen] = useState(depth === 0);
  const open = filter ? true : manuallyOpen;

  if (filter && !visible.has(node.id)) return null;

  const isActive = activeId === node.id;

  return (
    <li>
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md pr-2 transition-colors",
          isActive ? "bg-accent" : "hover:bg-accent/50"
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={open}
            onClick={() => setManuallyOpen((value) => !value)}
            className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")}
            />
          </button>
        ) : (
          <span className="h-6 w-5 shrink-0" aria-hidden />
        )}

        <Link
          href={`/data-center/${node.id}`}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isActive ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {hasChildren && open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0" style={node.color ? { color: node.color } : undefined} />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0" style={node.color ? { color: node.color } : undefined} />
          )}
          <span className="truncate" title={node.name}>
            {node.name}
          </span>
        </Link>

        {node.item_count > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {node.item_count}
          </span>
        )}
      </div>

      {hasChildren && open && (
        <ul>
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              filter={filter}
              visible={visible}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TreeNav({
  tree,
  activeId,
  filter,
}: {
  tree: CategoryNode[];
  activeId: string | null;
  filter: string;
}) {
  const visible = useMemo(() => matchingIds(tree, filter), [tree, filter]);

  if (tree.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        No categories yet. Create one to get started.
      </p>
    );
  }

  if (filter && visible.size === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        No categories match “{filter}”.
      </p>
    );
  }

  return (
    <ul>
      {tree.map((node) => (
        <TreeItem
          key={node.id}
          node={node}
          depth={0}
          activeId={activeId}
          filter={filter}
          visible={visible}
        />
      ))}
    </ul>
  );
}

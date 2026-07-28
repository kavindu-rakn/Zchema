"use client";

// ── Category tree ────────────────────────────────────────────
// The hierarchy has to be legible at a glance — that is the whole
// point of the product. Three things this deliberately gets right:
//
//   1. TreeNode lives at MODULE scope and is memoised. Defining it
//      inside the parent makes it a new component type every render,
//      which remounts the subtree and makes expansion feel unstable.
//   2. Expansion state is lifted to one Set owned by the rail, so it
//      survives re-renders and can be driven (auto-expand to selection,
//      expand-to-match while filtering).
//   3. Nesting is drawn with indent guides, not padding alone. At three
//      levels, padding is guesswork.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { iconFor } from "@/components/data-center/category-icons";
import { CategorySheet } from "@/components/data-center/category-sheet";
import { MoveCategoryDialog } from "@/components/data-center/move-category-dialog";
import { DeleteCategoryDialog } from "@/components/data-center/delete-category-dialog";
import { cn } from "@/lib/utils";
import {
  ancestorIdsOf,
  collectMatches,
  flattenTree,
  type FlatRow,
} from "@/lib/tree";
import type { CategoryNode } from "@/lib/types";

function Highlight({ text, hits }: { text: string; hits: number[] }) {
  if (!hits.length) return <>{text}</>;
  const set = new Set(hits);
  return (
    <>
      {text.split("").map((char, index) =>
        set.has(index) ? (
          <mark key={index} className="bg-primary/25 text-foreground">
            {char}
          </mark>
        ) : (
          <span key={index}>{char}</span>
        )
      )}
    </>
  );
}

// ── Row ──────────────────────────────────────────────────────
interface TreeNodeProps {
  row: FlatRow;
  isActive: boolean;
  isFocused: boolean;
  isExpanded: boolean;
  canEdit: boolean;
  onToggle: (id: string) => void;
  onFocus: (id: string) => void;
  onAddChild: (id: string) => void;
  onEdit: (id: string) => void;
  onMove: (id: string) => void;
  onDelete: (id: string) => void;
  rowIndex: number;
  totalRows: number;
}

const TreeNode = memo(function TreeNode({
  row,
  isActive,
  isFocused,
  isExpanded,
  canEdit,
  onToggle,
  onFocus,
  onAddChild,
  onEdit,
  onMove,
  onDelete,
  rowIndex,
  totalRows,
}: TreeNodeProps) {
  const { node, depth, isLast, guides, hits } = row;
  const hasChildren = node.children.length > 0;
  const Icon = iconFor(node.icon);

  // A node with children but no fields of its own organises rather than
  // defines — worth distinguishing from a node that carries schema.
  const isGrouping = hasChildren && node.own_field_count === 0;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isExpanded : undefined}
      aria-selected={isActive}
      aria-level={depth + 1}
      aria-setsize={totalRows}
      aria-posinset={rowIndex + 1}
      className="list-none"
    >
      <div
        className={cn(
          "group relative flex h-7 items-stretch gap-0 rounded-md pr-1",
          isActive ? "bg-accent" : "hover:bg-accent/50",
          isFocused && !isActive && "ring-1 ring-ring/50"
        )}
      >
        {/* Left accent bar on the selected row */}
        {isActive && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-0.5 rounded-l-md bg-primary"
          />
        )}

        {/* Indent guides — one vertical line per ancestor level */}
        {guides.map((show, index) => (
          <span key={index} className="relative w-4 shrink-0" aria-hidden>
            {show && <span className="absolute inset-y-0 left-2 w-px bg-border" />}
          </span>
        ))}

        {/* Elbow into this node */}
        {depth > 0 && (
          <span className="relative w-4 shrink-0" aria-hidden>
            <span
              className={cn(
                "absolute left-2 w-px bg-border",
                isLast ? "top-0 h-1/2" : "inset-y-0"
              )}
            />
            <span className="absolute left-2 top-1/2 h-px w-2 bg-border" />
          </span>
        )}

        {/* Chevron — a separate target from the name, so expanding and
            selecting never fight each other. */}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle(node.id);
            }}
            className="flex w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}

        {/* Name — the select target */}
        <Link
          href={`/data-center/${node.id}`}
          tabIndex={-1}
          onFocus={() => onFocus(node.id)}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-sm focus:outline-none"
        >
          <Icon
            className="h-3.5 w-3.5 shrink-0"
            style={node.color ? { color: node.color } : undefined}
            aria-hidden
          />
          <span
            className={cn(
              "truncate",
              isActive
                ? "font-medium text-foreground"
                : isGrouping
                  ? "font-normal text-muted-foreground"
                  : "text-foreground/90"
            )}
            title={node.name}
          >
            <Highlight text={node.name} hits={hits} />
          </span>
        </Link>

        {/* Counts — hidden while hovering so the actions can take the space
            without the row reflowing. */}
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 pl-1 text-[11px] tabular-nums text-muted-foreground",
            canEdit && "group-hover:invisible"
          )}
        >
          {(node.own_field_count > 0 || node.inherited_field_count > 0) && (
            <span
              title={`${node.own_field_count} own · ${node.inherited_field_count} inherited`}
              className="rounded bg-secondary/60 px-1 text-secondary-foreground"
            >
              {node.own_field_count}
              <span className="text-muted-foreground">+{node.inherited_field_count}</span>
            </span>
          )}
          {node.item_count > 0 && <span>{node.item_count}</span>}
        </span>

        {/* Hover actions, overlaid on the reserved count space */}
        {canEdit && (
          <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex group-focus-within:flex">
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Add a child under ${node.name}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onAddChild(node.id);
              }}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger
                tabIndex={-1}
                aria-label={`More actions for ${node.name}`}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => onAddChild(node.id)}>
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  Add child category
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(node.id)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" />
                  Rename &amp; edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onMove(node.id)}>
                  <FolderInput className="mr-2 h-3.5 w-3.5" />
                  Move…
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(node.id)}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Delete…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        )}
      </div>
    </li>
  );
});

// ── Tree ─────────────────────────────────────────────────────
export function CategoryTree({
  tree,
  activeId,
  filter,
  expanded,
  onToggle,
  onExpand,
  canEdit,
}: {
  tree: CategoryNode[];
  activeId: string | null;
  filter: string;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onExpand: (ids: string[]) => void;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // One instance of each flow, driven by whichever node was acted on.
  const [createUnder, setCreateUnder] = useState<CategoryNode | null>(null);
  const [editing, setEditing] = useState<CategoryNode | null>(null);
  const [moving, setMoving] = useState<CategoryNode | null>(null);
  const [deleting, setDeleting] = useState<CategoryNode | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, CategoryNode>();
    const walk = (nodes: CategoryNode[]) => {
      for (const node of nodes) {
        map.set(node.id, node);
        walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);

  const filtering = filter.trim().length > 0;
  const { keep, hitsById } = useMemo(
    () => collectMatches(tree, filter.trim()),
    [tree, filter]
  );

  const rows = useMemo(
    () => flattenTree(tree, expanded, filtering, keep, hitsById),
    [tree, expanded, filtering, keep, hitsById]
  );

  // Auto-expand the chain down to the selected node so it is never
  // hidden inside a collapsed ancestor.
  useEffect(() => {
    if (!activeId) return;
    const missing = ancestorIdsOf(tree, activeId).filter((id) => !expanded.has(id));
    if (missing.length) onExpand(missing);
    // `expanded` intentionally omitted: this should run on navigation,
    // not every time the user collapses something by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, tree]);

  const focusIndex = rows.findIndex((row) => row.node.id === focusedId);

  const move = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(rows.length - 1, nextIndex));
      const next = rows[clamped];
      if (next) setFocusedId(next.node.id);
    },
    [rows]
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLUListElement>) => {
      if (!rows.length) return;
      const current = focusIndex >= 0 ? focusIndex : 0;
      const row = rows[current];
      const hasChildren = row?.node.children.length > 0;
      const isOpen = row ? expanded.has(row.node.id) || filtering : false;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(current + 1);
          break;
        case "ArrowUp":
          event.preventDefault();
          move(current - 1);
          break;
        case "ArrowRight":
          event.preventDefault();
          if (hasChildren && !isOpen) onToggle(row.node.id);
          else if (hasChildren) move(current + 1);
          break;
        case "ArrowLeft": {
          event.preventDefault();
          if (hasChildren && isOpen) {
            onToggle(row.node.id);
          } else {
            // Ascend to the parent row.
            for (let i = current - 1; i >= 0; i--) {
              if (rows[i].depth < row.depth) {
                setFocusedId(rows[i].node.id);
                break;
              }
            }
          }
          break;
        }
        case "Home":
          event.preventDefault();
          move(0);
          break;
        case "End":
          event.preventDefault();
          move(rows.length - 1);
          break;
        case "Enter":
        case " ":
          if (row) {
            event.preventDefault();
            router.push(`/data-center/${row.node.id}`);
          }
          break;
        default:
          break;
      }
    },
    [rows, focusIndex, expanded, filtering, move, onToggle, router]
  );

  /** Descendant count for the delete confirmation. */
  const descendantsOf = (node: CategoryNode): number => {
    let total = 0;
    const walk = (list: CategoryNode[]) => {
      for (const child of list) {
        total += 1;
        walk(child.children);
      }
    };
    walk(node.children);
    return total;
  };

  const flows = (
    <>
      {createUnder && (
        <CategorySheet
          open
          onOpenChange={(next) => !next && setCreateUnder(null)}
          parentId={createUnder.id}
          parentName={createUnder.name}
        />
      )}
      {editing && (
        <CategorySheet
          open
          onOpenChange={(next) => !next && setEditing(null)}
          category={editing}
        />
      )}
      {moving && (
        <MoveCategoryDialog
          open
          onOpenChange={(next) => !next && setMoving(null)}
          category={moving}
          tree={tree}
        />
      )}
      {deleting && (
        <DeleteCategoryDialog
          open
          onOpenChange={(next) => !next && setDeleting(null)}
          categoryId={deleting.id}
          categoryName={deleting.name}
          descendantCount={descendantsOf(deleting)}
          subtreeItemCount={deleting.subtree_item_count}
        />
      )}
    </>
  );

  if (tree.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        No categories yet. Create one to get started.
      </p>
    );
  }

  if (filtering && rows.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        No categories match “{filter}”.
      </p>
    );
  }

  return (
    <>
      <ul
        ref={listRef}
        role="tree"
        aria-label="Categories"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (!focusedId) setFocusedId(activeId ?? rows[0]?.node.id ?? null);
        }}
        className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {rows.map((row, index) => (
          <TreeNode
            key={row.node.id}
            row={row}
            rowIndex={index}
            totalRows={rows.length}
            isActive={row.node.id === activeId}
            isFocused={row.node.id === focusedId}
            isExpanded={filtering || expanded.has(row.node.id)}
            canEdit={canEdit}
            onToggle={onToggle}
            onFocus={setFocusedId}
            onAddChild={(id) => {
              onExpand([id]);
              setCreateUnder(byId.get(id) ?? null);
            }}
            onEdit={(id) => setEditing(byId.get(id) ?? null)}
            onMove={(id) => setMoving(byId.get(id) ?? null)}
            onDelete={(id) => setDeleting(byId.get(id) ?? null)}
          />
        ))}
      </ul>
      {flows}
    </>
  );
}

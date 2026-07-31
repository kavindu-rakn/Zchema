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
import { TreeHoverCard } from "@/components/data-center/tree-hover-card";
import { CategorySheet } from "@/components/data-center/category-sheet";
import { MoveCategoryDialog } from "@/components/data-center/move-category-dialog";
import { DeleteCategoryDialog } from "@/components/data-center/delete-category-dialog";
import { toast } from "sonner";

import { reorderCategories } from "@/app/(dashboard)/data-center/actions";
import { cn } from "@/lib/utils";
import {
  ancestorIdsOf,
  collectMatches,
  flattenTree,
  type FlatRow,
} from "@/lib/tree";
import {
  canMoveUnder,
  outdentTarget,
  previousSibling,
  reorderSiblings,
  siblingsOf,
  type MoveVerdict,
} from "@/lib/tree-move";
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
  /** Whole tree, so the hover card can resolve this node's schema. */
  tree: CategoryNode[];
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
  /** Drag-and-drop, all supplied by the tree container. */
  draggable: boolean;
  isDragging: boolean;
  /** Verdict for dropping the dragged node ONTO this row, or null when idle. */
  dropVerdict: MoveVerdict | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDropOn: (id: string) => void;
}

const TreeNode = memo(function TreeNode({
  row,
  tree,
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
  draggable,
  isDragging,
  dropVerdict,
  onDragStart,
  onDragEnd,
  onDropOn,
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
        draggable={draggable}
        onDragStart={(event) => {
          // A plain-text payload keeps the drag legible to the OS and
          // gives Firefox the initiation it insists on.
          event.dataTransfer.setData("text/plain", node.id);
          event.dataTransfer.effectAllowed = "move";
          onDragStart(node.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => {
          if (!dropVerdict) return;
          // preventDefault is what marks a target as droppable at all,
          // so an invalid one deliberately does NOT call it.
          if (dropVerdict.ok) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          } else {
            event.dataTransfer.dropEffect = "none";
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (dropVerdict?.ok) onDropOn(node.id);
        }}
        title={dropVerdict && !dropVerdict.ok ? dropVerdict.reason : undefined}
        className={cn(
          "group relative flex h-7 items-stretch gap-0 rounded-md pr-1",
          isActive ? "bg-accent" : "hover:bg-accent/50",
          isFocused && !isActive && "ring-1 ring-ring/50",
          isDragging && "opacity-40",
          // Valid targets invite; invalid ones say why, in place, during
          // the drag — not in a toast after the drop.
          dropVerdict?.ok && "ring-2 ring-primary",
          dropVerdict && !dropVerdict.ok && "cursor-not-allowed line-through decoration-destructive/70"
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

        {/* Name — the select target, with a hover preview of the node */}
        <TreeHoverCard tree={tree} node={node}>
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
        </TreeHoverCard>

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

        {/* The colliding key, named on the row itself while dragging. */}
        {dropVerdict && !dropVerdict.ok && dropVerdict.collidingKey && (
          <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 rounded bg-destructive/10 px-1 text-[10px] text-destructive no-underline">
            {dropVerdict.collidingKey}
          </span>
        )}

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

  // Drag state. `draggingId` is the node in flight; the verdict for each
  // row is computed from it on render rather than stored, so it can
  // never go stale against the tree.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  /**
   * Destination chosen by a drop or a keystroke.
   *
   * Three states, all distinct: a category id, `null` meaning "make it
   * a root" — a real choice — and `undefined` meaning nothing has been
   * chosen, which is how the menu opens the dialog.
   */
  const [moveTarget, setMoveTarget] = useState<string | null | undefined>(undefined);

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

  /**
   * Dropping does NOT move anything. It opens the Phase 5 reparent
   * dialog, which measures the blast radius and asks what should happen
   * to any value the move strands. A drag that silently rewrote the
   * inherited half of a subtree's schema would be the most dangerous
   * gesture in the app.
   */
  const requestMove = useCallback(
    (targetId: string | null) => {
      const dragged = draggingId ? byId.get(draggingId) : null;
      setDraggingId(null);
      if (!dragged) return;
      setMoveTarget(targetId);
      setMoving(dragged);
    },
    [byId, draggingId]
  );

  /** Reorder among siblings. Not a schema change, so no dialog. */
  const reorder = useCallback(
    (id: string, delta: number) => {
      const updates = reorderSiblings(siblingsOf(tree, id), id, delta);
      if (!updates) return;

      void (async () => {
        const result = await reorderCategories(updates);
        if (!result.ok) toast.error(result.error);
        else router.refresh();
      })();
    },
    [tree, router]
  );

  /**
   * Indent / outdent, the keyboard equivalent of a drag.
   *
   * Both are re-parents, so both go through the same dialog a drop
   * does. Refusing early with the reason is what stops the keyboard
   * path being a way to bypass the checks the mouse path enforces.
   */
  const reparentByKeyboard = useCallback(
    (id: string, direction: "in" | "out") => {
      const target =
        direction === "in"
          ? previousSibling(tree, id)?.id ?? null
          : outdentTarget(tree, id).targetId;

      if (direction === "in" && target === null) {
        toast.error("There is no sibling above this one to nest it under.");
        return;
      }
      if (direction === "out" && !outdentTarget(tree, id).hasParent) {
        toast.error("This is already a top-level category.");
        return;
      }

      const verdict = canMoveUnder(tree, id, target);
      if (!verdict.ok) {
        toast.error(verdict.reason);
        return;
      }

      const node = byId.get(id);
      if (node) {
        setMoveTarget(target);
        setMoving(node);
      }
    },
    [tree, byId]
  );

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

      // ⌘/Ctrl + arrow REORGANISES; a bare arrow navigates. A
      // drag-only feature is not accessible, so every drop this tree
      // accepts has a keystroke that reaches it.
      const withModifier = event.metaKey || event.ctrlKey;
      if (withModifier && row && canEdit) {
        switch (event.key) {
          case "ArrowUp":
            event.preventDefault();
            reorder(row.node.id, -1);
            return;
          case "ArrowDown":
            event.preventDefault();
            reorder(row.node.id, 1);
            return;
          case "ArrowRight":
            event.preventDefault();
            reparentByKeyboard(row.node.id, "in");
            return;
          case "ArrowLeft":
            event.preventDefault();
            reparentByKeyboard(row.node.id, "out");
            return;
          default:
            break;
        }
      }

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
    [
      rows,
      focusIndex,
      expanded,
      filtering,
      move,
      onToggle,
      router,
      canEdit,
      reorder,
      reparentByKeyboard,
    ]
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
          initialTargetId={moveTarget}
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
        aria-describedby={canEdit ? "tree-shortcuts" : undefined}
        // Announced by assistive tech, which is the only way a
        // keyboard-only user learns the reorganise keys exist.
        aria-keyshortcuts={
          canEdit ? "Meta+ArrowUp Meta+ArrowDown Meta+ArrowRight Meta+ArrowLeft" : undefined
        }
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
            tree={tree}
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
            onMove={(id) => {
              // From the menu there is no destination yet — the dialog
              // asks for one.
              setMoveTarget(undefined);
              setMoving(byId.get(id) ?? null);
            }}
            onDelete={(id) => setDeleting(byId.get(id) ?? null)}
            draggable={canEdit}
            isDragging={draggingId === row.node.id}
            // Computed per render from `draggingId` rather than stored:
            // a cached verdict could outlive the tree it was true for.
            dropVerdict={
              draggingId && draggingId !== row.node.id
                ? canMoveUnder(tree, draggingId, row.node.id)
                : null
            }
            onDragStart={setDraggingId}
            onDragEnd={() => setDraggingId(null)}
            onDropOn={requestMove}
          />
        ))}
      </ul>

      {canEdit && (
        <p id="tree-shortcuts" className="px-2 pt-2 text-[10px] leading-relaxed text-muted-foreground/70">
          Drag to re-parent. <kbd>⌘↑</kbd>/<kbd>⌘↓</kbd> reorder, <kbd>⌘→</kbd> nest under the
          one above, <kbd>⌘←</kbd> move out a level.
        </p>
      )}

      {flows}
    </>
  );
}

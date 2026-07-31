// ── Move validity ────────────────────────────────────────────
// Pure, and unit-tested, because it runs on every dragover.
//
// The requirement is that an invalid drop target is struck out WHILE
// dragging, naming the colliding key — not after the drop, in a toast.
// That rules out asking the server, so this mirrors the checks in
// analyze_category_move() using the tree the client already holds.
//
// ⚠️  These two must agree. The database is the authority and will
// reject a bad move regardless; this exists so the user never gets that
// far. If analyze_category_move gains a blocking condition, add it here
// in the same commit — a drop target that looks fine and then fails is
// worse than one that was never offered.

import type { CategoryNode } from "./types.ts";

export type MoveVerdict =
  | { ok: true }
  | { ok: false; reason: string; collidingKey?: string };

interface Indexed {
  byId: Map<string, CategoryNode>;
  parentOf: Map<string, string | null>;
}

function index(tree: CategoryNode[]): Indexed {
  const byId = new Map<string, CategoryNode>();
  const parentOf = new Map<string, string | null>();

  const walk = (nodes: CategoryNode[], parent: string | null) => {
    for (const node of nodes) {
      byId.set(node.id, node);
      parentOf.set(node.id, parent);
      walk(node.children, node.id);
    }
  };
  walk(tree, null);

  return { byId, parentOf };
}

/** Every key authored anywhere in a subtree, including its root. */
function authoredKeys(node: CategoryNode, out = new Set<string>()): Set<string> {
  for (const field of node.own_fields ?? []) out.add(field.key);
  for (const child of node.children) authoredKeys(child, out);
  return out;
}

/** Every key a node would inherit plus define — its effective key set. */
function effectiveKeys(id: string | null, { byId, parentOf }: Indexed): Set<string> {
  const keys = new Set<string>();
  let current = id;
  const guard = new Set<string>();

  while (current) {
    if (guard.has(current)) break; // A cycle cannot happen, but must not hang.
    guard.add(current);

    const node = byId.get(current);
    if (!node) break;
    for (const field of node.own_fields ?? []) keys.add(field.key);
    current = parentOf.get(current) ?? null;
  }

  return keys;
}

function isDescendant(candidate: string, ancestor: string, indexed: Indexed): boolean {
  let current: string | null = candidate;
  const guard = new Set<string>();

  while (current) {
    if (guard.has(current)) return false;
    guard.add(current);
    if (current === ancestor) return true;
    current = indexed.parentOf.get(current) ?? null;
  }
  return false;
}

/**
 * Could `draggedId` become a child of `targetId`?
 *
 * `targetId` of null means "make it a root".
 */
export function canMoveUnder(
  tree: CategoryNode[],
  draggedId: string,
  targetId: string | null
): MoveVerdict {
  const indexed = index(tree);
  const dragged = indexed.byId.get(draggedId);
  if (!dragged) return { ok: false, reason: "That category no longer exists." };

  if (targetId === draggedId) {
    return { ok: false, reason: "A category cannot be its own parent." };
  }

  if (targetId && isDescendant(targetId, draggedId, indexed)) {
    return {
      ok: false,
      reason: `${indexed.byId.get(targetId)?.name ?? "That"} is inside ${dragged.name}.`,
    };
  }

  if ((indexed.parentOf.get(draggedId) ?? null) === targetId) {
    return { ok: false, reason: "Already there." };
  }

  // A field cannot be both inherited and redefined. The whole moving
  // subtree is checked, not just its root: a grandchild's own field
  // collides just as fatally as the dragged node's.
  const subtreeKeys = authoredKeys(dragged);
  const inherited = effectiveKeys(targetId, indexed);

  for (const key of subtreeKeys) {
    if (inherited.has(key)) {
      return {
        ok: false,
        reason: `“${key}” is defined in ${dragged.name} and would also be inherited there.`,
        collidingKey: key,
      };
    }
  }

  // An override only survives if its key is still inherited.
  for (const overrideKey of Object.keys(dragged.overrides ?? {})) {
    if (!inherited.has(overrideKey)) {
      return {
        ok: false,
        reason: `${dragged.name} overrides “${overrideKey}”, which is not provided there.`,
        collidingKey: overrideKey,
      };
    }
  }

  return { ok: true };
}

/**
 * The siblings of a node, in display order.
 *
 * Reordering is a sibling-local operation — a node can only move up or
 * down among the nodes that share its parent.
 */
export function siblingsOf(tree: CategoryNode[], id: string): CategoryNode[] {
  const indexed = index(tree);
  const parent = indexed.parentOf.get(id) ?? null;
  return parent === null ? tree : (indexed.byId.get(parent)?.children ?? []);
}

/**
 * New `position` values after moving one sibling by `delta` places.
 *
 * Returns the whole reordered sibling list rather than a swap, because
 * seeded `position` values are frequently duplicated or all zero, and
 * swapping two of those achieves nothing visible. Renumbering from 0
 * makes the order well-defined from then on.
 */
export function reorderSiblings(
  siblings: CategoryNode[],
  id: string,
  delta: number
): { id: string; position: number }[] | null {
  const from = siblings.findIndex((node) => node.id === id);
  if (from === -1) return null;

  const to = from + delta;
  if (to < 0 || to >= siblings.length) return null;

  const next = [...siblings];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  return next.map((node, position) => ({ id: node.id, position }));
}

/** The sibling immediately before `id`, which ⌘→ indents under. */
export function previousSibling(
  tree: CategoryNode[],
  id: string
): CategoryNode | null {
  const siblings = siblingsOf(tree, id);
  const index = siblings.findIndex((node) => node.id === id);
  return index > 0 ? siblings[index - 1] : null;
}

/** The grandparent `id` would outdent to, or null for the root level. */
export function outdentTarget(
  tree: CategoryNode[],
  id: string
): { targetId: string | null; hasParent: boolean } {
  const indexed = index(tree);
  const parent = indexed.parentOf.get(id) ?? null;
  if (parent === null) return { targetId: null, hasParent: false };
  return { targetId: indexed.parentOf.get(parent) ?? null, hasParent: true };
}

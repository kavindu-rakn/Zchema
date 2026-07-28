// ── Pure tree logic ──────────────────────────────────────────
// Dependency-free and unit-testable, like lib/schema.ts. Kept out of
// the component so the fiddly parts — fuzzy matching, keeping matches'
// ancestors, and working out which indent guides continue — can be
// verified without a DOM.

import type { CategoryNode } from "./types";

/**
 * Subsequence match, so "gl" finds "Gaming Laptops".
 *
 * @returns the matched character positions (for highlighting), an empty
 *          array when the query is empty, or null when there is no match.
 */
export function fuzzyMatch(text: string, query: string): number[] | null {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase().replace(/\s+/g, "");
  const hits: number[] = [];
  let index = 0;

  for (const char of needle) {
    const found = haystack.indexOf(char, index);
    if (found === -1) return null;
    hits.push(found);
    index = found + 1;
  }
  return hits;
}

/**
 * Nodes matching the filter, plus every ancestor of a match.
 *
 * Filtering a tree down to a flat list of matches throws away the only
 * thing a tree is good for, so ancestors are retained to keep results
 * in context.
 */
export function collectMatches(
  nodes: CategoryNode[],
  query: string
): { keep: Set<string>; hitsById: Map<string, number[]> } {
  const keep = new Set<string>();
  const hitsById = new Map<string, number[]>();

  const walk = (node: CategoryNode, ancestors: string[]): boolean => {
    const hits = fuzzyMatch(node.name, query);
    let anyChild = false;
    for (const child of node.children) {
      if (walk(child, [...ancestors, node.id])) anyChild = true;
    }
    if (hits || anyChild) {
      keep.add(node.id);
      if (hits) hitsById.set(node.id, hits);
      ancestors.forEach((id) => keep.add(id));
      return true;
    }
    return false;
  };

  nodes.forEach((node) => walk(node, []));
  return { keep, hitsById };
}

export interface FlatRow {
  node: CategoryNode;
  depth: number;
  isLast: boolean;
  /** Per ancestor level, whether that level's vertical guide continues. */
  guides: boolean[];
  hits: number[];
}

/**
 * Flatten the visible tree into rows, carrying the guide information
 * each row needs to draw its indent lines.
 *
 * While filtering, surviving branches are forced open so a match is
 * never hidden inside a collapsed parent.
 */
export function flattenTree(
  nodes: CategoryNode[],
  expanded: Set<string>,
  filtering: boolean,
  keep: Set<string>,
  hitsById: Map<string, number[]>
): FlatRow[] {
  const rows: FlatRow[] = [];

  const walk = (list: CategoryNode[], depth: number, guides: boolean[]) => {
    const visible = filtering ? list.filter((node) => keep.has(node.id)) : list;

    visible.forEach((node, index) => {
      const isLast = index === visible.length - 1;
      rows.push({
        node,
        depth,
        isLast,
        guides,
        hits: hitsById.get(node.id) ?? [],
      });

      const isOpen = filtering || expanded.has(node.id);
      if (isOpen && node.children.length > 0) {
        // A node at depth D draws D-1 guide columns plus one elbow column:
        // the elbow already carries the parent's own vertical line, so a
        // root's children start with no guides. Beyond that, each level
        // adds a guide that continues only if this node has a sibling below.
        walk(node.children, depth + 1, depth === 0 ? [] : [...guides, !isLast]);
      }
    });
  };

  walk(nodes, 0, []);
  return rows;
}

/** Ancestor ids of `targetId`, root-first. Empty when not found. */
export function ancestorIdsOf(nodes: CategoryNode[], targetId: string): string[] {
  let result: string[] = [];

  const find = (list: CategoryNode[], chain: string[]): boolean => {
    for (const node of list) {
      if (node.id === targetId) {
        result = chain;
        return true;
      }
      if (find(node.children, [...chain, node.id])) return true;
    }
    return false;
  };

  find(nodes, []);
  return result;
}

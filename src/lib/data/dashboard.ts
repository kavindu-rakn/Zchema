// ── Dashboard queries ────────────────────────────────────────
// The dashboard answers three questions: what is in here, what needs
// my attention, and where do I go. Everything below is derived from a
// single tree call plus a few small queries — no per-category round
// trips.

import { createClient } from "@/utils/supabase/server";
import { getCategoryTreeFlat } from "@/lib/data/categories";
import type { CategoryNode } from "@/lib/types";

export interface DashboardShape {
  categories: number;
  rootCategories: number;
  maxDepth: number;          // 1 = roots only
  items: number;
  authoredFields: number;    // field definitions written across the tree
  inheritedSlots: number;    // field slots filled by inheritance
}

export interface AttentionItem {
  kind: "no_items" | "missing_required" | "stale_version" | "dead_node";
  categoryId: string;
  categoryName: string;
  detail: string;
  href: string;
}

export interface ActivityEntry {
  kind: "schema_change" | "item";
  id: string;
  at: string;
  title: string;
  detail: string;
  href: string;
}

export interface DashboardData {
  shape: DashboardShape;
  schemaChanges7d: number;
  attention: AttentionItem[];
  activity: ActivityEntry[];
  recentCategories: { id: string; name: string }[];
}

/** Depth of each node, 1-based, from a flat list. */
function depthOf(node: CategoryNode, byId: Map<string, CategoryNode>): number {
  let depth = 1;
  let current = node;
  // Guard against a cycle even though the DB trigger prevents one.
  const seen = new Set<string>([current.id]);
  while (current.parent_id) {
    const parent = byId.get(current.parent_id);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    current = parent;
    depth += 1;
  }
  return depth;
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = await createClient();

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [tree, changesRes, recentVersionsRes, recentItemsRes, missingRes] = await Promise.all([
    getCategoryTreeFlat(),
    supabase
      .from("schema_versions")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo.toISOString()),
    supabase
      .from("schema_versions")
      .select("id, category_id, version, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("items")
      .select("id, category_id, data, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.rpc("get_items_missing_required"),
  ]);

  const byId = new Map(tree.map((node) => [node.id, node]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "Unknown category";

  // ── Shape ────────────────────────────────────────────────
  const shape: DashboardShape = {
    categories: tree.length,
    rootCategories: tree.filter((n) => !n.parent_id).length,
    maxDepth: tree.reduce((max, n) => Math.max(max, depthOf(n, byId)), 0),
    items: tree.reduce((sum, n) => sum + (n.item_count ?? 0), 0),
    authoredFields: tree.reduce((sum, n) => sum + (n.own_field_count ?? 0), 0),
    inheritedSlots: tree.reduce((sum, n) => sum + (n.inherited_field_count ?? 0), 0),
  };

  // ── Attention ────────────────────────────────────────────
  const attention: AttentionItem[] = [];
  const hasChildren = new Set(tree.map((n) => n.parent_id).filter(Boolean) as string[]);

  for (const node of tree) {
    const isLeaf = !hasChildren.has(node.id);
    const effectiveFields = (node.own_field_count ?? 0) + (node.inherited_field_count ?? 0);

    // A leaf with a schema and no data. Parents legitimately hold no
    // items of their own, so only leaves are worth flagging.
    if (isLeaf && effectiveFields > 0 && (node.item_count ?? 0) === 0) {
      attention.push({
        kind: "no_items",
        categoryId: node.id,
        categoryName: node.name,
        detail: `${effectiveFields} field${effectiveFields === 1 ? "" : "s"} defined, no data yet`,
        href: `/data-center/${node.id}?tab=items`,
      });
    }

    // Dead node: defines nothing, inherits nothing, leads nowhere.
    // Note this is stricter than "no own_fields and no children" — a leaf
    // that authors no fields but inherits a working schema is a normal
    // specialisation, not a dead node, so flagging it would be noise.
    if (isLeaf && effectiveFields === 0) {
      attention.push({
        kind: "dead_node",
        categoryId: node.id,
        categoryName: node.name,
        detail: "No fields and no children",
        href: `/data-center/${node.id}?tab=schema`,
      });
    }
  }

  const missing = (missingRes.data ?? []) as {
    category_id: string;
    category_name: string;
    missing_count: number;
  }[];
  for (const row of missing) {
    attention.push({
      kind: "missing_required",
      categoryId: row.category_id,
      categoryName: row.category_name,
      detail: `${row.missing_count} item${row.missing_count === 1 ? "" : "s"} missing a required value`,
      href: `/data-center/${row.category_id}?tab=items`,
    });
  }

  // Stale schema_version is populated in Phase 5 — nothing to report yet.

  // ── Activity (interleaved by timestamp) ──────────────────
  const versions = (recentVersionsRes.data ?? []) as {
    id: string;
    category_id: string;
    version: number;
    created_at: string;
  }[];
  const items = (recentItemsRes.data ?? []) as {
    id: string;
    category_id: string;
    data: Record<string, unknown>;
    created_at: string;
  }[];

  const activity: ActivityEntry[] = [
    ...versions.map((v) => ({
      kind: "schema_change" as const,
      id: v.id,
      at: v.created_at,
      title: nameOf(v.category_id),
      detail: `Schema updated to v${v.version}`,
      href: `/data-center/${v.category_id}?tab=history`,
    })),
    ...items.map((item) => ({
      kind: "item" as const,
      id: item.id,
      at: item.created_at,
      title: nameOf(item.category_id),
      detail: `Item added${labelForItem(item.data) ? ` — ${labelForItem(item.data)}` : ""}`,
      href: `/data-center/${item.category_id}?tab=items`,
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 8);

  // ── Quick links for the empty-selection state ────────────
  const recentCategories = [...tree]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 3)
    .map((n) => ({ id: n.id, name: n.name }));

  return {
    shape,
    schemaChanges7d: changesRes.count ?? 0,
    attention,
    activity,
    recentCategories,
  };
}

/** Best-effort human label for an item, for activity rows. */
function labelForItem(data: Record<string, unknown>): string | null {
  for (const key of ["name", "title", "model", "sku", "brand", "author"]) {
    const value = data?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

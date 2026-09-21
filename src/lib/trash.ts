// ── Trash entries, in words ──────────────────────────────────
// Pure, so the wording — the part a person actually reads before
// deciding whether to restore or destroy something — is unit-tested.

import { itemTitle } from "./items.ts";
import type { TrashEntry } from "./types.ts";

export interface TrashEntryDescription {
  kind: "category" | "items";
  /** "“Laptops”", "“Aeron Chair”", "12 items". */
  title: string;
  /** "with 3 subcategories and 20 items", "from Office Chairs". */
  detail: string | null;
  /** Restoring categories is a schema change: SCHEMA_ADMIN only. */
  needsAdmin: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const quoted = (text: string) => `“${text}”`;

/** "a", "a and b", "a, b and c". */
function listOf(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function describeTrashEntry(entry: TrashEntry): TrashEntryDescription {
  if (entry.categories > 0) {
    const tops = entry.top_categories;
    const title = tops.length === 1 ? quoted(tops[0]) : listOf(tops.map(quoted));
    const below = entry.categories - tops.length;
    const contents = [
      below > 0 ? plural(below, "subcategory", "subcategories") : null,
      entry.items > 0 ? plural(entry.items, "item", "items") : null,
    ].filter((part): part is string => part !== null);

    return {
      kind: "category",
      title,
      detail: contents.length > 0 ? `with ${listOf(contents)}` : "empty — no subcategories or items",
      needsAdmin: true,
    };
  }

  const names = entry.item_samples
    .map((data) => itemTitle(data))
    .filter((name): name is string => name !== null);
  const title =
    entry.items === 1 && names.length === 1 ? quoted(names[0]) : plural(entry.items, "item", "items");

  const home =
    entry.home_categories.length === 1
      ? `from ${entry.home_categories[0]}`
      : entry.home_categories.length > 1
        ? `from ${entry.home_categories.length} categories`
        : null;
  const including =
    entry.items > 1 && names.length > 0
      ? `including ${listOf(names.map(quoted))}${entry.items > names.length ? "…" : ""}`
      : null;

  return {
    kind: "items",
    title,
    detail: [home, including].filter(Boolean).join(" · ") || null,
    needsAdmin: false,
  };
}

"use client";

// ── Attribute list rail ──────────────────────────────────────
// Grouped by group_name, searchable, with the promotion prompt pinned
// above the list — because the prompt is how the library gets
// populated, and a registry nobody fills is a registry nobody uses.

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Search, Tags } from "lucide-react";

import { DuplicatesPanel } from "@/components/attributes/duplicates-panel";
import { NewAttributeDialog } from "@/components/attributes/new-attribute-dialog";
import { cn } from "@/lib/utils";
import type { AttributeWithUsage, DuplicateFieldDefinition } from "@/lib/types";

const UNGROUPED = "Ungrouped";

export function AttributeRail({
  attributes,
  duplicates,
  canEdit,
}: {
  attributes: AttributeWithUsage[];
  duplicates: DuplicateFieldDefinition[];
  canEdit: boolean;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const activeId = pathname.split("/")[3] ?? null;

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? attributes.filter(
          (attribute) =>
            attribute.label.toLowerCase().includes(needle) ||
            attribute.key.toLowerCase().includes(needle) ||
            (attribute.group_name ?? "").toLowerCase().includes(needle)
        )
      : attributes;

    const map = new Map<string, AttributeWithUsage[]>();
    for (const attribute of matched) {
      const group = attribute.group_name?.trim() || UNGROUPED;
      map.set(group, [...(map.get(group) ?? []), attribute]);
    }

    // Ungrouped last — it is a holding pen, not a category.
    return [...map.entries()].sort(([a], [b]) =>
      a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)
    );
  }, [attributes, query]);

  return (
    <aside
      className="sticky top-0 flex h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col self-start border-r border-border bg-card/20"
      aria-label="Attributes"
    >
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Attributes
        </h2>
      </div>

      <div className="border-b border-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter attributes"
            aria-label="Filter attributes"
            className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {canEdit && duplicates.length > 0 && !query && (
          <DuplicatesPanel duplicates={duplicates} />
        )}

        {attributes.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            No attributes yet. Promote a repeated field from the panel above, or create one.
          </p>
        ) : groups.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            Nothing matches “{query}”.
          </p>
        ) : (
          groups.map(([group, entries]) => (
            <div key={group} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <ul className="space-y-0.5">
                {entries.map((attribute) => {
                  const isActive = attribute.id === activeId;
                  return (
                    <li key={attribute.id}>
                      <Link
                        href={`/data-center/attributes/${attribute.id}`}
                        className={cn(
                          "flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActive ? "bg-accent" : "hover:bg-accent/50"
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <Tags
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              isActive ? "text-primary" : "text-muted-foreground"
                            )}
                          />
                          <span
                            className={cn(
                              "truncate text-sm",
                              isActive ? "font-medium text-foreground" : "text-foreground/90"
                            )}
                          >
                            {attribute.label}
                          </span>
                        </span>
                        <span className="pl-5 text-[11px] text-muted-foreground">
                          {attribute.type}
                          {attribute.category_count > 0 ? (
                            <>
                              {" · used in "}
                              {attribute.category_count} categor
                              {attribute.category_count === 1 ? "y" : "ies"}
                            </>
                          ) : (
                            " · unused"
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </nav>

      {canEdit && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-3.5 w-3.5" />
            New attribute
          </button>
        </div>
      )}

      <NewAttributeDialog open={creating} onOpenChange={setCreating} />
    </aside>
  );
}

"use client";

// ── Search results ───────────────────────────────────────────
// Cards, not a table. A table needs uniform columns, and the whole
// premise here is that results come from categories with different
// schemas — the row for a laptop and the row for a dress genuinely do
// not share a shape.
//
// Each card shows the display value, the breadcrumb (essential: you did
// not know where the item lived, that is why you searched), and the
// three or four fields that actually matched, with the search terms
// highlighted.

import { useMemo, useState } from "react";
import Link from "next/link";
import { Columns2, LayoutList, Rows3, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CompareDialog } from "@/components/search/compare-dialog";
import { cn } from "@/lib/utils";
import type { SearchFilter, SearchResult } from "@/lib/types";

/**
 * Comparison caps out at 5 columns.
 *
 * Not an arbitrary limit: past five the table stops fitting and the
 * feature stops answering "what is different about these" — which is
 * the only reason anyone opens it.
 */
const MAX_COMPARE = 5;

/** Split text on the search terms so matches can be marked. */
function highlight(text: string, terms: string[]) {
  if (terms.length === 0) return text;

  // Escape the terms — a user searching "c++" must not build a regex.
  const pattern = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi"
  );

  return text.split(pattern).map((part, index) =>
    terms.some((term) => term.toLowerCase() === part.toLowerCase()) ? (
      <mark key={index} className="rounded bg-primary/20 px-0.5 text-foreground">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

/** The field most likely to name the item. */
function displayValue(data: Record<string, unknown>): string {
  for (const key of ["name", "title", "model", "model_number", "label", "sku"]) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  const first = Object.entries(data).find(
    ([key, value]) => key !== "__orphaned" && typeof value === "string" && value.trim()
  );
  return (first?.[1] as string) ?? "Untitled item";
}

/**
 * The fields worth showing on a card.
 *
 * Anything the query filtered on comes first — if you asked for
 * price:>500, the price is the reason this row is here and it should
 * not be buried. Then whatever matched the free text, then filler.
 */
function relevantFields(
  data: Record<string, unknown>,
  terms: string[],
  filters: SearchFilter[],
  limit = 4
): [string, unknown][] {
  const entries = Object.entries(data).filter(
    ([key, value]) =>
      key !== "__orphaned" && value !== null && value !== undefined && String(value).trim() !== ""
  );

  const filterKeys = new Set(filters.map((filter) => filter.key));
  const score = ([key, value]: [string, unknown]) => {
    if (filterKeys.has(key)) return 0;
    const text = String(value).toLowerCase();
    if (terms.some((term) => text.includes(term.toLowerCase()))) return 1;
    return 2;
  };

  return entries.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

export function SearchResults({
  rows,
  terms,
  filters,
}: {
  rows: SearchResult[];
  /** Free-text terms, for highlighting. */
  terms: string[];
  filters: SearchFilter[];
}) {
  const [grouped, setGrouped] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  // Selection order is preserved so the comparison columns appear in the
  // order they were picked, not in result order.
  const chosen = selected.map((id) => byId.get(id)).filter(Boolean) as SearchResult[];

  const toggle = (id: string) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((other) => other !== id)
        : previous.length >= MAX_COMPARE
          ? previous
          : [...previous, id]
    );

  const groups = useMemo(() => {
    const map = new Map<string, { path: string; rows: SearchResult[] }>();
    for (const row of rows) {
      const entry = map.get(row.category_id) ?? { path: row.category_path, rows: [] };
      entry.rows.push(row);
      map.set(row.category_id, entry);
    }
    return [...map.entries()];
  }, [rows]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => setGrouped(false)}
          aria-pressed={!grouped}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
            grouped ? "text-muted-foreground hover:bg-accent" : "bg-accent text-foreground"
          )}
        >
          <LayoutList className="h-3.5 w-3.5" />
          Flat
        </button>
        <button
          type="button"
          onClick={() => setGrouped(true)}
          aria-pressed={grouped}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
            grouped ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent"
          )}
        >
          <Rows3 className="h-3.5 w-3.5" />
          By category
        </button>
      </div>

      {grouped ? (
        <div className="space-y-4">
          {groups.map(([categoryId, group]) => (
            <section key={categoryId} className="space-y-2">
              <h3 className="flex items-baseline gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Link
                  href={`/data-center/${categoryId}?tab=items`}
                  className="hover:text-foreground hover:underline"
                >
                  {group.path}
                </Link>
                <span>({group.rows.length})</span>
              </h3>
              <ul className="space-y-2">
                {group.rows.map((row) => (
                  <ResultCard
                    key={row.id}
                    row={row}
                    terms={terms}
                    filters={filters}
                    showPath={false}
                    selected={selected.includes(row.id)}
                    selectable={selected.length < MAX_COMPARE || selected.includes(row.id)}
                    onToggle={() => toggle(row.id)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <ResultCard
              key={row.id}
              row={row}
              terms={terms}
              filters={filters}
              showPath
              selected={selected.includes(row.id)}
              selectable={selected.length < MAX_COMPARE || selected.includes(row.id)}
              onToggle={() => toggle(row.id)}
            />
          ))}
        </ul>
      )}

      {/* Floating compare bar — appears only once something is picked,
          so it costs nothing until it is wanted. */}
      {chosen.length > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-card px-3 py-2 shadow-md">
          <span className="text-sm text-foreground">
            {chosen.length} selected
            {chosen.length === 1 && (
              <span className="ml-1 text-muted-foreground">— pick one more to compare</span>
            )}
            {chosen.length >= MAX_COMPARE && (
              <span className="ml-1 text-muted-foreground">— that is the maximum</span>
            )}
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              disabled={chosen.length < 2}
              onClick={() => setComparing(true)}
            >
              <Columns2 className="mr-1.5 h-3.5 w-3.5" />
              Compare
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Clear the selection"
              onClick={() => setSelected([])}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <CompareDialog open={comparing} onOpenChange={setComparing} items={chosen} />
    </div>
  );
}

function ResultCard({
  row,
  terms,
  filters,
  showPath,
  selected,
  selectable,
  onToggle,
}: {
  row: SearchResult;
  terms: string[];
  filters: SearchFilter[];
  showPath: boolean;
  selected: boolean;
  selectable: boolean;
  onToggle: () => void;
}) {
  const fields = relevantFields(row.data, terms, filters);
  const filterKeys = new Set(filters.map((filter) => filter.key));

  return (
    <li className="relative">
      {/* Outside the Link, not inside it: a checkbox nested in an
          anchor is a click-target fight nobody wins. */}
      <label
        className="absolute left-3 top-3 z-10 flex cursor-pointer items-center"
        title={selectable ? "Select to compare" : `You can compare up to ${MAX_COMPARE} items`}
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={!selectable}
          onChange={onToggle}
          aria-label={`Compare ${displayValue(row.data)}`}
          className="h-3.5 w-3.5 rounded border-input disabled:opacity-40"
        />
      </label>

      <Link
        href={`/data-center/${row.category_id}?tab=items`}
        className={cn(
          "block rounded-lg border bg-card p-3 pl-9 transition-colors hover:border-primary/40 hover:bg-accent/30",
          selected ? "border-primary/50 bg-primary/5" : "border-border"
        )}
      >
        <p className="text-sm font-medium text-foreground">
          {highlight(displayValue(row.data), terms)}
        </p>

        {showPath && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">{row.category_path}</p>
        )}

        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          {fields.map(([key, value]) => (
            <div key={key} className="flex min-w-0 items-baseline gap-1.5">
              <dt
                className={cn(
                  "shrink-0 text-[11px]",
                  filterKeys.has(key) ? "text-primary" : "text-muted-foreground"
                )}
              >
                {key}
              </dt>
              <dd className="min-w-0 truncate text-xs text-foreground">
                {highlight(String(value), terms)}
              </dd>
            </div>
          ))}
        </dl>
      </Link>
    </li>
  );
}

"use client";

// ── Compare ──────────────────────────────────────────────────
// Side-by-side, items as columns, the union of their fields as rows.
//
// The quietly impressive part is that comparing a laptop against a
// dress WORKS. The rows they share are exactly the fields they inherit
// from a common ancestor — so the comparison table is inheritance doing
// visible work, and a row that only one item has renders as an honest
// dash rather than being hidden.
//
// Differing rows are highlighted, because "what is different about
// these" is the only question anyone opens this to answer.

import { useMemo } from "react";
import Link from "next/link";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/lib/types";

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

function cell(value: unknown): string | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function CompareDialog({
  open,
  onOpenChange,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SearchResult[];
}) {
  const rows = useMemo(() => {
    // Union of every key any selected item has, in first-seen order so
    // the shared fields — which come from the common ancestor — surface
    // at the top rather than being scattered alphabetically.
    const keys: string[] = [];
    for (const item of items) {
      for (const key of Object.keys(item.data ?? {})) {
        if (key !== "__orphaned" && !keys.includes(key)) keys.push(key);
      }
    }

    return keys.map((key) => {
      const values = items.map((item) => cell(item.data?.[key]));
      const present = values.filter((value) => value !== null);
      const differs = new Set(present).size > 1 || present.length !== values.length;
      const shared = present.length === values.length;
      return { key, values, differs, shared };
    });
  }, [items]);

  const sharedCount = rows.filter((row) => row.shared).length;
  const differingCount = rows.filter((row) => row.differs).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Comparing {items.length} items</DialogTitle>
          <DialogDescription>
            {sharedCount} field{sharedCount === 1 ? "" : "s"} in common
            {items.length > 1 && sharedCount > 0 && (
              <>
                {" — "}
                {new Set(items.map((item) => item.category_id)).size > 1
                  ? "inherited from a shared ancestor"
                  : "from the same category"}
              </>
            )}
            {differingCount > 0 && <> · {differingCount} differ</>}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Field
                </th>
                {items.map((item) => (
                  <th
                    key={item.id}
                    className="min-w-40 border-l border-border/60 px-3 py-2 text-left align-top"
                  >
                    <Link
                      href={`/data-center/${item.category_id}?tab=items`}
                      className="block truncate font-medium text-foreground hover:underline"
                    >
                      {displayValue(item.data)}
                    </Link>
                    <span className="block truncate text-[11px] font-normal text-muted-foreground">
                      {item.category_path}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={cn(
                    "border-b border-border/40 last:border-0",
                    row.differs && "bg-warning/5"
                  )}
                >
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 bg-background px-3 py-1.5 text-left align-top text-xs font-normal",
                      row.shared ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    <code>{row.key}</code>
                    {!row.shared && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground/70">
                        partial
                      </span>
                    )}
                  </th>

                  {row.values.map((value, index) => (
                    <td
                      key={items[index].id}
                      className="border-l border-border/60 px-3 py-1.5 align-top text-xs"
                    >
                      {value === null ? (
                        <span className="text-muted-foreground/40" title="This item has no such field">
                          —
                        </span>
                      ) : (
                        <span className="text-foreground">{value}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-3 border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm bg-warning/20" aria-hidden />
            differs between items
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden>—</span>
            this item has no such field
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

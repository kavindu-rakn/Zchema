"use client";

// ── Export ───────────────────────────────────────────────────
// A plain link to a streaming route, not a fetch-then-blob dance. The
// browser's own download machinery handles a streamed response better
// than any JavaScript would: progress in the download shelf, no memory
// held on the client, and it survives navigating away mid-download.

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ExportButton({
  /** DSL query text — the search page's `q`. */
  query = "",
  /** Explicit category scope — the Items tab passes the category it shows. */
  categoryId,
  scopeName,
  /** False exports the category's own rows, not its descendants'. */
  includeSubtree = true,
  /** How many rows the current filters match, purely to set expectations. */
  total,
  label = "Export",
}: {
  query?: string;
  categoryId?: string | null;
  scopeName?: string;
  includeSubtree?: boolean;
  total?: number;
  label?: string;
}) {
  const href = (format: "csv" | "json", orphaned: boolean) => {
    const params = new URLSearchParams({ format });
    if (query.trim()) params.set("q", query.trim());
    if (categoryId) params.set("category", categoryId);
    if (scopeName) params.set("scopeName", scopeName);
    if (!includeSubtree) params.set("subtree", "0");
    if (orphaned) params.set("orphaned", "1");
    return `/api/export?${params.toString()}`;
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm">
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {label}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="text-xs text-muted-foreground">
            {typeof total === "number"
              ? `${total} row${total === 1 ? "" : "s"} matching the current filters`
              : "Everything matching the current filters"}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem render={<a href={href("csv", false)} download>CSV</a>} />
        <DropdownMenuItem render={<a href={href("json", false)} download>JSON</a>} />

        <DropdownMenuSeparator />
        {/* Orphaned values are excluded by default: they are not part
            of the live schema, and a column of stale JSON in an
            otherwise clean export surprises people. Opt in. */}
        <DropdownMenuItem
          render={
            <a href={href("csv", true)} download>
              CSV, including orphaned data
            </a>
          }
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

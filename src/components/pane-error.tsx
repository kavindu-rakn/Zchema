"use client";

// ── Pane-scoped error state ──────────────────────────────────
// Rendered by the error.tsx boundaries that sit BELOW a layout, so a
// detail pane that fails to load does not take the navigation with it.
// Losing the tree because one category's schema query threw leaves the
// user with no way out except the back button.

import { AlertTriangle, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

export function PaneError({
  error,
  reset,
  what,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  /** What failed, named — "this category", "the search". */
  what: string;
}) {
  return (
    <div role="alert" className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="rounded-full border border-destructive/20 bg-destructive/10 p-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>

        <h2 className="text-base font-medium text-foreground">Could not load {what}</h2>

        {/* The Phase 1 triggers raise messages written for humans, so
            showing the message beats hiding it behind "an error
            occurred". */}
        <p className="text-sm text-muted-foreground">
          {error.message || "Something went wrong fetching this."}
        </p>

        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        )}

        <Button onClick={reset} variant="outline" size="sm" className="mt-1">
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    </div>
  );
}

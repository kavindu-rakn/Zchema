"use client";

// ── Pane-scoped error state ──────────────────────────────────
// Rendered by the error.tsx boundaries that sit BELOW a layout, so a
// detail pane that fails to load does not take the navigation with it.
// Losing the tree because one category's schema query threw leaves the
// user with no way out except the back button.

import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTransientRetry } from "@/components/use-transient-retry";
import { TRANSIENT_MESSAGE, isTransientError } from "@/lib/transient";

export function PaneError({
  error,
  retry,
  what,
}: {
  error: Error & { digest?: string };
  /**
   * Pass the boundary's `unstable_retry`, not `reset`. reset() re-renders
   * without re-fetching, so a server-side failure — a flaky query, an
   * expired token — just fails again; retry fetches afresh.
   */
  retry: () => void;
  /** What failed, named — "this category", "the search". */
  what: string;
}) {
  // A token that rotated mid-request is worth one quiet retry before
  // anyone is shown anything.
  const retrying = useTransientRetry(error.message, retry);

  if (retrying) {
    return (
      <div role="status" className="flex min-h-[50vh] items-center justify-center p-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reconnecting…
        </p>
      </div>
    );
  }

  return (
    <div role="alert" className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="rounded-full border border-destructive/20 bg-destructive/10 p-3">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>

        <h2 className="text-base font-medium text-foreground">Could not load {what}</h2>

        {/* The Phase 1 triggers raise messages written for humans, so
            showing the message beats hiding it behind "an error
            occurred" — except for the session and connection errors,
            whose text says nothing a user can act on. */}
        <p className="text-sm text-muted-foreground">
          {isTransientError(error.message)
            ? TRANSIENT_MESSAGE
            : error.message || "Something went wrong fetching this."}
        </p>

        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground/70">Reference: {error.digest}</p>
        )}

        <Button onClick={retry} variant="outline" size="sm" className="mt-1">
          <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    </div>
  );
}

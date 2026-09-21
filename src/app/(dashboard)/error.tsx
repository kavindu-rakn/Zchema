"use client";

import Link from "next/link";
import { AlertTriangle, Loader2, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTransientRetry } from "@/components/use-transient-retry";
import { TRANSIENT_MESSAGE, isTransientError } from "@/lib/transient";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  /** Re-fetches; reset() would re-render the same failed payload. */
  unstable_retry: () => void;
}) {
  // A session that rotated mid-request gets one quiet retry first.
  const retrying = useTransientRetry(error.message, unstable_retry);

  if (retrying) {
    return (
      <div role="status" className="flex min-h-[60vh] items-center justify-center p-6">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Reconnecting…
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="rounded-full border border-destructive/20 bg-destructive/10 p-4">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>

        <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>

        {/* Database triggers raise human-readable messages, so showing
            the message is usually more helpful than hiding it — but a
            JWT or socket error says nothing a user can act on. */}
        <p className="text-sm text-muted-foreground">
          {isTransientError(error.message)
            ? TRANSIENT_MESSAGE
            : error.message || "An unexpected error occurred. Please try again."}
        </p>

        {error.digest && (
          <p className="font-mono text-xs text-muted-foreground/70">
            Reference: {error.digest}
          </p>
        )}

        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button onClick={unstable_retry} variant="outline">
            <RefreshCcw className="mr-2 h-4 w-4" />
            Try again
          </Button>
          {/* Rendered as a link, so it must not claim native button
              semantics — Base UI warns, and assistive tech is misled. */}
          <Button variant="ghost" nativeButton={false} render={<Link href="/dashboard" />}>
            Back to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}

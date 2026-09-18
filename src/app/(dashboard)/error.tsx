"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  /** Re-fetches; reset() would re-render the same failed payload. */
  unstable_retry: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="rounded-full border border-destructive/20 bg-destructive/10 p-4">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>

        <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>

        {/* Database triggers raise human-readable messages, so showing
            the message is usually more helpful than hiding it. */}
        <p className="text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred. Please try again."}
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

"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="flex flex-col items-center gap-4 text-center max-w-md">
        <div className="rounded-full bg-red-500/10 p-4 border border-red-500/20">
          <AlertTriangle className="h-6 w-6 text-red-400" />
        </div>
        <h2 className="text-xl font-semibold text-zinc-100">
          Something went wrong
        </h2>
        <p className="text-sm text-zinc-400">
          {error.message || "An unexpected error occurred. Please try again."}
        </p>
        <Button
          onClick={reset}
          variant="outline"
          className="mt-2 border-zinc-800 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      </div>
    </div>
  );
}

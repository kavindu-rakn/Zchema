"use client";

// ── Last-resort error boundary ───────────────────────────────
// Catches what no route boundary can: an error in the root layout
// itself. While shown it REPLACES the root layout, so it brings its own
// <html>, <body> and stylesheet — and depends on as little as possible,
// with no UI kit and no providers, because whatever broke may be one of
// them. The message is not shown: in production it is a generic
// placeholder anyway, and the digest is what matches the server log.

import "./globals.css";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="flex min-h-full items-center justify-center bg-background p-6 font-sans text-foreground antialiased">
        <title>Something went wrong · Zchema</title>
        <main role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-semibold">Zchema could not load</h1>
          <p className="text-sm text-muted-foreground">
            Something failed before the page could render. Trying again usually clears a
            temporary problem.
          </p>
          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground/70">Reference: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={unstable_retry}
            className="mt-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

// Shown while the Data Center layout resolves the tree. Mirrors the
// real two-pane shape so nothing shifts when it arrives.

export default function DataCenterLoading() {
  return (
    <div
      className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Loading the Data Center…</span>

      {/* Rail */}
      <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card/30">
        <div className="border-b border-border p-2">
          <div className="h-8 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="flex-1 space-y-1 p-2">
          {[0, 1, 2, 3, 4, 5, 6].map((index) => (
            <div
              key={index}
              className="h-7 animate-pulse rounded-md bg-muted"
              style={{ marginLeft: index % 3 === 0 ? 0 : 12, opacity: 1 - index * 0.1 }}
            />
          ))}
        </div>
        <div className="border-t border-border p-2">
          <div className="h-7 animate-pulse rounded-md bg-muted" />
        </div>
      </div>

      {/* Detail */}
      <div className="min-w-0 flex-1 space-y-6 p-6">
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        <div className="h-8 w-72 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-[108px] animate-pulse rounded-xl border border-border/50 bg-card"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// Skeleton shaped like the page that is arriving — a centred spinner
// tells you nothing about what is coming and makes the layout jump
// when content lands.

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      {/* Hero */}
      <div className="h-[104px] animate-pulse rounded-xl border border-border/50 bg-card" />

      {/* Stat row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[108px] animate-pulse rounded-xl border border-border/50 bg-card"
          />
        ))}
      </div>

      {/* Panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="h-56 animate-pulse rounded-xl border border-border/50 bg-card"
          />
        ))}
      </div>
    </div>
  );
}

// Detail-pane only: the rail is owned by the layout and stays put
// while you move between categories.

export default function CategoryDetailLoading() {
  return (
    <div className="flex min-h-full flex-col" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading category…</span>

      <div className="space-y-3 px-6 pb-4 pt-6">
        <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        <div className="h-8 w-72 animate-pulse rounded bg-muted" />
      </div>

      <div className="border-b border-border px-6">
        <div className="flex gap-4 pb-2.5">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-5 w-16 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>

      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-[108px] animate-pulse rounded-xl border border-border/50 bg-card"
            />
          ))}
        </div>
        <div className="h-40 animate-pulse rounded-xl border border-border/50 bg-card" />
      </div>
    </div>
  );
}

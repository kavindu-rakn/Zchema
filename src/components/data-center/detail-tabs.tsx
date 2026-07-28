// ── Detail pane tabs ─────────────────────────────────────────
// Tab state lives in the URL (`?tab=schema`), so tabs are linkable and
// the back button works.
//
// These are plain links rather than a client component driving
// useRouter/useSearchParams: the active tab is already known on the
// server from `searchParams`, so links give the same behaviour with no
// client JS, no Suspense boundary, and no static-rendering bailout —
// and they middle-click into a new tab, which a button cannot.

import Link from "next/link";
import { cn } from "@/lib/utils";

export const DETAIL_TABS = ["overview", "schema", "items", "history"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export function isDetailTab(value: string | undefined): value is DetailTab {
  return !!value && (DETAIL_TABS as readonly string[]).includes(value);
}

const LABELS: Record<DetailTab, string> = {
  overview: "Overview",
  schema: "Schema",
  items: "Items",
  history: "History",
};

export function DetailTabs({
  categoryId,
  active,
  itemCount,
}: {
  categoryId: string;
  active: DetailTab;
  itemCount?: number;
}) {
  return (
    <div className="border-b border-border">
      <nav className="flex gap-1 px-6" aria-label="Category detail sections">
        {DETAIL_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <Link
              key={tab}
              href={`/data-center/${categoryId}?tab=${tab}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isActive
                  ? "border-primary font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {LABELS[tab]}
              {tab === "items" && typeof itemCount === "number" && itemCount > 0 && (
                <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums text-secondary-foreground">
                  {itemCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

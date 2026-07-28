// ── Ancestor-chain breadcrumbs ───────────────────────────────
// Renders `Electronics › Laptops › Gaming Laptops`, every segment a
// link to its own node. Beyond four levels the middle collapses to `…`
// so a deep chain cannot push the trailing (current) node off-screen.
//
// Server component — no interactivity beyond links.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Crumb {
  id: string;
  name: string;
}

const MAX_VISIBLE = 4;

export function Breadcrumbs({
  chain,
  className,
  hrefFor = (crumb: Crumb) => `/data-center/${crumb.id}`,
}: {
  /** Ancestors ROOT-FIRST, current node last. */
  chain: Crumb[];
  className?: string;
  hrefFor?: (crumb: Crumb) => string;
}) {
  if (!chain?.length) return null;

  // Collapse the middle, always keeping the root and the last two nodes.
  const collapsed = chain.length > MAX_VISIBLE;
  const visible: (Crumb | "ellipsis")[] = collapsed
    ? [chain[0], "ellipsis", ...chain.slice(-2)]
    : chain;

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex items-center gap-1 text-sm">
        {visible.map((crumb, index) => {
          const isLast = index === visible.length - 1;

          if (crumb === "ellipsis") {
            return (
              <li key="ellipsis" className="flex items-center gap-1">
                <span
                  className="px-1 text-muted-foreground"
                  title={chain.slice(1, -2).map((c) => c.name).join(" › ")}
                >
                  …
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
              </li>
            );
          }

          return (
            <li key={crumb.id} className="flex min-w-0 items-center gap-1">
              {isLast ? (
                <span
                  aria-current="page"
                  className="truncate font-medium text-foreground"
                  title={crumb.name}
                >
                  {crumb.name}
                </span>
              ) : (
                <>
                  <Link
                    href={hrefFor(crumb)}
                    className="truncate rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title={crumb.name}
                  >
                    {crumb.name}
                  </Link>
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60"
                    aria-hidden
                  />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

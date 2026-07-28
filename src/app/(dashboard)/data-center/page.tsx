import Link from "next/link";
import { ArrowRight, Clock, FolderTree, Layers } from "lucide-react";

import { getRecentCategories } from "@/lib/data/categories";

export const dynamic = "force-dynamic";

// No node selected. A blank pane reads as broken, so this offers the
// three most recently touched categories as a way straight back in.

export default async function DataCenterPage() {
  const recent = await getRecentCategories(3);

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-12">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <FolderTree className="h-5 w-5" />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            Pick a category
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Choose a category from the tree to see its schema, its data and what it inherits — or
          create a new root category from the bottom of the tree.
        </p>
      </div>

      {recent.length > 0 && (
        <div className="mt-8 space-y-2">
          <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Recently updated
          </h2>
          <ul className="space-y-1">
            {recent.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/data-center/${category.id}`}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/40 px-3 py-2.5 transition-colors hover:border-primary/30 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Layers
                      className="h-4 w-4 shrink-0"
                      style={category.color ? { color: category.color } : undefined}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        {category.name}
                      </span>
                      {category.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {category.description}
                        </span>
                      )}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

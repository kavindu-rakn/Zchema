"use client";

// ── Blueprint list rail ──────────────────────────────────────

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Layers, Plus } from "lucide-react";

import { NewBlueprintDialog } from "@/components/blueprints/new-blueprint-dialog";
import { cn } from "@/lib/utils";
import type { BlueprintWithUsage } from "@/lib/data/blueprints";

export function BlueprintRail({
  blueprints,
  canEdit,
}: {
  blueprints: BlueprintWithUsage[];
  canEdit: boolean;
}) {
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const activeId = pathname.split("/")[3] ?? null;

  return (
    <aside
      className="sticky top-0 flex h-[calc(100vh-3.5rem)] w-56 shrink-0 flex-col self-start border-r border-border bg-card/20"
      aria-label="Blueprints"
    >
      <div className="border-b border-border px-3 py-2">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Blueprints
        </h2>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto p-2">
        {blueprints.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No blueprints yet.</p>
        ) : (
          <ul className="space-y-0.5">
            {blueprints.map((blueprint) => {
              const isActive = blueprint.id === activeId;
              return (
                <li key={blueprint.id}>
                  <Link
                    href={`/data-center/blueprints/${blueprint.id}`}
                    className={cn(
                      "flex flex-col gap-0.5 rounded-md px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      isActive ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <Layers
                        className={cn(
                          "h-3.5 w-3.5 shrink-0",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={cn(
                          "truncate text-sm",
                          isActive ? "font-medium text-foreground" : "text-foreground/90"
                        )}
                      >
                        {blueprint.name}
                      </span>
                    </span>
                    <span className="pl-5 text-[11px] text-muted-foreground">
                      {blueprint.fields?.length ?? 0} field
                      {(blueprint.fields?.length ?? 0) === 1 ? "" : "s"}
                      {blueprint.used_by_count > 0 && <> · used by {blueprint.used_by_count}</>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </nav>

      {canEdit && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-3.5 w-3.5" />
            New blueprint
          </button>
        </div>
      )}

      <NewBlueprintDialog open={creating} onOpenChange={setCreating} />
    </aside>
  );
}

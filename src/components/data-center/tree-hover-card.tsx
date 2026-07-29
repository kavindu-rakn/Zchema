"use client";

// ── Tree row hover preview ───────────────────────────────────
// A ~500ms hover shows what a node actually contains, so you can scan
// the tree without clicking through every node.
//
// No fetch: get_category_tree() returns whole category rows, so the
// effective schema resolves client-side from the tree already in hand.

import { useMemo } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { resolveEffectiveSchema } from "@/lib/schema";
import { chainTo } from "@/lib/tree";
import type { CategoryNode } from "@/lib/types";

export function TreeHoverCard({
  tree,
  node,
  children,
}: {
  tree: CategoryNode[];
  node: CategoryNode;
  children: React.ReactNode;
}) {
  const effective = useMemo(() => {
    const chain = chainTo(tree, node.id);
    return chain.length ? resolveEffectiveSchema(chain) : [];
  }, [tree, node.id]);

  const inheritedCount = effective.filter((field) => field.inherited).length;

  return (
    // The app-wide provider uses delay 0, which would make the tree
    // flicker on every pass of the mouse. A local provider gives this
    // one surface a deliberate hover delay.
    <TooltipProvider delay={500}>
      <Tooltip>
        <TooltipTrigger render={children as React.ReactElement} />
        <TooltipContent
          side="right"
          align="start"
          className="max-w-64 space-y-1.5 p-3 text-left"
        >
          <p className="text-xs font-medium text-foreground">{node.name}</p>

          <p className="text-[11px] text-muted-foreground">
            {effective.length} field{effective.length === 1 ? "" : "s"}
            {inheritedCount > 0 && <> · {inheritedCount} inherited</>}
            {" · "}
            {node.item_count} item{node.item_count === 1 ? "" : "s"}
            {node.subtree_item_count !== node.item_count && (
              <> ({node.subtree_item_count} with descendants)</>
            )}
          </p>

          {effective.length > 0 && (
            <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
              {effective
                .slice(0, 5)
                .map((field) => field.key)
                .join(", ")}
              {effective.length > 5 && ` +${effective.length - 5} more`}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

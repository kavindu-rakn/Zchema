"use client";

// ── Move (re-parent) a category ──────────────────────────────
// Re-parenting swaps the entire inherited half of the subtree's
// schema, so it is not a lighter operation than editing that schema by
// hand — it is the same operation reached from a different button.
//
// It therefore renders <ImpactDialog>, with the destination picker
// slotted above the change cards and analyze_category_move() supplying
// the analysis. There is exactly one place in this app where "this
// will break things" is explained, and one set of rules deciding what
// happens to the values caught in the middle.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { ImpactDialog } from "@/components/data-center/impact-dialog";
import { analyzeCategoryMove, applyCategoryMove } from "@/app/(dashboard)/data-center/actions";
import { iconFor } from "@/components/data-center/category-icons";
import { cn } from "@/lib/utils";
import type { CategoryNode, EffectiveField, Remediation, SchemaImpact } from "@/lib/types";

/** Flatten the tree for the picker, excluding the moving subtree. */
function pickerRows(
  nodes: CategoryNode[],
  excludeId: string,
  depth = 0
): { node: CategoryNode; depth: number }[] {
  const rows: { node: CategoryNode; depth: number }[] = [];
  for (const node of nodes) {
    if (node.id === excludeId) continue; // its own descendants go too
    rows.push({ node, depth });
    rows.push(...pickerRows(node.children, excludeId, depth + 1));
  }
  return rows;
}

export function MoveCategoryDialog({
  open,
  onOpenChange,
  category,
  tree,
  schema = [],
  initialTargetId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: { id: string; name: string; parent_id: string | null };
  tree: CategoryNode[];
  /** Current effective schema — types the backfill inputs. */
  schema?: EffectiveField[];
  /**
   * Destination already chosen — a drop or a keystroke. The picker
   * still renders so it can be corrected, but the analysis runs
   * immediately rather than making the user re-pick what they just
   * dragged onto.
   */
  initialTargetId?: string | null;
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(initialTargetId ?? null);
  const [touched, setTouched] = useState(initialTargetId !== undefined);
  const [impact, setImpact] = useState<SchemaImpact | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unchanged = touched && target === category.parent_id;

  // Analyse whenever a destination is chosen. No debounce: this is a
  // click, not a keystroke.
  useEffect(() => {
    let live = true;

    (async () => {
      if (!open || !touched || unchanged) {
        setImpact(null);
        setAnalysisError(null);
        return;
      }

      setAnalyzing(true);
      const result = await analyzeCategoryMove(category.id, target);
      if (!live) return;

      if (result.ok) {
        setImpact(result.data);
        setAnalysisError(null);
      } else {
        setImpact(null);
        setAnalysisError(result.error);
      }
      setAnalyzing(false);
    })();

    return () => {
      live = false;
    };
  }, [open, touched, unchanged, target, category.id]);

  // Reset on close in the event handler rather than an effect: closing
  // is a discrete user action, and there is nothing here to synchronise
  // with after the fact.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setTarget(initialTargetId ?? null);
      setTouched(initialTargetId !== undefined);
      setImpact(null);
      setAnalysisError(null);
    }
    onOpenChange(next);
  };

  const rows = pickerRows(tree, category.id);

  const apply = (remediations: Record<string, Remediation>): Promise<boolean> =>
    new Promise((resolve) => {
      startTransition(async () => {
        const result = await applyCategoryMove(category.id, target, remediations);
        if (!result.ok) {
          toast.error(result.error);
          resolve(false);
          return;
        }

        const { items_updated, items_orphaned, items_incomplete } = result.data;
        const parts: string[] = [];
        if (items_updated) parts.push(`${items_updated} item${items_updated === 1 ? "" : "s"} reconciled`);
        if (items_orphaned) parts.push(`${items_orphaned} orphaned`);
        if (items_incomplete) parts.push(`${items_incomplete} incomplete`);

        toast.success(`Moved “${category.name}”`, {
          description: parts.length > 0 ? parts.join(" · ") : "No item data needed changing.",
        });
        resolve(true);
        router.refresh();
      });
    });

  const notReady = !touched
    ? "Choose a destination."
    : unchanged
      ? "That is already its parent."
      : null;

  return (
    <ImpactDialog
      open={open}
      onOpenChange={handleOpenChange}
      categoryId={category.id}
      categoryName={category.name}
      schema={schema}
      impact={impact}
      analyzing={analyzing}
      analysisError={analysisError}
      pending={pending}
      onApply={apply}
      title={`Move “${category.name}”`}
      intro="Its own fields travel with it. Everything it inherits is replaced by the new parent's chain."
      applyLabel="Move category"
      applyingLabel="Moving…"
      notReadyReason={notReady}
      emptyMessage="Nothing changes — the new parent provides exactly the same inherited fields."
    >
      <div className="space-y-1">
        <span className="text-sm font-medium text-foreground">New parent</span>
        <div className="max-h-48 overflow-y-auto rounded-md border border-border">
          <button
            type="button"
            onClick={() => {
              setTarget(null);
              setTouched(true);
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
              target === null && touched && "bg-accent"
            )}
          >
            <span className="text-muted-foreground">↑</span>
            Make it a root category
          </button>

          {rows.map(({ node, depth }) => {
            const Icon = iconFor(node.icon);
            return (
              <button
                key={node.id}
                type="button"
                onClick={() => {
                  setTarget(node.id);
                  setTouched(true);
                }}
                style={{ paddingLeft: `${12 + depth * 16}px` }}
                className={cn(
                  "flex w-full items-center gap-2 py-2 pr-3 text-left text-sm transition-colors hover:bg-accent",
                  target === node.id && "bg-accent"
                )}
              >
                <Icon
                  className="h-3.5 w-3.5 shrink-0"
                  style={node.color ? { color: node.color } : undefined}
                />
                <span className="truncate">{node.name}</span>
                {node.id === category.parent_id && (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">current</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </ImpactDialog>
  );
}

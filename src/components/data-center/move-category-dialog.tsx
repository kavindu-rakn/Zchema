"use client";

// ── Move (re-parent) a category ──────────────────────────────
// Consequential enough to earn its own dialog: re-parenting swaps the
// entire inherited half of the subtree's schema. Two jobs here —
//   1. BLOCK the move when the new parent's chain already defines a key
//      this subtree authors, naming the key (the DB rejects it anyway,
//      but a trigger error after the fact is a poor way to find out).
//   2. Say in plain language what stays, what is lost, what is gained,
//      and how many items hold a value that is about to be orphaned.
// Full impact machinery is Phase 5.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { moveCategory, previewCategoryMove } from "@/app/(dashboard)/data-center/actions";
import { iconFor } from "@/components/data-center/category-icons";
import { cn } from "@/lib/utils";
import type { CategoryNode } from "@/lib/types";

interface Preview {
  blocked: boolean;
  collisions: string[];
  losing: string[];
  gaining: string[];
  keeping: string[];
  affectedItemCount: number;
}

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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: { id: string; name: string; parent_id: string | null };
  tree: CategoryNode[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setTarget(null);
      setTouched(false);
      setPreview(null);
    }
  }, [open]);

  // Resolve the consequences whenever a destination is chosen.
  useEffect(() => {
    if (!open || !touched) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const result = await previewCategoryMove(category.id, target);
      if (cancelled) return;
      if (!result.ok) {
        toast.error(result.error);
        setPreview(null);
      } else {
        setPreview(result.data);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, touched, target, category.id]);

  const rows = pickerRows(tree, category.id);
  const unchanged = touched && target === category.parent_id;

  const confirm = () => {
    startTransition(async () => {
      const result = await moveCategory(category.id, target);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Moved “${category.name}”`);
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Move “{category.name}”</DialogTitle>
          <DialogDescription>
            Its own fields travel with it. What it inherits is replaced by the new parent&apos;s
            chain.
          </DialogDescription>
        </DialogHeader>

        {/* Destination picker */}
        <div className="space-y-1">
          <span className="text-sm font-medium text-foreground">New parent</span>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border">
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

        {/* Consequences */}
        {touched && (
          <div className="space-y-3">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Working out what changes…
              </p>
            ) : unchanged ? (
              <p className="text-sm text-muted-foreground">
                That is already its parent — nothing would change.
              </p>
            ) : preview ? (
              <>
                {preview.blocked && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <span className="text-foreground">
                      This move is not possible.{" "}
                      {preview.collisions.map((key) => (
                        <code key={key} className="mx-0.5 text-destructive">
                          {key}
                        </code>
                      ))}
                      {preview.collisions.length === 1 ? " is" : " are"} defined inside this
                      subtree and would also be inherited from the new parent. A field cannot be
                      both inherited and redefined — rename or remove it first.
                    </span>
                  </div>
                )}

                {!preview.blocked && (
                  <div className="space-y-2 rounded-md border border-border bg-card/50 p-3 text-sm">
                    {preview.keeping.length > 0 && (
                      <p className="text-foreground">
                        <span className="font-mono text-xs">
                          {preview.keeping.join(", ")}
                        </span>{" "}
                        stay — they are defined here.
                      </p>
                    )}
                    {preview.losing.length > 0 && (
                      <p className="text-foreground">
                        <span className="font-mono text-xs text-destructive">
                          {preview.losing.join(", ")}
                        </span>{" "}
                        will no longer be inherited.
                      </p>
                    )}
                    {preview.gaining.length > 0 && (
                      <p className="text-foreground">
                        <span className="font-mono text-xs text-primary">
                          {preview.gaining.join(", ")}
                        </span>{" "}
                        will be inherited from the new parent.
                      </p>
                    )}
                    {preview.losing.length === 0 && preview.gaining.length === 0 && (
                      <p className="text-muted-foreground">
                        No inherited fields change.
                      </p>
                    )}

                    {preview.affectedItemCount > 0 && (
                      <p className="flex items-start gap-2 border-t border-border pt-2 text-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>
                          {preview.affectedItemCount} item
                          {preview.affectedItemCount === 1 ? "" : "s"} hold a value for a field
                          that is going away. Those values become orphaned data rather than being
                          deleted.
                        </span>
                      </p>
                    )}
                  </div>
                )}
              </>
            ) : null}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={pending || !touched || loading || unchanged || preview?.blocked}
          >
            {pending ? "Moving…" : "Move category"}
            {!pending && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

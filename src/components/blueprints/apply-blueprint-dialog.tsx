"use client";

// ── Apply a blueprint to a category ──────────────────────────
// Pick a target, see exactly what would be copied and what would be
// skipped (with the reason), then confirm. Skipping without a reason
// reads as a bug; "already inherited from Electronics" reads as the
// model working.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, SkipForward } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { previewBlueprintApply } from "@/app/(dashboard)/data-center/blueprints/actions";
import { applyBlueprint } from "@/app/(dashboard)/data-center/actions";
import { iconFor } from "@/components/data-center/category-icons";
import { cn } from "@/lib/utils";
import type { CategoryNode } from "@/lib/types";

interface Preview {
  categoryName: string;
  adding: { key: string; label: string; type: string }[];
  skipped: { key: string; reason: string }[];
}

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flatten(node.children, depth + 1),
  ]);
}

export function ApplyBlueprintDialog({
  open,
  onOpenChange,
  blueprintId,
  blueprintName,
  tree,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blueprintId: string;
  blueprintName: string;
  tree: CategoryNode[];
}) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setTarget(null);
      setPreview(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const result = await previewBlueprintApply(blueprintId, target);
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
  }, [open, target, blueprintId]);

  const confirm = () => {
    if (!target) return;
    startTransition(async () => {
      const result = await applyBlueprint(target, blueprintId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Copied ${result.data.added} field${result.data.added === 1 ? "" : "s"} into ${
          preview?.categoryName ?? "the category"
        }`
      );
      onOpenChange(false);
      router.refresh();
      router.push(`/data-center/${target}?tab=schema`);
    });
  };

  const rows = flatten(tree);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply “{blueprintName}”</DialogTitle>
          <DialogDescription>
            Its fields are copied onto the category you choose. Nothing stays linked afterwards.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <span className="text-sm font-medium text-foreground">Category</span>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {rows.map(({ node, depth }) => {
              const Icon = iconFor(node.icon);
              return (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => setTarget(node.id)}
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
                </button>
              );
            })}
          </div>
        </div>

        {target && (
          <div className="space-y-2">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking what would be copied…
              </p>
            ) : preview ? (
              <div className="space-y-2 rounded-md border border-border bg-card/50 p-3 text-sm">
                {preview.adding.length > 0 ? (
                  <div className="space-y-1">
                    <p className="flex items-center gap-1.5 text-foreground">
                      <Check className="h-3.5 w-3.5 text-primary" />
                      Copies {preview.adding.length} field
                      {preview.adding.length === 1 ? "" : "s"}
                    </p>
                    <div className="flex flex-wrap gap-1 pl-5">
                      {preview.adding.map((field) => (
                        <span
                          key={field.key}
                          className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
                        >
                          {field.key}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground">
                    Nothing to copy — every field is already in this category&apos;s chain.
                  </p>
                )}

                {preview.skipped.length > 0 && (
                  <div className="space-y-1 border-t border-border pt-2">
                    <p className="flex items-center gap-1.5 text-foreground">
                      <SkipForward className="h-3.5 w-3.5 text-warning" />
                      Skips {preview.skipped.length}
                    </p>
                    <ul className="space-y-0.5 pl-5">
                      {preview.skipped.map((field) => (
                        <li key={field.key} className="text-[11px] text-muted-foreground">
                          <code className="text-foreground">{field.key}</code> — {field.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={pending || !target || loading || !preview?.adding.length}
          >
            {pending ? "Applying…" : "Apply blueprint"}
            {!pending && <ArrowRight className="ml-1.5 h-3.5 w-3.5" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// ── Delete a category ────────────────────────────────────────
// `ON DELETE CASCADE` means deleting Electronics destroys every
// category beneath it and all of their items. Doing that behind a
// plain confirm() is the single most dangerous thing this app can do.
//
// So the destructive path is never the only path: when the category
// has a parent, its items can be RESCUED there first — reconciled
// against the parent's schema by move_items(), with anything that does
// not fit preserved as orphaned data rather than deleted. Both options
// run in one transaction inside delete_category_safely().
//
// The counts are stated before the input, the consequence of each
// choice is spelled out, and the name still has to be typed.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpFromLine, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  deleteCategory,
  previewCategoryDelete,
  type CategoryDeletePreview,
} from "@/app/(dashboard)/data-center/actions";
import { cn } from "@/lib/utils";

type Disposition = "move" | "cascade";

export function DeleteCategoryDialog({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  descendantCount,
  subtreeItemCount,
  redirectTo = "/data-center",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
  descendantCount: number;
  subtreeItemCount: number;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [preview, setPreview] = useState<CategoryDeletePreview | null>(null);
  const [loading, setLoading] = useState(false);
  // Default to rescuing the items. The destructive option is never
  // pre-selected when a non-destructive one exists.
  const [disposition, setDisposition] = useState<Disposition>("move");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;

    (async () => {
      if (!open) {
        setConfirmation("");
        setPreview(null);
        setDisposition("move");
        return;
      }

      setLoading(true);
      const result = await previewCategoryDelete(categoryId);
      if (!live) return;
      if (result.ok) {
        setPreview(result.data);
        setDisposition(result.data.can_move_to_parent ? "move" : "cascade");
      } else {
        toast.error(result.error);
      }
      setLoading(false);
    })();

    return () => {
      live = false;
    };
  }, [open, categoryId]);

  const cascades = descendantCount > 0 || subtreeItemCount > 0;
  const matches = confirmation.trim() === categoryName;
  const canRescue = Boolean(preview?.can_move_to_parent) && subtreeItemCount > 0;
  const moving = canRescue && disposition === "move";

  const confirm = () => {
    if (!matches) return;
    startTransition(async () => {
      const result = await deleteCategory(categoryId, { moveItemsToParent: moving });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { moved_items, orphaned_values, deleted_items } = result.data;
      const parts: string[] = [];
      if (moved_items) parts.push(`${moved_items} item${moved_items === 1 ? "" : "s"} moved to ${preview?.parent_name}`);
      if (orphaned_values) parts.push(`${orphaned_values} value${orphaned_values === 1 ? "" : "s"} kept as orphaned data`);
      if (deleted_items) parts.push(`${deleted_items} item${deleted_items === 1 ? "" : "s"} deleted`);

      toast.success(`Deleted “${categoryName}”`, {
        description: parts.length > 0 ? parts.join(" · ") : undefined,
      });
      onOpenChange(false);
      router.refresh();
      router.push(redirectTo);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete “{categoryName}”?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>

        {cascades ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1 text-foreground">
              <p>Deleting this category removes:</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {descendantCount > 0 && (
                  <li>
                    <strong className="text-foreground">
                      {descendantCount} descendant categor
                      {descendantCount === 1 ? "y" : "ies"}
                    </strong>
                  </li>
                )}
                {subtreeItemCount > 0 && (
                  <li>
                    <strong className="text-foreground">
                      {subtreeItemCount} item{subtreeItemCount === 1 ? "" : "s"}
                    </strong>{" "}
                    across that subtree
                  </li>
                )}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">It has no descendants and no items.</p>
        )}

        {loading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Working out what happens to the items…
          </p>
        )}

        {/* ── What happens to the items ──────────────────────── */}
        {canRescue && preview && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">
              What happens to the {subtreeItemCount} item{subtreeItemCount === 1 ? "" : "s"}?
            </span>

            <RadioGroup
              value={disposition}
              onValueChange={(value) => setDisposition(value as Disposition)}
              className="gap-1.5"
            >
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
                  disposition === "move" ? "border-primary/50 bg-accent/40" : "border-border"
                )}
              >
                <RadioGroupItem value="move" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm text-foreground">
                    <ArrowUpFromLine className="h-3.5 w-3.5" />
                    Move them to {preview.parent_name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {preview.carried_keys.length > 0 ? (
                      <>
                        {preview.carried_keys.length} field
                        {preview.carried_keys.length === 1 ? "" : "s"} exist in both schemas and
                        carry across untouched
                        {preview.orphaned_keys.length > 0 && (
                          <>
                            ; the other {preview.orphaned_keys.length} become orphaned data on the
                            moved items and can be restored
                          </>
                        )}
                        .
                      </>
                    ) : (
                      <>
                        The parent shares no fields with this category, so every value moves to
                        orphaned data. Nothing is deleted.
                      </>
                    )}
                  </span>
                </span>
              </label>

              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
                  disposition === "cascade"
                    ? "border-destructive/50 bg-destructive/5"
                    : "border-border"
                )}
              >
                <RadioGroupItem value="cascade" className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete them with the category
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    All {subtreeItemCount} item{subtreeItemCount === 1 ? "" : "s"} and every value
                    in them are destroyed permanently.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>
        )}

        {!canRescue && subtreeItemCount > 0 && !loading && (
          <p className="text-sm text-muted-foreground">
            This is a root category, so there is no parent to move its items to. They will be
            deleted with it.
          </p>
        )}

        <div className="space-y-1.5">
          <label htmlFor="delete-confirm" className="text-sm text-foreground">
            Type <strong className="font-mono">{categoryName}</strong> to confirm
          </label>
          <input
            id="delete-confirm"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && matches) confirm();
            }}
            autoComplete="off"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={pending || !matches || loading}
            className={cn(
              moving
                ? undefined
                : "bg-destructive text-white hover:bg-destructive/90"
            )}
          >
            {moving ? (
              <ArrowUpFromLine className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            )}
            {pending
              ? "Deleting…"
              : moving
                ? "Move items and delete"
                : "Delete permanently"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

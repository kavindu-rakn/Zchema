"use client";

// ── Delete a category ────────────────────────────────────────
// `ON DELETE CASCADE` means deleting Electronics silently destroys
// every category beneath it and all of their items. The counts are
// stated before the input, and the name must be typed — a single
// "Are you sure?" is not proportionate to losing 48 records.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteCategory } from "@/app/(dashboard)/data-center/actions";

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
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) setConfirmation("");
  }, [open]);

  const cascades = descendantCount > 0 || subtreeItemCount > 0;
  const matches = confirmation.trim() === categoryName;

  const confirm = () => {
    if (!matches) return;
    startTransition(async () => {
      const result = await deleteCategory(categoryId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted “${categoryName}”`);
      onOpenChange(false);
      router.refresh();
      router.push(redirectTo);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{categoryName}”?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>

        {cascades ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="space-y-1 text-foreground">
              <p>Deleting this also permanently deletes:</p>
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
          <p className="text-sm text-muted-foreground">
            It has no descendants and no items.
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
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            onClick={confirm}
            disabled={pending || !matches}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            {pending ? "Deleting…" : "Delete permanently"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

"use client";

// ── Danger zone: delete a category ───────────────────────────
// Deleting cascades to descendants AND their items, so the confirm
// step spells out exactly how much disappears rather than asking a
// generic "are you sure?".

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteCategory } from "@/app/(dashboard)/data-center/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function DeleteCategoryButton({
  categoryId,
  categoryName,
  descendantCount,
  subtreeItemCount,
}: {
  categoryId: string;
  categoryName: string;
  descendantCount: number;
  subtreeItemCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmDelete = () => {
    startTransition(async () => {
      const result = await deleteCategory(categoryId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted “${categoryName}”`);
      setOpen(false);
      router.refresh();
      router.push("/data-center");
    });
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete category
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{categoryName}”?</DialogTitle>
            <DialogDescription>This cannot be undone.</DialogDescription>
          </DialogHeader>

          {(descendantCount > 0 || subtreeItemCount > 0) && (
            <p className="text-sm text-destructive">
              This also permanently deletes{" "}
              {descendantCount > 0 && (
                <strong>
                  {descendantCount} descendant categor{descendantCount === 1 ? "y" : "ies"}
                </strong>
              )}
              {descendantCount > 0 && subtreeItemCount > 0 && " and "}
              {subtreeItemCount > 0 && (
                <strong>
                  {subtreeItemCount} item{subtreeItemCount === 1 ? "" : "s"}
                </strong>
              )}
              .
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

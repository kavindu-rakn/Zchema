"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApplyBlueprintDialog } from "@/components/blueprints/apply-blueprint-dialog";
import { deleteBlueprint } from "@/app/(dashboard)/data-center/blueprints/actions";
import type { CategoryNode } from "@/lib/types";

export function BlueprintActions({
  blueprintId,
  blueprintName,
  usedByCount,
  tree,
}: {
  blueprintId: string;
  blueprintName: string;
  usedByCount: number;
  tree: CategoryNode[];
}) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  const confirmDelete = () => {
    startTransition(async () => {
      const result = await deleteBlueprint(blueprintId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted “${blueprintName}”`);
      setDeleting(false);
      router.refresh();
      router.push("/data-center/blueprints");
    });
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setApplying(true)}>
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          Apply to a category
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setDeleting(true)}
          className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <ApplyBlueprintDialog
        open={applying}
        onOpenChange={setApplying}
        blueprintId={blueprintId}
        blueprintName={blueprintName}
        tree={tree}
      />

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{blueprintName}”?</DialogTitle>
            <DialogDescription>
              This removes the blueprint from the library.
            </DialogDescription>
          </DialogHeader>

          {/* Under the old template model this would have been blocked
              (ON DELETE RESTRICT). Saying so prevents the reasonable
              assumption that categories are about to lose their fields. */}
          <div className="rounded-md border border-border bg-card/50 p-3 text-sm text-muted-foreground">
            {usedByCount > 0 ? (
              <>
                <strong className="text-foreground">
                  {usedByCount} categor{usedByCount === 1 ? "y" : "ies"}
                </strong>{" "}
                started from this blueprint. They keep every field — applying a blueprint copies
                the fields, so nothing is linked. Only the note recording where they came from is
                cleared.
              </>
            ) : (
              <>No category has used this blueprint yet.</>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeleting(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete blueprint"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

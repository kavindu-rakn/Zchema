"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createBlueprint } from "@/app/(dashboard)/data-center/blueprints/actions";

export function NewBlueprintDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createBlueprint({
        name: trimmed,
        description: description.trim() || null,
        fields: [],
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created “${trimmed}”`);
      onOpenChange(false);
      router.refresh();
      router.push(`/data-center/blueprints/${result.data.id}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New blueprint</DialogTitle>
          <DialogDescription>
            A reusable set of fields. Applying it to a category copies the fields across — it
            does not link them.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="blueprint-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="blueprint-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submit();
              }}
              placeholder="Physical Goods"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="blueprint-description"
              className="text-sm font-medium text-foreground"
            >
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="blueprint-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="When would someone reach for this?"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? "Creating…" : "Create blueprint"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

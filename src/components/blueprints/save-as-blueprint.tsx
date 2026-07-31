"use client";

// ── Promote a category's own fields into a blueprint ─────────
// How a blueprint library actually gets built: by promoting something
// that already worked, not by authoring in the abstract.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { createBlueprintFromCategory } from "@/app/(dashboard)/data-center/blueprints/actions";
import type { SchemaField } from "@/lib/types";

export function SaveAsBlueprint({
  categoryId,
  categoryName,
  ownFields,
}: {
  categoryId: string;
  categoryName: string;
  ownFields: SchemaField[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (open) {
      setName(`${categoryName} fields`);
      setDescription("");
    }
  }, [open, categoryName]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const result = await createBlueprintFromCategory(categoryId, {
        name: trimmed,
        description: description.trim() || null,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Saved ${result.data.fieldCount} fields as “${trimmed}”`);
      setOpen(false);
      router.refresh();
      router.push(`/data-center/blueprints/${result.data.id}`);
    });
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        disabled={ownFields.length === 0}
        title={
          ownFields.length === 0
            ? "This category defines no fields of its own"
            : undefined
        }
      >
        <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" />
        Save as blueprint
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save as blueprint</DialogTitle>
            <DialogDescription>
              Captures the {ownFields.length} field
              {ownFields.length === 1 ? "" : "s"} this category defines itself. Inherited fields
              are not included — they belong to the categories that define them.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1">
            {ownFields.map((field) => (
              <span
                key={field.key}
                className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
              >
                {field.key}
              </span>
            ))}
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="bp-name" className="text-sm font-medium text-foreground">
                Name
              </label>
              <input
                id="bp-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") submit();
                }}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="bp-desc" className="text-sm font-medium text-foreground">
                Description <span className="text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="bp-desc"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !name.trim()}>
              {pending ? "Saving…" : "Save blueprint"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

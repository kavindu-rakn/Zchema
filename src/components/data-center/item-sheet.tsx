"use client";

// ── Item detail / create ─────────────────────────────────────
// Wraps the shared DynamicForm so the row sheet, the Schema tab
// preview and (Phase 4 Increment 3) the inline editor all render the
// same inputs from the same effective schema.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DynamicForm } from "@/components/data-center/dynamic-form";
import {
  createItem,
  deleteItem,
  updateItem,
} from "@/app/(dashboard)/data-center/item-actions";
import type { ItemRow } from "@/lib/data/items";
import type { EffectiveField } from "@/lib/types";

export function ItemSheet({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  schema,
  item,
  canEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
  schema: EffectiveField[];
  item: ItemRow | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(item);

  const submit = (data: Record<string, unknown>) => {
    startTransition(async () => {
      const result = isEdit
        ? await updateItem(item!.id, item!.category_id, data)
        : await createItem(categoryId, data);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(isEdit ? "Item saved" : "Item created");
      onOpenChange(false);
      router.refresh();
    });
  };

  const remove = () => {
    if (!item) return;
    startTransition(async () => {
      const result = await deleteItem(item.id, item.category_id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Item deleted");
      onOpenChange(false);
      router.refresh();
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="text-base">
            {isEdit ? "Edit item" : `New item in ${categoryName}`}
          </SheetTitle>
          <SheetDescription>
            {schema.length} field{schema.length === 1 ? "" : "s"}, grouped by where they come
            from.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-6 py-5">
          <DynamicForm
            key={item?.id ?? "new"}
            schema={schema}
            initialData={item?.data ?? {}}
            itemId={item?.id ?? null}
            categoryId={categoryId}
            grouped
            disabled={!canEdit}
            pending={pending}
            submitLabel={isEdit ? "Save changes" : "Create item"}
            onSubmit={canEdit ? submit : undefined}
            onCancel={() => onOpenChange(false)}
          />
        </div>

        {isEdit && canEdit && (
          <div className="flex shrink-0 justify-between gap-2 border-t border-border px-6 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={pending}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete item
            </Button>
            <span className="text-[11px] text-muted-foreground">
              Updated {new Date(item!.updated_at).toLocaleString()}
            </span>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

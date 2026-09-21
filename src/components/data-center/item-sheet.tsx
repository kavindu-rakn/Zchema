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
import { DynamicForm, clearDraft } from "@/components/data-center/dynamic-form";
import {
  createItem,
  deleteItem,
  discardOrphanedValue,
  restoreOrphanedValue,
  updateItem,
} from "@/app/(dashboard)/data-center/[categoryId]/items/actions";
import { toastTrashed } from "@/components/trash/trashed-toast";
import { itemTitle } from "@/lib/items";
import type { ItemRow } from "@/lib/data/items";
import type { EffectiveField } from "@/lib/types";

/**
 * Who added the item and who last changed it. The database stamps both
 * from the session, so they are facts, not claims. Items older than the
 * authorship columns have no author, and say only when.
 */
function ItemAuthorship({ item }: { item: ItemRow }) {
  const when = (at: string) => new Date(at).toLocaleString();
  const edited = item.updated_at !== item.created_at;

  return (
    <p className="text-right text-[11px] leading-snug text-muted-foreground">
      {edited && (
        <>
          Edited {when(item.updated_at)}
          {item.updated_by_email && <> by {item.updated_by_email}</>}
          <br />
        </>
      )}
      Added {when(item.created_at)}
      {item.created_by_email && <> by {item.created_by_email}</>}
    </p>
  );
}

export function ItemSheet({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  schema,
  item,
  canEdit,
  canManageSchema = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
  schema: EffectiveField[];
  item: ItemRow | null;
  canEdit: boolean;
  /** Restoring an orphan recreates a FIELD, so it needs SCHEMA_ADMIN. */
  canManageSchema?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const isEdit = Boolean(item);

  /**
   * Resolves once the save has answered — true if it landed. The form
   * keeps its draft until then, so a failed save loses nothing even if
   * the sheet is closed afterwards.
   */
  const save = (
    data: Record<string, unknown>,
    expectedUpdatedAt: string | null
  ): Promise<boolean> =>
    new Promise((resolve) => {
      startTransition(async () => {
        const result = isEdit
          ? await updateItem(item!.id, item!.category_id, data, expectedUpdatedAt)
          : await createItem(categoryId, data);

        if (!result.ok) {
          if (result.code === "conflict") showConflict(result.error, data);
          else toast.error(result.error);
          resolve(false);
          return;
        }
        toast.success(isEdit ? "Item saved" : "Item created");
        onOpenChange(false);
        router.refresh();
        resolve(true);
      });
    });

  const submit = (data: Record<string, unknown>) => save(data, item?.updated_at ?? null);

  // Someone else saved this item first. Both ways out are explicit:
  // take their version (and drop these edits), or overwrite it.
  const showConflict = (message: string, data: Record<string, unknown>) => {
    toast.error(message, {
      description: "Your edits are still in the form.",
      duration: Infinity,
      action: {
        label: "Save mine anyway",
        onClick: () => void save(data, null),
      },
      cancel: {
        label: "Show theirs",
        onClick: () => {
          clearDraft(categoryId, item?.id ?? null);
          router.refresh();
        },
      },
    });
  };

  const restoreOrphan = (key: string) => {
    if (!item) return;
    startTransition(async () => {
      const result = await restoreOrphanedValue(item.id, item.category_id, key);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Restored “${key}” as a field on this category`);
      router.refresh();
    });
  };

  const discardOrphan = (key: string) => {
    if (!item) return;
    startTransition(async () => {
      const result = await discardOrphanedValue(item.id, item.category_id, key);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Discarded “${key}”`);
      router.refresh();
    });
  };

  // No confirmation: nothing is destroyed, and Undo is one click away.
  const remove = () => {
    if (!item) return;
    const title = itemTitle(item.data);
    startTransition(async () => {
      const result = await deleteItem(item.id, item.category_id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toastTrashed(
        title ? `Moved “${title}” to the trash` : "Moved the item to the trash",
        result.data.trashBatch,
        () => router.refresh()
      );
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
            canRestoreOrphans={canManageSchema && Boolean(item)}
            onRestoreOrphan={restoreOrphan}
            onDiscardOrphan={discardOrphan}
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
              Move to trash
            </Button>
            <ItemAuthorship item={item!} />
          </div>
        )}
        {isEdit && !canEdit && (
          <div className="flex shrink-0 justify-end border-t border-border px-6 py-3">
            <ItemAuthorship item={item!} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

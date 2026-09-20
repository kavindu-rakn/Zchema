"use client";

// ── Bulk actions ─────────────────────────────────────────────
// Delete, set one field across many items, or move to another
// category. The move is the interesting one: it reports carried /
// orphaned / missing counts BEFORE executing, because moving between
// categories means the data meets a different schema.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FolderInput, Loader2, PencilLine, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DynamicForm } from "@/components/data-center/dynamic-form";
import { iconFor } from "@/components/data-center/category-icons";
import { toastTrashed } from "@/components/trash/trashed-toast";
import {
  deleteItems,
  moveItems,
  previewItemMove,
  setFieldValue,
} from "@/app/(dashboard)/data-center/[categoryId]/items/actions";
import { cn } from "@/lib/utils";
import type { CategoryNode, EffectiveField } from "@/lib/types";

interface MovePreview {
  targetName: string;
  carried: string[];
  orphaned: string[];
  missingRequired: string[];
  itemCount: number;
}

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

// Deleting used to demand the count be typed out above twenty rows,
// because it was permanent. It no longer is — deleted items go to the
// trash and Undo is one click — so one confirmation is proportionate.

export function BulkActionsBar({
  selected,
  updatedAt,
  categoryId,
  schema,
  tree,
  onClear,
}: {
  selected: string[];
  /**
   * Each selected item's `updated_at` as this page rendered it. Sent
   * with a bulk edit so an item someone has changed since is skipped
   * rather than overwritten — the same token a single item save uses.
   */
  updatedAt: Record<string, string>;
  categoryId: string;
  schema: EffectiveField[];
  tree: CategoryNode[];
  onClear: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"delete" | "edit" | "move" | null>(null);
  const [fieldKey, setFieldKey] = useState<string>("");
  const [target, setTarget] = useState<string | null>(null);

  // Leaving "move" forgets the destination, so reopening starts fresh.
  const [lastMode, setLastMode] = useState(mode);
  if (mode !== lastMode) {
    setLastMode(mode);
    if (mode !== "move") setTarget(null);
  }

  // Each preview is stored with the request it answers. Loading is then
  // "no answer for the current request yet", and a stale answer — for a
  // previous destination, or after leaving move mode — is simply ignored,
  // so nothing has to be reset or flagged synchronously in the effect.
  const previewRequest =
    mode === "move" && target ? `${target}|${selected.join(",")}` : null;
  const [previewResult, setPreviewResult] = useState<{
    request: string;
    preview: MovePreview | null;
  } | null>(null);
  const preview =
    previewResult && previewResult.request === previewRequest ? previewResult.preview : null;
  const loadingPreview = previewRequest !== null && previewResult?.request !== previewRequest;

  useEffect(() => {
    if (!previewRequest || !target) return;
    let cancelled = false;

    (async () => {
      const result = await previewItemMove(selected, target);
      if (cancelled) return;
      if (!result.ok) toast.error(result.error);
      setPreviewResult({ request: previewRequest, preview: result.ok ? result.data : null });
    })();

    return () => {
      cancelled = true;
    };
  }, [previewRequest, selected, target]);

  const close = () => setMode(null);

  const runDelete = () =>
    startTransition(async () => {
      const result = await deleteItems(selected, categoryId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { deleted, trashBatch } = result.data;
      toastTrashed(
        `Moved ${deleted} item${deleted === 1 ? "" : "s"} to the trash`,
        trashBatch,
        () => router.refresh()
      );
      close();
      onClear();
      router.refresh();
    });

  /**
   * Apply the value to the items the caller has been warned about,
   * this time without the check. Reached only from the toast below,
   * so overwriting someone else's edit is always a second decision.
   */
  const forceSetValue = (ids: string[], key: string, value: unknown) =>
    startTransition(async () => {
      const result = await setFieldValue(
        ids.map((id) => ({ id, updatedAt: null })),
        categoryId,
        key,
        value,
        true
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.data.updated > 0
          ? `Updated ${result.data.updated} more`
          : "Nothing left to update — those items are gone."
      );
      router.refresh();
    });

  const runSetValue = (data: Record<string, unknown>) =>
    startTransition(async () => {
      // Read once: the dialog may be closed and reopened on another
      // field before the toast action below is clicked.
      const key = fieldKey;
      const value = data[key];
      const result = await setFieldValue(
        selected.map((id) => ({ id, updatedAt: updatedAt[id] ?? null })),
        categoryId,
        key,
        value
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { updated, conflicted } = result.data;
      if (conflicted.length === 0) {
        toast.success(`Updated ${updated} item${updated === 1 ? "" : "s"}`);
      } else {
        // Never a silent last-writer-wins: say how many were left
        // alone, and make overwriting them a separate click.
        toast.warning(`Updated ${updated} of ${selected.length}`, {
          description: `${conflicted.length} ${
            conflicted.length === 1 ? "item was" : "items were"
          } changed or deleted since you selected ${
            conflicted.length === 1 ? "it" : "them"
          }, so ${conflicted.length === 1 ? "it was" : "they were"} left as ${
            conflicted.length === 1 ? "it is" : "they are"
          }.`,
          duration: Infinity,
          action: {
            label: "Apply to those too",
            onClick: () => forceSetValue(conflicted, key, value),
          },
        });
      }

      close();
      onClear();
      router.refresh();
    });

  const runMove = () => {
    if (!target) return;
    startTransition(async () => {
      const result = await moveItems(selected, target, categoryId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Moved ${result.data.moved} item${result.data.moved === 1 ? "" : "s"}` +
          (result.data.orphaned > 0 ? ` · ${result.data.orphaned} values orphaned` : "")
      );
      close();
      onClear();
      router.refresh();
    });
  };

  const chosenField = schema.find((field) => field.key === fieldKey);
  const rows = flatten(tree);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
        <span className="text-sm text-foreground">
          {selected.length} selected
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setMode("edit")}>
            <PencilLine className="mr-1.5 h-3.5 w-3.5" />
            Set a field
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMode("move")}>
            <FolderInput className="mr-1.5 h-3.5 w-3.5" />
            Move
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("delete")}
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Delete */}
      <Dialog open={mode === "delete"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Move {selected.length} item{selected.length === 1 ? "" : "s"} to the trash?
            </DialogTitle>
            <DialogDescription>
              They leave this category now, and can be restored from the Trash with every
              value as it was.
            </DialogDescription>
          </DialogHeader>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={runDelete}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? "Moving…" : "Move to trash"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set a field */}
      <Dialog open={mode === "edit"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set one field on {selected.length} items</DialogTitle>
            <DialogDescription>
              The value is applied to every selected item, replacing whatever is there.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <label htmlFor="bulk-field" className="text-sm font-medium text-foreground">
              Field
            </label>
            <select
              id="bulk-field"
              value={fieldKey}
              onChange={(event) => setFieldKey(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Choose a field…</option>
              {schema.map((field) => (
                <option key={field.key} value={field.key}>
                  {field.label}
                  {field.inherited ? ` (from ${field.source_category_name})` : ""}
                </option>
              ))}
            </select>
          </div>

          {chosenField && (
            <div className="rounded-md border border-border p-3">
              <DynamicForm
                key={chosenField.key}
                schema={[chosenField]}
                initialData={{}}
                onSubmit={runSetValue}
                onCancel={close}
                submitLabel={`Apply to ${selected.length}`}
                pending={pending}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Move */}
      <Dialog open={mode === "move"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Move {selected.length} item{selected.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>
              These items were filled in against this category&apos;s schema. Moving them means
              their data meets a different one.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {rows.map(({ node, depth }) => {
              const Icon = iconFor(node.icon);
              return (
                <button
                  key={node.id}
                  type="button"
                  disabled={node.id === categoryId}
                  onClick={() => setTarget(node.id)}
                  style={{ paddingLeft: `${12 + depth * 16}px` }}
                  className={cn(
                    "flex w-full items-center gap-2 py-2 pr-3 text-left text-sm transition-colors hover:bg-accent disabled:opacity-40",
                    target === node.id && "bg-accent"
                  )}
                >
                  <Icon
                    className="h-3.5 w-3.5 shrink-0"
                    style={node.color ? { color: node.color } : undefined}
                  />
                  <span className="truncate">{node.name}</span>
                  {node.id === categoryId && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">current</span>
                  )}
                </button>
              );
            })}
          </div>

          {target && (
            <div className="space-y-2 rounded-md border border-border bg-card/50 p-3 text-sm">
              {loadingPreview ? (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Working out what carries across…
                </p>
              ) : preview ? (
                <>
                  <p className="text-foreground">
                    <strong>{preview.carried.length}</strong> field
                    {preview.carried.length === 1 ? "" : "s"} carry across.
                  </p>
                  {preview.orphaned.length > 0 && (
                    <p className="text-warning">
                      <strong>{preview.orphaned.length}</strong> field
                      {preview.orphaned.length === 1 ? "" : "s"} don&apos;t exist in{" "}
                      {preview.targetName} — those values move to orphaned data rather than being
                      deleted:{" "}
                      <span className="font-mono text-[11px]">
                        {preview.orphaned.join(", ")}
                      </span>
                    </p>
                  )}
                  {preview.missingRequired.length > 0 && (
                    <p className="flex items-start gap-1.5 text-destructive">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        {preview.targetName} requires{" "}
                        <span className="font-mono text-[11px]">
                          {preview.missingRequired.join(", ")}
                        </span>
                        , which these items have no value for. They will land incomplete.
                      </span>
                    </p>
                  )}
                  {preview.orphaned.length === 0 && preview.missingRequired.length === 0 && (
                    <p className="text-muted-foreground">Nothing is lost in this move.</p>
                  )}
                </>
              ) : null}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={runMove} disabled={pending || !target || loadingPreview}>
              {pending ? "Moving…" : "Move items"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

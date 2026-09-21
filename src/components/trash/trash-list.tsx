"use client";

// ── The trash, entry by entry ────────────────────────────────
// Restore is the obvious action and is offered to anyone who may take
// it. "Delete forever" is admin-only, sits in the quieter button, and
// asks once more — it is the one delete in Zchema that cannot be undone.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileText, FolderTree, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { purgeTrash, restoreTrash } from "@/app/(dashboard)/data-center/trash/actions";
import { describeTrashEntry } from "@/lib/trash";
import { timeAgo } from "@/lib/time";
import type { TrashEntry } from "@/lib/types";

export function TrashList({ entries, isAdmin }: { entries: TrashEntry[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyBatch, setBusyBatch] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashEntry | null>(null);

  if (entries.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        The trash is empty.
      </p>
    );
  }

  const restore = (entry: TrashEntry) => {
    setBusyBatch(entry.batch);
    startTransition(async () => {
      const result = await restoreTrash(entry.batch);
      setBusyBatch(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { categories, items, orphaned_values } = result.data;
      const restored = [
        categories > 0 ? `${categories} categor${categories === 1 ? "y" : "ies"}` : null,
        items > 0 ? `${items} item${items === 1 ? "" : "s"}` : null,
      ].filter(Boolean);
      toast.success(`Restored ${restored.join(" and ") || "the entry"}`, {
        description: orphaned_values
          ? `${orphaned_values} value${orphaned_values === 1 ? "" : "s"} whose field has since been removed came back as orphaned data.`
          : undefined,
      });
      router.refresh();
    });
  };

  const purge = (entry: TrashEntry) => {
    setBusyBatch(entry.batch);
    startTransition(async () => {
      const result = await purgeTrash(entry.batch, true);
      setBusyBatch(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setPurging(null);
      toast.success("Deleted for good");
      router.refresh();
    });
  };

  const purgingText = purging ? describeTrashEntry(purging) : null;

  return (
    <>
      <ul className="space-y-2">
        {entries.map((entry) => {
          const { kind, title, detail, needsAdmin } = describeTrashEntry(entry);
          const busy = pending && busyBatch === entry.batch;
          const allowed = !needsAdmin || isAdmin;
          const Icon = kind === "category" ? FolderTree : FileText;

          return (
            <li
              key={entry.batch}
              className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-card/40 p-4"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{title}</span>
                </p>
                {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
                <p className="text-xs text-muted-foreground">
                  Deleted{" "}
                  <time dateTime={entry.deleted_at} suppressHydrationWarning>
                    {timeAgo(entry.deleted_at)}
                  </time>
                  {entry.deleted_by && <> by {entry.deleted_by}</>}
                </p>
                {entry.blocked_by && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {entry.blocked_by}
                  </p>
                )}
                {!entry.blocked_by && !allowed && (
                  <p className="text-xs text-muted-foreground">
                    Restoring a category is a schema change — a schema admin can restore it.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => restore(entry)}
                  disabled={pending || !allowed || Boolean(entry.blocked_by)}
                >
                  {busy ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Restore
                </Button>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPurging(entry)}
                    disabled={pending}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    Delete forever
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <Dialog open={purging !== null} onOpenChange={(open) => !open && setPurging(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {purgingText?.title} forever?</DialogTitle>
            <DialogDescription>
              {purgingText?.detail ? `${purgingText.title}, ${purgingText.detail}, ` : `${purgingText?.title} `}
              will be destroyed. This is the one delete in Zchema that cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPurging(null)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={() => purging && purge(purging)}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              {pending ? "Deleting…" : "Delete forever"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

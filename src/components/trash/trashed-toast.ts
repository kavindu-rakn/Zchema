"use client";

// ── "Moved to the trash" — with Undo ─────────────────────────
// Every delete in the app lands in the trash, so every delete says so
// and offers to take it back on the spot. Undo restores exactly the
// entry that deletion made, nothing older.

import { toast } from "sonner";

import { restoreTrash } from "@/app/(dashboard)/data-center/trash/actions";

export function toastTrashed(
  message: string,
  batch: string | null,
  /** Refresh whatever the caller shows once the restore lands. */
  onRestored: () => void
) {
  toast.success(message, {
    description: "Restore it any time from the Trash.",
    duration: 10_000,
    action: batch
      ? {
          label: "Undo",
          onClick: async () => {
            const result = await restoreTrash(batch);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            toast.success("Restored");
            onRestored();
          },
        }
      : undefined,
  });
}

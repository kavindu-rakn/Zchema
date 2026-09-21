import { Trash2 } from "lucide-react";

import { getCurrentRole } from "@/lib/auth";
import { listTrash } from "@/lib/data/trash";
import { TrashList } from "@/components/trash/trash-list";

export const dynamic = "force-dynamic";

// Everything anyone deleted, one entry per deletion. The framing is the
// point: deleting in Zchema is moving to the trash, and the trash is
// where the product's "nothing silently lost" promise is kept.

export default async function TrashPage() {
  const role = await getCurrentRole();
  const canUseTrash = role === "SCHEMA_ADMIN" || role === "DATA_EDITOR";

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <Trash2 className="h-5 w-5" />
          <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
            Trash
          </h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Every deleted item and category lands here, with its history. Restoring puts it back
          where it was; a value whose field has since been removed comes back as orphaned data
          rather than being dropped. Nothing leaves the trash unless a schema admin empties it.
        </p>
      </div>

      <div className="mt-6">
        {canUseTrash ? (
          <TrashList entries={await listTrash()} isAdmin={role === "SCHEMA_ADMIN"} />
        ) : (
          <p className="rounded-md border border-border bg-card/40 p-4 text-sm text-muted-foreground">
            The trash is open to data editors and schema admins.
          </p>
        )}
      </div>
    </div>
  );
}

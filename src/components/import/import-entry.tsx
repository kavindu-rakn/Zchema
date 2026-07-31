"use client";

// ── Import entry point ───────────────────────────────────────
// A thin trigger, so the wizard's own state resets cleanly each time
// it is opened and the rail does not carry it.

import { useState } from "react";
import { FileUp } from "lucide-react";

import { ImportWizard } from "@/components/import/import-wizard";
import type { CategoryNode } from "@/lib/types";

export function ImportEntry({
  tree,
  categoryId = null,
  label = "Import data",
}: {
  tree: CategoryNode[];
  /** Pre-selects an existing category as the destination. */
  categoryId?: string | null;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FileUp className="h-3.5 w-3.5" />
        {label}
      </button>

      <ImportWizard
        open={open}
        onOpenChange={setOpen}
        tree={tree}
        initialCategoryId={categoryId}
      />
    </>
  );
}

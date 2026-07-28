"use client";

// ── Create a root category from the rail footer ──────────────
// Opens the same sheet used everywhere else, so root creation and
// child creation are one flow with one set of rules.

import { useState } from "react";
import { Plus } from "lucide-react";

import { CategorySheet } from "@/components/data-center/category-sheet";

export function NewRootCategory() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-3.5 w-3.5" />
        New root category
      </button>

      <CategorySheet open={open} onOpenChange={setOpen} parentId={null} />
    </>
  );
}

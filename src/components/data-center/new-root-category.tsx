"use client";

// ── Create a root category from the rail footer ──────────────
// Minimal on purpose: Phase 3 rebuilds creation properly (blueprints,
// icons, position). This exists so the pinned action is real rather
// than a dead button.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { createCategory } from "@/app/(dashboard)/data-center/actions";

export function NewRootCategory() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    startTransition(async () => {
      // The action re-checks SCHEMA_ADMIN server-side; a VIEWER gets a
      // readable message here rather than a silent no-op.
      const result = await createCategory({ name: trimmed });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created “${trimmed}”`);
      setName("");
      setOpen(false);
      router.refresh();
      router.push(`/data-center/${result.data.id}`);
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="h-3.5 w-3.5" />
        New root category
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <input
        autoFocus
        value={name}
        disabled={pending}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") {
            setOpen(false);
            setName("");
          }
        }}
        placeholder="Category name"
        aria-label="New root category name"
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="flex-1 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {pending ? "Creating…" : "Create"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setName("");
          }}
          disabled={pending}
          className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

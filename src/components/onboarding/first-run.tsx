"use client";

// ── First run ────────────────────────────────────────────────
// Shown when the catalog is empty. Not a tour with coach-marks — a
// decision.
//
// Three paths, because there are genuinely three kinds of person
// arriving: one has data and wants it in, one wants to see whether this
// is worth their time, and one already knows what they are building.
// A tour serves none of them; it delays all three.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2, PencilRuler, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { CategorySheet } from "@/components/data-center/category-sheet";
import { ImportWizard } from "@/components/import/import-wizard";
import { loadSampleCatalog, type SampleDataset } from "@/app/(dashboard)/onboarding/actions";
import { cn } from "@/lib/utils";

export function FirstRun({ canEdit }: { canEdit: boolean }) {
  const router = useRouter();
  const [importing, setImporting] = useState(false);
  const [building, setBuilding] = useState(false);
  const [loading, setLoading] = useState<SampleDataset | null>(null);
  const [, startTransition] = useTransition();

  const loadSample = (dataset: SampleDataset) => {
    setLoading(dataset);
    startTransition(async () => {
      const result = await loadSampleCatalog(dataset);
      setLoading(null);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      // Land on the one screen where inheritance is self-evident:
      // three levels deep, with an override. That screen IS the
      // tutorial.
      router.push(`/data-center/${result.data.category_id}?tab=schema`);
      router.refresh();
    });
  };

  if (!canEdit) {
    return (
      <div className="mx-auto flex min-h-full max-w-lg flex-col justify-center px-6 py-12 text-center">
        <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
          Nothing here yet
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This catalog has no categories. Someone with the Schema Admin role needs to create the
          first one — you will see it here as soon as they do.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-12">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
          Nothing here yet
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">
          SchemaShift models a catalog as a tree of categories, each adding fields to what it
          inherits. Three ways to start:
        </p>
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        <Card
          icon={<FileUp className="h-5 w-5" />}
          title="Import"
          body="Paste a CSV or drop a file. The field types, units and options are worked out for you."
          action="Choose a file"
          onClick={() => setImporting(true)}
        />

        <Card
          icon={<Sparkles className="h-5 w-5" />}
          title="Sample"
          body="Load a ready catalog and poke at it. Fastest way to see what inheritance actually does."
          action={loading === "catalog" ? "Loading…" : "Load a catalog"}
          busy={loading === "catalog"}
          onClick={() => loadSample("catalog")}
          secondary={{
            label: loading === "vehicles" ? "Loading…" : "or vehicles",
            onClick: () => loadSample("vehicles"),
            busy: loading === "vehicles",
          }}
          highlighted
        />

        <Card
          icon={<PencilRuler className="h-5 w-5" />}
          title="Build"
          body="Start from an empty tree and define the first category yourself."
          action="New category"
          onClick={() => setBuilding(true)}
        />
      </div>

      <ImportWizard open={importing} onOpenChange={setImporting} tree={[]} />
      <CategorySheet open={building} onOpenChange={setBuilding} parentId={null} />
    </div>
  );
}

function Card({
  icon,
  title,
  body,
  action,
  onClick,
  busy,
  secondary,
  highlighted,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action: string;
  onClick: () => void;
  busy?: boolean;
  secondary?: { label: string; onClick: () => void; busy?: boolean };
  highlighted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border bg-card p-4",
        highlighted ? "border-primary/40" : "border-border"
      )}
    >
      <span className={cn("mb-2", highlighted ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      <h2 className="text-sm font-medium text-foreground">{title}</h2>
      <p className="mt-1 flex-1 text-xs text-muted-foreground">{body}</p>

      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={cn(
          "mt-3 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          highlighted
            ? "bg-primary text-primary-foreground hover:bg-primary/90"
            : "border border-border text-foreground hover:bg-accent",
          busy && "opacity-70"
        )}
      >
        {busy && <Loader2 className="h-3 w-3 animate-spin" />}
        {action}
      </button>

      {secondary && (
        <button
          type="button"
          onClick={secondary.onClick}
          disabled={secondary.busy}
          className="mt-1.5 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {secondary.label}
        </button>
      )}
    </div>
  );
}

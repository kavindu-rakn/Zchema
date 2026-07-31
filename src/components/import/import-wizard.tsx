"use client";

// ── Import wizard ────────────────────────────────────────────
// Source → Review → Destination → Import. A persistent Back button at
// every step, because the review step is where people realise they
// picked the wrong file.
//
// Parsing and inference run HERE, in the browser. They are pure
// functions over text the user already has, and a round trip just to
// count columns would make step 1 feel broken. Only the final write
// goes to the server.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileUp,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SourceStep } from "@/components/import/source-step";
import { ReviewStep } from "@/components/import/review-step";
import { DestinationStep } from "@/components/import/destination-step";
import { PreviewStep } from "@/components/import/preview-step";
import { getTargetSchema, runImport } from "@/app/(dashboard)/data-center/import/actions";
import { inferSchema } from "@/lib/inference";
import { buildRows, fieldsToCreate, matchToExisting, toSchemaField } from "@/lib/import";
import type { ColumnPlan } from "@/lib/import";
import type { ParsedTable } from "@/lib/csv";
import type { CategoryNode, EffectiveField } from "@/lib/types";
import { cn } from "@/lib/utils";

const STEPS = ["Source", "Review", "Destination", "Import"] as const;

export interface Destination {
  mode: "new-root" | "new-child" | "existing";
  parentId: string | null;
  categoryId: string | null;
  name: string;
}

export function ImportWizard({
  open,
  onOpenChange,
  tree,
  /** Pre-selected destination, when opened from a category. */
  initialCategoryId = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: CategoryNode[];
  initialCategoryId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, setPending] = useState(false);

  const [table, setTable] = useState<ParsedTable | null>(null);
  const [sourceName, setSourceName] = useState("");
  const [plans, setPlans] = useState<ColumnPlan[]>([]);

  const [destination, setDestination] = useState<Destination>({
    mode: initialCategoryId ? "existing" : "new-root",
    parentId: null,
    categoryId: initialCategoryId,
    name: "",
  });
  const [targetSchema, setTargetSchema] = useState<EffectiveField[]>([]);

  const inference = useMemo(
    () => (table ? inferSchema(table.rows, { sourceName, warnings: table.warnings }) : null),
    [table, sourceName]
  );

  const reset = () => {
    setStep(0);
    setTable(null);
    setSourceName("");
    setPlans([]);
    setTargetSchema([]);
    setDestination({
      mode: initialCategoryId ? "existing" : "new-root",
      parentId: null,
      categoryId: initialCategoryId,
      name: "",
    });
  };

  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  /** Step 1 → 2: seed one plan per inferred column. */
  const acceptSource = (parsed: ParsedTable, name: string) => {
    setTable(parsed);
    setSourceName(name);

    const result = inferSchema(parsed.rows, { sourceName: name, warnings: parsed.warnings });
    setPlans(
      result.fields.map((field, index) => ({
        header: parsed.headers[index] ?? field.key,
        // A column that is almost entirely empty is skipped by default.
        // It is nearly always a spreadsheet artefact, and un-skipping is
        // one click while noticing the junk column later is not.
        skip: parsed.rows.length > 0 && field.null_count / parsed.rows.length > 0.95,
        field: toSchemaField(field),
        dateOrder: field.type === "date" ? "dmy" : undefined,
      }))
    );
    setDestination((previous) => ({
      ...previous,
      name: previous.name || result.suggested_name,
    }));
    setStep(1);
  };

  /** Step 3: load the target's schema so columns can be matched onto it. */
  const chooseDestination = async (next: Destination) => {
    setDestination(next);

    const target = next.mode === "existing" ? next.categoryId : next.parentId;
    if (!target) {
      setTargetSchema([]);
      setPlans((previous) => previous.map((plan) => ({ ...plan, mappedTo: null })));
      return;
    }

    setPending(true);
    const result = await getTargetSchema(target);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setTargetSchema(result.data);

    // Propose matches. This proposes; the mapping table lets the user
    // correct every row before anything is written.
    const matches = matchToExisting(
      plans.filter((plan) => !plan.skip).map((plan) => ({ header: plan.header, field: plan.field })),
      result.data
    );

    setPlans((previous) =>
      previous.map((plan) => {
        const match = matches.get(plan.header);
        if (!match) return { ...plan, mappedTo: null };
        return {
          ...plan,
          mappedTo: match.inherited ? "inherited" : "own",
          // Adopt the existing field's identity — the whole point is to
          // write INTO it rather than beside it.
          field: { ...plan.field, key: match.key, type: match.type, label: match.label },
        };
      })
    );
  };

  const rows = useMemo(
    () => (table ? buildRows(table.rows, plans) : []),
    [table, plans]
  );

  const runIt = async () => {
    if (!table) return;
    setPending(true);

    const result = await runImport({
      categoryId: destination.mode === "existing" ? destination.categoryId : null,
      newCategory:
        destination.mode === "existing"
          ? undefined
          : {
              name: destination.name.trim(),
              parent_id: destination.mode === "new-child" ? destination.parentId : null,
            },
      ownFields: fieldsToCreate(plans),
      rows,
    });

    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    const { items_inserted, fields_added, error_count, category_id } = result.data;
    toast.success(`Imported ${items_inserted} item${items_inserted === 1 ? "" : "s"}`, {
      description: [
        fields_added > 0 ? `${fields_added} new field${fields_added === 1 ? "" : "s"}` : null,
        error_count > 0 ? `${error_count} cell${error_count === 1 ? "" : "s"} could not be read` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });

    close(false);
    router.push(`/data-center/${category_id}?tab=items`);
    router.refresh();
  };

  const active = plans.filter((plan) => !plan.skip);
  const destinationReady =
    destination.mode === "existing"
      ? Boolean(destination.categoryId)
      : destination.name.trim().length > 0 &&
        (destination.mode === "new-root" || Boolean(destination.parentId));

  const canAdvance =
    step === 0
      ? Boolean(table && table.rows.length > 0)
      : step === 1
        ? active.length > 0
        : step === 2
          ? destinationReady
          : true;

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="flex items-center gap-2">
            <FileUp className="h-4 w-4" />
            Import data
          </SheetTitle>

          {/* Step rail — always visible, so "where am I and how much is
              left" never needs asking. */}
          <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
            {STEPS.map((name, index) => (
              <li key={name} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                    index < step
                      ? "bg-primary text-primary-foreground"
                      : index === step
                        ? "border border-primary text-primary"
                        : "border border-border text-muted-foreground"
                  )}
                >
                  {index < step ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className={index === step ? "text-foreground" : "text-muted-foreground"}>
                  {name}
                </span>
                {index < STEPS.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground/40" aria-hidden />
                )}
              </li>
            ))}
          </ol>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {step === 0 && <SourceStep onParsed={acceptSource} />}

          {step === 1 && inference && table && (
            <ReviewStep
              inference={inference}
              plans={plans}
              onChange={setPlans}
              rowCount={table.rows.length}
            />
          )}

          {step === 2 && (
            <DestinationStep
              tree={tree}
              destination={destination}
              onChange={chooseDestination}
              plans={plans}
              targetSchema={targetSchema}
              onPlansChange={setPlans}
              loading={pending}
            />
          )}

          {step === 3 && table && (
            <PreviewStep
              plans={plans}
              rows={rows}
              rawRows={table.rows}
              destination={destination}
              warnings={inference?.warnings ?? []}
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button
            variant="ghost"
            onClick={() => (step === 0 ? close(false) : setStep(step - 1))}
            disabled={pending}
          >
            <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
            {step === 0 ? "Cancel" : "Back"}
          </Button>

          <div className="flex items-center gap-2">
            {step === 1 && active.length === 0 && (
              <span className="flex items-center gap-1.5 text-xs text-warning">
                <TriangleAlert className="h-3 w-3" />
                Every column is skipped
              </span>
            )}

            {step < 3 ? (
              <Button onClick={() => setStep(step + 1)} disabled={!canAdvance || pending}>
                Next
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
            ) : (
              <Button onClick={runIt} disabled={pending || rows.length === 0}>
                {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {pending
                  ? "Importing…"
                  : `Import ${rows.length} item${rows.length === 1 ? "" : "s"}`}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

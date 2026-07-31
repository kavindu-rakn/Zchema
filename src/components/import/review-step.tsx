"use client";

// ── Step 2 · Review the inferred schema ──────────────────────
// One row per detected column, every inference stating its evidence,
// every decision editable.
//
// Low-confidence rows sort to the TOP. The whole value of showing this
// step is the three columns the engine was unsure about; burying them
// under twenty confident ones in source order means nobody reads it and
// the review becomes a Next button.

import { useMemo, useState } from "react";
import { ChevronDown, Sparkles, TriangleAlert } from "lucide-react";

import { OptionsEditor } from "@/components/data-center/options-editor";
import { cn } from "@/lib/utils";
import type { ColumnPlan } from "@/lib/import";
import type { InferenceResult } from "@/lib/inference";
import type { FieldType } from "@/lib/types";

const FIELD_TYPES: FieldType[] = [
  "string",
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
  "url",
];

/** Below this the inference is a suggestion rather than an answer. */
const LOW_CONFIDENCE = 0.8;

export function ReviewStep({
  inference,
  plans,
  onChange,
  rowCount,
}: {
  inference: InferenceResult;
  plans: ColumnPlan[];
  onChange: (plans: ColumnPlan[]) => void;
  rowCount: number;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const byHeader = useMemo(
    () => new Map(inference.fields.map((field, index) => [plans[index]?.header ?? field.key, field])),
    [inference, plans]
  );

  /** Uncertain first, then source order. */
  const order = useMemo(() => {
    return plans
      .map((plan, index) => ({ plan, index }))
      .sort((a, b) => {
        const aConf = byHeader.get(a.plan.header)?.confidence ?? 1;
        const bConf = byHeader.get(b.plan.header)?.confidence ?? 1;
        if (aConf !== bConf) return aConf - bConf;
        return a.index - b.index;
      });
  }, [plans, byHeader]);

  const patch = (index: number, next: Partial<ColumnPlan>) =>
    onChange(plans.map((plan, i) => (i === index ? { ...plan, ...next } : plan)));

  const patchField = (index: number, next: Partial<ColumnPlan["field"]>) =>
    onChange(
      plans.map((plan, i) => (i === index ? { ...plan, field: { ...plan.field, ...next } } : plan))
    );

  const active = plans.filter((plan) => !plan.skip).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <strong className="text-foreground">{active}</strong> of {plans.length} column
          {plans.length === 1 ? "" : "s"} will be imported, across{" "}
          <strong className="text-foreground">{rowCount.toLocaleString()}</strong> row
          {rowCount === 1 ? "" : "s"}.
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          Least certain first
        </p>
      </div>

      {inference.warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          {inference.warnings.slice(0, 5).map((warning, index) => (
            <li key={index} className="flex items-start gap-1.5 text-xs text-foreground">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-1.5">
        {order.map(({ plan, index }) => {
          const inferred = byHeader.get(plan.header);
          const uncertain = (inferred?.confidence ?? 1) < LOW_CONFIDENCE;
          const isOpen = expanded === plan.header;
          const needsOptions = plan.field.type === "select" || plan.field.type === "multiselect";
          const ambiguousDate =
            plan.field.type === "date" && /cannot be determined/.test(inferred?.reason ?? "");

          return (
            <li
              key={plan.header}
              className={cn(
                "rounded-md border bg-card",
                plan.skip
                  ? "border-border/60 opacity-60"
                  : uncertain
                    ? "border-warning/40"
                    : "border-border"
              )}
            >
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  checked={!plan.skip}
                  onChange={(event) => patch(index, { skip: !event.target.checked })}
                  aria-label={`Import the ${plan.header} column`}
                  className="h-3.5 w-3.5 shrink-0 rounded border-input"
                />

                <input
                  value={plan.field.label}
                  disabled={plan.skip}
                  onChange={(event) => patchField(index, { label: event.target.value })}
                  aria-label={`Label for ${plan.header}`}
                  className="h-7 min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 text-sm text-foreground hover:border-input focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />

                <select
                  value={plan.field.type}
                  disabled={plan.skip}
                  onChange={(event) =>
                    patchField(index, { type: event.target.value as FieldType })
                  }
                  aria-label={`Type for ${plan.header}`}
                  className="h-7 shrink-0 rounded border border-input bg-background px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>

                {plan.field.unit && (
                  <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] text-secondary-foreground">
                    {plan.field.unit}
                  </span>
                )}

                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={plan.field.required}
                    disabled={plan.skip}
                    onChange={(event) => patchField(index, { required: event.target.checked })}
                    className="h-3 w-3 rounded border-input"
                  />
                  req
                </label>

                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={`Details for ${plan.header}`}
                  onClick={() => setExpanded(isOpen ? null : plan.header)}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")}
                  />
                </button>
              </div>

              {/* The evidence — always visible, not hidden behind the
                  disclosure. It is the reason to trust or override. */}
              <p
                className={cn(
                  "px-3 pb-2 text-[11px]",
                  uncertain ? "text-warning" : "text-muted-foreground"
                )}
              >
                <code className="text-foreground/70">{plan.header}</code>
                {" — "}
                {inferred?.reason}
                {inferred && inferred.null_count > 0 && (
                  <> · {inferred.null_count} empty</>
                )}
                {inferred && inferred.alternatives.length > 0 && (
                  <> · could be {inferred.alternatives.join(" or ")}</>
                )}
              </p>

              {/* An ambiguous date is a QUESTION, not a default. */}
              {ambiguousDate && !plan.skip && (
                <div className="border-t border-border/60 px-3 py-2">
                  <p className="text-[11px] text-warning">
                    Which way round is {inferred?.sample_values[0]}?
                  </p>
                  <div className="mt-1 flex gap-3">
                    {(["dmy", "mdy"] as const).map((order) => (
                      <label key={order} className="flex items-center gap-1.5 text-xs">
                        <input
                          type="radio"
                          name={`date-order-${plan.header}`}
                          checked={(plan.dateOrder ?? "dmy") === order}
                          onChange={() => patch(index, { dateOrder: order })}
                          className="h-3 w-3"
                        />
                        {order === "dmy" ? "DD/MM/YYYY" : "MM/DD/YYYY"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {isOpen && (
                <div className="space-y-2 border-t border-border/60 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-muted-foreground">Samples:</span>
                    {inferred?.sample_values.map((value) => (
                      <code
                        key={value}
                        className="max-w-52 truncate rounded bg-muted px-1.5 py-0.5 text-[11px]"
                      >
                        {value}
                      </code>
                    ))}
                    {inferred?.sample_values.length === 0 && (
                      <span className="text-[11px] text-muted-foreground">none — column is empty</span>
                    )}
                  </div>

                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Field key</span>
                    <input
                      value={plan.field.key}
                      onChange={(event) => patchField(index, { key: event.target.value })}
                      className="h-7 w-full max-w-xs rounded border border-input bg-background px-1.5 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </label>

                  {needsOptions && (
                    <div className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">Options</span>
                      <OptionsEditor
                        options={plan.field.options ?? []}
                        onChange={(options) => patchField(index, { options })}
                      />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

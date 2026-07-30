"use client";

// ── Step 4 · Preview and import ──────────────────────────────
// The first ten rows as the Items table will actually show them, a
// summary of what is about to happen, and — the part that matters —
// every cell that will not convert, listed with its line number and its
// value.
//
// The errors are computed HERE rather than being discovered by the
// server after the write. "Row 47: Release Date value n/a is not a date"
// before you commit is a fixable problem; the same sentence in a toast
// afterwards is an apology.

import { useMemo } from "react";
import { TriangleAlert } from "lucide-react";

import { parseDateShape, parseNumeric } from "@/lib/inference";
import { cn } from "@/lib/utils";
import type { Destination } from "@/components/import/import-wizard";
import type { ColumnPlan } from "@/lib/import";
import type { FieldType } from "@/lib/types";

const BOOLEAN_WORDS = new Set([
  "true", "false", "yes", "no", "y", "n", "1", "0", "t", "f", "on", "off",
]);

/** Will this already-normalised value survive its column's type? */
function willConvert(value: string, type: FieldType): boolean {
  if (value === "") return true;
  switch (type) {
    case "number":
      return parseNumeric(value) !== null;
    case "boolean":
      return BOOLEAN_WORDS.has(value.toLowerCase());
    case "date":
      // normaliseCell has already rewritten anything it could into ISO.
      return parseDateShape(value) === "iso";
    default:
      return true;
  }
}

export function PreviewStep({
  plans,
  rows,
  rawRows,
  destination,
  warnings,
}: {
  plans: ColumnPlan[];
  /** Normalised, field-keyed rows — exactly what will be sent. */
  rows: Record<string, string>[];
  /** The original parsed rows, for line numbers and original values. */
  rawRows: Record<string, string>[];
  destination: Destination;
  warnings: string[];
}) {
  const active = plans.filter((plan) => !plan.skip);
  const skipped = plans.length - active.length;
  const created = plans.filter((plan) => !plan.skip && !plan.mappedTo).length;
  const mapped = active.length - created;

  const errors = useMemo(() => {
    const found: { line: number; label: string; value: string }[] = [];

    rows.forEach((row, index) => {
      for (const plan of active) {
        const value = row[plan.field.key] ?? "";
        if (willConvert(value, plan.field.type)) continue;
        found.push({
          // +2: one for the header row, one for 1-based counting.
          line: index + 2,
          label: plan.field.label,
          value: rawRows[index]?.[plan.header] ?? value,
        });
      }
    });

    return found;
  }, [rows, rawRows, active]);

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-md border border-border bg-card/50 px-3 py-2">
        <p className="text-sm text-foreground">
          <strong>{rows.length.toLocaleString()}</strong> item
          {rows.length === 1 ? "" : "s"} into{" "}
          <strong>
            {destination.mode === "existing" ? "the selected category" : destination.name}
          </strong>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {created} new field{created === 1 ? "" : "s"}
          {mapped > 0 && <> · {mapped} mapped onto existing fields</>}
          {skipped > 0 && <> · {skipped} column{skipped === 1 ? "" : "s"} skipped</>}
          {destination.mode === "new-child" && <> · inherits its parent&apos;s fields</>}
        </p>
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          {warnings.slice(0, 4).map((warning, index) => (
            <li key={index} className="flex items-start gap-1.5 text-xs text-foreground">
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      {/* Per-cell errors, with line numbers */}
      {errors.length > 0 && (
        <div className="space-y-1 rounded-md border border-warning/40 bg-warning/5 px-3 py-2">
          <p className="text-xs font-medium text-foreground">
            {errors.length} cell{errors.length === 1 ? "" : "s"} will not convert and will import
            empty
          </p>
          <ul className="space-y-0.5">
            {errors.slice(0, 8).map((error, index) => (
              <li key={index} className="text-[11px] text-muted-foreground">
                Row {error.line}: <strong className="text-foreground">{error.label}</strong> value{" "}
                <code className="text-foreground">{error.value}</code> could not be read
              </li>
            ))}
            {errors.length > 8 && (
              <li className="text-[11px] text-muted-foreground">
                and {errors.length - 8} more
              </li>
            )}
          </ul>
        </div>
      )}

      {/* First ten rows, as the Items table will render them */}
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          First {Math.min(10, rows.length)} rows
        </p>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-card/50">
                {active.map((plan) => (
                  <th
                    key={plan.field.key}
                    className={cn(
                      "border-t-2 px-2 py-1.5 text-left font-medium",
                      plan.mappedTo === "inherited"
                        ? "border-t-muted-foreground/25"
                        : "border-t-primary/60"
                    )}
                  >
                    <span className="block truncate text-foreground">{plan.field.label}</span>
                    <span className="block truncate text-[10px] font-normal text-muted-foreground">
                      {plan.field.type}
                      {plan.mappedTo === "inherited" && " · inherited"}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, index) => (
                <tr key={index} className="border-b border-border/40 last:border-0">
                  {active.map((plan) => {
                    const value = row[plan.field.key] ?? "";
                    const bad = !willConvert(value, plan.field.type);
                    return (
                      <td
                        key={plan.field.key}
                        className={cn(
                          "max-w-40 truncate px-2 py-1",
                          bad ? "text-warning" : "text-foreground"
                        )}
                        title={value}
                      >
                        {value || <span className="text-muted-foreground/40">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

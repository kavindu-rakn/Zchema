"use client";

// ── Column visibility ────────────────────────────────────────
// Grouped by source category, because "which of these came from
// Electronics?" is the question you are actually asking when deciding
// what to hide.

import { Columns3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { groupByProvenance } from "@/lib/items";
import { defaultVisibleColumns, SCHEMA_VERSION_COLUMN } from "@/lib/items-table";
import type { EffectiveField } from "@/lib/types";

export function ColumnPicker({
  schema,
  visible,
  onChange,
}: {
  schema: EffectiveField[];
  visible: string[];
  onChange: (keys: string[]) => void;
}) {
  const groups = groupByProvenance(schema);
  const shown = new Set(visible);

  const toggle = (key: string) => {
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    // Re-derive from `schema` so column order always follows the
    // schema's own order rather than the order things were ticked.
    // Metadata columns are not in `schema`, so they are appended.
    const fields = schema.filter((field) => next.has(field.key)).map((field) => field.key);
    onChange(next.has(SCHEMA_VERSION_COLUMN) ? [...fields, SCHEMA_VERSION_COLUMN] : fields);
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <Columns3 className="mr-1.5 h-3.5 w-3.5" />
            Columns
            <span className="ml-1.5 text-muted-foreground">
              {visible.filter((key) => key !== SCHEMA_VERSION_COLUMN).length}/{schema.length}
            </span>
          </Button>
        }
      />
      <PopoverContent align="end" className="max-h-80 w-64 overflow-y-auto p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-foreground">Visible columns</span>
          <button
            type="button"
            onClick={() => onChange(defaultVisibleColumns(schema))}
            className="text-[11px] text-primary hover:underline"
          >
            Reset
          </button>
        </div>

        {groups.map((group) => (
          <div key={group.sourceId} className="border-b border-border/60 last:border-0">
            <p className="px-3 pt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              {group.inherited ? `from ${group.sourceName}` : `defined here`}
            </p>
            <ul className="p-1">
              {group.fields.map((field) => (
                <li key={field.key}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                    <input
                      type="checkbox"
                      checked={shown.has(field.key)}
                      onChange={() => toggle(field.key)}
                      className="h-3.5 w-3.5 rounded border-input"
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">{field.label}</span>
                    {field.required && (
                      <span className="shrink-0 text-[10px] text-destructive">req</span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Metadata — not part of the schema, so grouped apart. */}
        <div className="border-t border-border/60">
          <p className="px-3 pt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
            metadata
          </p>
          <ul className="p-1">
            <li>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                <input
                  type="checkbox"
                  checked={shown.has(SCHEMA_VERSION_COLUMN)}
                  onChange={() => toggle(SCHEMA_VERSION_COLUMN)}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                <span className="min-w-0 flex-1 truncate text-foreground">Schema version</span>
              </label>
            </li>
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}

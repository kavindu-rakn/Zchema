"use client";

// ── Per-column filter ────────────────────────────────────────
// The control shape follows the field type: text contains, number
// range, select multi-choice, boolean tri-state.

import { useState } from "react";
import { Filter, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultOpFor } from "@/lib/items-table";
import { cn } from "@/lib/utils";
import type { ItemFilter } from "@/lib/data/items";
import type { EffectiveField } from "@/lib/types";

const INPUT =
  "h-7 w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function ColumnFilter({
  field,
  active,
  onApply,
  onClear,
}: {
  field: EffectiveField;
  active: ItemFilter | undefined;
  onApply: (filter: ItemFilter) => void;
  onClear: () => void;
}) {
  const [value, setValue] = useState(active?.value ?? "");
  const [value2, setValue2] = useState(active?.value2 ?? "");
  const [chosen, setChosen] = useState<string[]>(
    active?.value ? active.value.split(",").filter(Boolean) : []
  );

  const op = defaultOpFor(field);

  const apply = (override?: Partial<ItemFilter>) => {
    onApply({
      key: field.key,
      type: field.type,
      op,
      value,
      value2,
      ...override,
    });
  };

  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Filter by ${field.label}`}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded transition-colors",
              active
                ? "text-primary"
                : "text-muted-foreground/50 hover:text-foreground"
            )}
          >
            <Filter className={cn("h-3 w-3", active && "fill-current")} />
          </button>
        }
      />
      <PopoverContent align="start" className="w-56 space-y-2 p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">{field.label}</span>
          {active && (
            <button
              type="button"
              onClick={onClear}
              className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}
        </div>

        {op === "range" ? (
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="min"
              className={INPUT}
            />
            <span className="text-xs text-muted-foreground">–</span>
            <input
              type="number"
              value={value2}
              onChange={(event) => setValue2(event.target.value)}
              placeholder="max"
              className={INPUT}
            />
          </div>
        ) : op === "bool" ? (
          <div className="flex gap-1">
            {[
              { label: "Any", val: "" },
              { label: "Yes", val: "true" },
              { label: "No", val: "false" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  setValue(option.val);
                  if (option.val === "") onClear();
                  else apply({ value: option.val });
                }}
                className={cn(
                  "flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors",
                  value === option.val
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : op === "in" ? (
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            {(field.options ?? []).map((option) => {
              const selected = chosen.includes(option);
              return (
                <label
                  key={option}
                  className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-xs hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => {
                      const next = selected
                        ? chosen.filter((item) => item !== option)
                        : [...chosen, option];
                      setChosen(next);
                      setValue(next.join(","));
                      if (next.length === 0) onClear();
                      else apply({ value: next.join(",") });
                    }}
                    className="h-3.5 w-3.5 rounded border-border"
                  />
                  <span className="truncate text-foreground">{option}</span>
                </label>
              );
            })}
          </div>
        ) : (
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") apply();
            }}
            placeholder="Contains…"
            className={INPUT}
          />
        )}

        {(op === "range" || op === "contains") && (
          <button
            type="button"
            onClick={() => apply()}
            className="w-full rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            Apply
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

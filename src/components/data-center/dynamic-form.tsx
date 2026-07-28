"use client";

// ── Dynamic form ─────────────────────────────────────────────
// Renders the inputs a Data Editor will see, straight from a resolved
// effective schema. The Schema tab renders this disabled as a live
// preview; Phase 4 renders it live for real item editing. One
// component, so the preview cannot drift from the real thing.

import type { EffectiveField, FieldType } from "@/lib/types";
import { cn } from "@/lib/utils";

const INPUT_CLASS =
  "h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70";

function inputTypeFor(type: FieldType): string {
  switch (type) {
    case "number":
      return "number";
    case "date":
      return "date";
    case "url":
      return "url";
    default:
      return "text";
  }
}

export function DynamicForm({
  schema,
  values = {},
  onChange,
  disabled = false,
  showProvenance = false,
}: {
  schema: EffectiveField[];
  values?: Record<string, unknown>;
  onChange?: (key: string, value: unknown) => void;
  disabled?: boolean;
  /** Tint each control by where its field came from. */
  showProvenance?: boolean;
}) {
  if (schema.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No fields yet — nothing to fill in.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {schema.map((field) => {
        const value = values[field.key];
        const id = `field-${field.key}`;

        return (
          <div
            key={field.key}
            className={cn(
              "space-y-1",
              showProvenance && "border-l-2 pl-3",
              showProvenance &&
                (field.inherited ? "border-l-muted-foreground/30" : "border-l-primary/70")
            )}
          >
            <label
              htmlFor={id}
              className="flex flex-wrap items-center gap-1 text-xs font-medium text-foreground"
            >
              {field.label}
              {field.required && (
                <span className="text-destructive" aria-label="required">
                  *
                </span>
              )}
              {field.unit && (
                <span className="font-normal text-muted-foreground">({field.unit})</span>
              )}
            </label>

            {field.type === "boolean" ? (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  id={id}
                  type="checkbox"
                  disabled={disabled}
                  checked={Boolean(value)}
                  onChange={(event) => onChange?.(field.key, event.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Yes
              </label>
            ) : field.type === "text" ? (
              <textarea
                id={id}
                rows={2}
                disabled={disabled}
                value={(value as string) ?? ""}
                onChange={(event) => onChange?.(field.key, event.target.value)}
                className={cn(INPUT_CLASS, "h-auto py-2")}
              />
            ) : field.type === "select" ? (
              <select
                id={id}
                disabled={disabled}
                value={(value as string) ?? ""}
                onChange={(event) => onChange?.(field.key, event.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">Choose…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "multiselect" ? (
              <div className="flex flex-wrap gap-1">
                {(field.options ?? []).map((option) => {
                  const selected = Array.isArray(value) && value.includes(option);
                  return (
                    <button
                      key={option}
                      type="button"
                      disabled={disabled}
                      aria-pressed={selected}
                      onClick={() => {
                        const current = Array.isArray(value) ? [...value] : [];
                        const next = selected
                          ? current.filter((item) => item !== option)
                          : [...current, option];
                        onChange?.(field.key, next);
                      }}
                      className={cn(
                        "rounded border px-2 py-0.5 text-xs transition-colors",
                        selected
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border text-muted-foreground"
                      )}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                id={id}
                type={inputTypeFor(field.type)}
                disabled={disabled}
                value={(value as string | number) ?? ""}
                onChange={(event) => onChange?.(field.key, event.target.value)}
                className={INPUT_CLASS}
              />
            )}

            {field.help_text && (
              <p className="text-[11px] text-muted-foreground">{field.help_text}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

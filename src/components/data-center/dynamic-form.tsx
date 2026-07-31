"use client";

// ── Dynamic form ─────────────────────────────────────────────
// Renders the inputs a Data Editor sees, from a resolved effective
// schema. One component serves three callers: the Schema tab's live
// preview (disabled), the item dialog, and the inline row editor —
// so the preview cannot drift from the real thing.
//
// Fields are grouped by WHERE THEY CAME FROM, which is the whole point:
// "Inherited from Electronics" reads very differently from a flat list.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ExternalLink, RotateCcw, Trash2, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  coerceValue,
  completenessOf,
  groupByProvenance,
  isBlank,
  normaliseForSave,
  orphanedEntries,
  validateItemData,
} from "@/lib/items";
import { cn } from "@/lib/utils";
import type { EffectiveField, FieldType } from "@/lib/types";

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

/** Seed values from stored data, falling back to each field's default. */
function seedValues(
  schema: EffectiveField[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const seeded: Record<string, unknown> = { ...data };
  for (const field of schema) {
    if (seeded[field.key] === undefined && field.default !== undefined) {
      seeded[field.key] = field.default;
    }
  }
  return seeded;
}

export interface DynamicFormProps {
  schema: EffectiveField[];
  /** Stored item data. Changing this (or itemId) resets the form. */
  initialData?: Record<string, unknown>;
  /** Identity of the item being edited; "new" when creating. */
  itemId?: string | null;
  categoryId?: string;
  disabled?: boolean;
  /** Tint each control by where its field came from. */
  showProvenance?: boolean;
  /** Group inputs under "Inherited from X" headers. */
  grouped?: boolean;
  onSubmit?: (data: Record<string, unknown>) => void | Promise<void>;
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  submitLabel?: string;
  pending?: boolean;
  /** Admin-only recovery of values whose field was removed. */
  canRestoreOrphans?: boolean;
  onRestoreOrphan?: (key: string) => void;
  onDiscardOrphan?: (key: string) => void;
}

export function DynamicForm({
  schema,
  initialData,
  itemId = null,
  categoryId,
  disabled = false,
  showProvenance = false,
  grouped = false,
  onSubmit,
  onCancel,
  onDirtyChange,
  submitLabel = "Save",
  pending = false,
  canRestoreOrphans = false,
  onRestoreOrphan,
  onDiscardOrphan,
}: DynamicFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    seedValues(schema, initialData ?? {})
  );
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [orphansOpen, setOrphansOpen] = useState(false);

  const draftKey = categoryId ? `schemashift:draft:${categoryId}:${itemId ?? "new"}` : null;
  const baselineRef = useRef<string>(JSON.stringify(initialData ?? {}));

  // Reset when the form is reused for a different item. The previous
  // implementation seeded state once, so reopening the dialog on another
  // row kept the first row's values.
  useEffect(() => {
    setValues(seedValues(schema, initialData ?? {}));
    setTouched(new Set());
    setSubmitted(false);
    baselineRef.current = JSON.stringify(initialData ?? {});
    // `schema` is intentionally excluded: a schema edit should not wipe
    // half-entered values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, initialData]);

  // Restore an interrupted draft, so an accidental dialog close does
  // not lose a half-filled form.
  useEffect(() => {
    if (!draftKey || disabled) return;
    try {
      const stored = window.sessionStorage.getItem(draftKey);
      if (stored) setValues((previous) => ({ ...previous, ...JSON.parse(stored) }));
    } catch {
      // Corrupt or unavailable storage — start clean.
    }
  }, [draftKey, disabled]);

  const errors = useMemo(() => validateItemData(schema, values), [schema, values]);
  const dirty = useMemo(
    () => JSON.stringify(normaliseForSave(schema, values)) !== baselineRef.current,
    [schema, values]
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const setValue = useCallback(
    (key: string, value: unknown) => {
      setValues((previous) => {
        const next = { ...previous, [key]: value };
        if (draftKey && !disabled) {
          try {
            window.sessionStorage.setItem(draftKey, JSON.stringify(next));
          } catch {
            // Storage full or blocked — editing still works.
          }
        }
        return next;
      });
    },
    [draftKey, disabled]
  );

  const showError = (key: string) => (submitted || touched.has(key)) && errors[key];

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;

    await onSubmit?.(normaliseForSave(schema, values));

    if (draftKey) {
      try {
        window.sessionStorage.removeItem(draftKey);
      } catch {
        // Nothing to clean up.
      }
    }
  };

  const orphans = orphanedEntries(values);
  const groups = useMemo(() => groupByProvenance(schema), [schema]);

  const renderField = (field: EffectiveField) => {
    const value = values[field.key];
    const id = `field-${field.key}`;
    const error = showError(field.key);
    const markProvenance = showProvenance && !grouped;

    return (
      <div
        key={field.key}
        className={cn(
          "space-y-1",
          markProvenance && "border-l-2 pl-3",
          markProvenance &&
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
              onChange={(event) => setValue(field.key, event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Yes
          </label>
        ) : field.type === "text" ? (
          <textarea
            id={id}
            rows={3}
            disabled={disabled}
            value={(value as string) ?? ""}
            onChange={(event) => setValue(field.key, event.target.value)}
            onBlur={() => setTouched((previous) => new Set(previous).add(field.key))}
            aria-invalid={Boolean(error)}
            className={cn(INPUT_CLASS, "h-auto py-2", error && "border-destructive")}
          />
        ) : field.type === "select" ? (
          <select
            id={id}
            disabled={disabled}
            value={(value as string) ?? ""}
            onChange={(event) => setValue(field.key, event.target.value)}
            onBlur={() => setTouched((previous) => new Set(previous).add(field.key))}
            aria-invalid={Boolean(error)}
            className={cn(INPUT_CLASS, error && "border-destructive")}
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
                    setValue(
                      field.key,
                      selected ? current.filter((item) => item !== option) : [...current, option]
                    );
                  }}
                  className={cn(
                    "rounded border px-2 py-0.5 text-xs transition-colors",
                    selected
                      ? "border-primary bg-primary/15 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40"
                  )}
                >
                  {option}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="relative">
            <input
              id={id}
              type={inputTypeFor(field.type)}
              disabled={disabled}
              value={(value as string | number) ?? ""}
              onChange={(event) => setValue(field.key, event.target.value)}
              onBlur={() => setTouched((previous) => new Set(previous).add(field.key))}
              aria-invalid={Boolean(error)}
              className={cn(
                INPUT_CLASS,
                error && "border-destructive",
                field.unit && "pr-12",
                field.type === "url" && !isBlank(value) && "pr-9"
              )}
            />
            {field.unit && (
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {field.unit}
              </span>
            )}
            {field.type === "url" && !isBlank(value) && !errors[field.key] && (
              <a
                href={String(value).includes("://") ? String(value) : `https://${value}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open link"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        )}

        {field.help_text && !error && (
          <p className="text-[11px] text-muted-foreground">{field.help_text}</p>
        )}
        {error && <p className="text-[11px] text-destructive">{errors[field.key]}</p>}
      </div>
    );
  };

  const body =
    schema.length === 0 ? (
      <p className="text-sm text-muted-foreground">No fields yet — nothing to fill in.</p>
    ) : grouped ? (
      <div className="space-y-4">
        {groups.map((group) => {
          // A collapsed group must never hide an unfilled required field.
          const hasUnfilledRequired = group.fields.some(
            (field) => field.required && isBlank(coerceValue(field, values[field.key]))
          );
          const isCollapsed = collapsed.has(group.sourceId) && !hasUnfilledRequired;

          return (
            <section key={group.sourceId} className="space-y-2">
              <button
                type="button"
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(group.sourceId)) next.delete(group.sourceId);
                    else next.add(group.sourceId);
                    return next;
                  })
                }
                aria-expanded={!isCollapsed}
                className="flex w-full items-center gap-1.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  className={cn("h-3 w-3 transition-transform", isCollapsed && "-rotate-90")}
                />
                {group.inherited ? `Inherited from ${group.sourceName}` : `Defined on ${group.sourceName}`}
                <span className="font-normal normal-case tracking-normal">
                  ({group.fields.length})
                </span>
                {hasUnfilledRequired && (
                  <span className="ml-auto flex items-center gap-1 normal-case tracking-normal text-destructive">
                    <TriangleAlert className="h-3 w-3" />
                    required
                  </span>
                )}
              </button>

              {!isCollapsed && (
                <div
                  className={cn(
                    "space-y-3 border-l-2 pl-3",
                    group.inherited ? "border-l-muted-foreground/30" : "border-l-primary/70"
                  )}
                >
                  {group.fields.map(renderField)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    ) : (
      <div className="space-y-3">{schema.map(renderField)}</div>
    );

  const completeness = completenessOf(schema, values);

  // Preview mode: no form element, no actions.
  if (!onSubmit) {
    return <div className="space-y-3">{body}</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
        {body}

        {/* Orphaned data — visible and recoverable, never silently lost */}
        {orphans.length > 0 && (
          <section className="rounded-md border border-warning/40 bg-warning/5">
            <button
              type="button"
              onClick={() => setOrphansOpen((open) => !open)}
              aria-expanded={orphansOpen}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", !orphansOpen && "-rotate-90")}
              />
              <TriangleAlert className="h-3.5 w-3.5 text-warning" />
              {orphans.length} value{orphans.length === 1 ? "" : "s"} from removed fields
            </button>

            {orphansOpen && (
              <div className="space-y-1 border-t border-warning/30 px-3 py-2">
                <p className="text-[11px] text-muted-foreground">
                  These were kept when their field was removed from the schema.
                </p>
                {orphans.map(([key, value]) => (
                  <div
                    key={key}
                    className="flex flex-wrap items-center gap-2 rounded border border-border bg-background px-2 py-1.5"
                  >
                    <code className="text-[11px] text-foreground">{key}</code>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {typeof value === "object" ? JSON.stringify(value) : String(value)}
                    </span>
                    {canRestoreOrphans && (
                      <span className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          onClick={() => onRestoreOrphan?.(key)}
                          title="Recreate this field on the category"
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => onDiscardOrphan?.(key)}
                          title="Discard this value permanently"
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          Discard
                        </button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-[11px] text-muted-foreground">
          {completeness.filled}/{completeness.total} filled
          {completeness.missingRequired.length > 0 && (
            <span className="text-destructive">
              {" "}
              · {completeness.missingRequired.length} required missing
            </span>
          )}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

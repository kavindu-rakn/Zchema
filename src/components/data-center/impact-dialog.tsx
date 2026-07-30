"use client";

// ── Blast-radius dialog ──────────────────────────────────────
// The screen this whole product is for. Before a schema change is
// written, this shows exactly what it does to live records and makes
// the user choose what happens to any value that cannot survive.
//
// Two rules shape everything here:
//   1. Never state a bare number. "31 items affected" tells the user
//      nothing they can act on; "31 of 48 items have no value for this
//      field and will be flagged incomplete" does.
//   2. No destructive change applies without an explicit choice, and
//      the choice that deletes data is never the default and never
//      one click away.
//
// The analysis itself is computed by analyze_schema_change() in SQL and
// passed in — the schema editor owns it so the severity badge on the
// "Review changes" button can update live as the user types.

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  ChevronDown,
  Info,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { encodeFilters } from "@/lib/items-table";
import { cn } from "@/lib/utils";
import type {
  ChangeSeverity,
  EffectiveField,
  Remediation,
  RemediationStrategy,
  SchemaChange,
  SchemaImpact,
} from "@/lib/types";

// ── Severity presentation ────────────────────────────────────
const SEVERITY_RANK: Record<ChangeSeverity, number> = {
  destructive: 0,
  warning: 1,
  safe: 2,
};

const SEVERITY_STYLE: Record<ChangeSeverity, { chip: string; edge: string; label: string }> = {
  destructive: {
    chip: "bg-destructive/10 text-destructive",
    edge: "border-l-destructive",
    label: "DESTRUCTIVE",
  },
  warning: {
    chip: "bg-warning/10 text-warning",
    edge: "border-l-warning",
    label: "WARNING",
  },
  safe: {
    chip: "bg-muted text-muted-foreground",
    edge: "border-l-border",
    label: "SAFE",
  },
};

/** Stable identity for a change — a field can carry two at once. */
function changeId(change: SchemaChange): string {
  return `${change.field_key}:${change.kind}`;
}

// ── Remediation options ──────────────────────────────────────
interface StrategyOption {
  value: RemediationStrategy;
  label: string;
  detail: string;
}

/**
 * The choices offered for a change, SAFEST FIRST — the first entry is
 * also the default, which is why `discard` is never listed first.
 */
function optionsFor(change: SchemaChange): StrategyOption[] {
  switch (change.kind) {
    case "remove_field":
      return [
        {
          value: "orphan",
          label: "Move to orphaned data",
          detail: "Values are preserved under the item's orphaned data and can be restored later.",
        },
        {
          value: "discard",
          label: "Delete the values",
          detail: "The values are removed permanently. This cannot be undone.",
        },
      ];
    case "retype_field":
      return [
        {
          value: "cast",
          label: "Convert the values",
          detail: "Values that convert cleanly are kept; anything that will not convert moves to orphaned data.",
        },
        {
          value: "orphan",
          label: "Move all to orphaned data",
          detail: "No conversion is attempted — every existing value is preserved as orphaned data.",
        },
        {
          value: "discard",
          label: "Delete the values",
          detail: "The values are removed permanently. This cannot be undone.",
        },
      ];
    case "change_options":
      return [
        {
          value: "orphan",
          label: "Move stranded values to orphaned data",
          detail: "Only items holding a removed option are touched.",
        },
        {
          value: "backfill",
          label: "Replace with another value",
          detail: "Stranded values are rewritten to the value you choose.",
        },
        {
          value: "discard",
          label: "Clear the stranded values",
          detail: "Items holding a removed option lose the value permanently.",
        },
      ];
    case "add_field":
    case "require_field":
      return [
        {
          value: "leave",
          label: "Leave blank and flag incomplete",
          detail: "Nothing is written. Affected items show up under the Incomplete filter.",
        },
        {
          value: "backfill",
          label: "Backfill every blank item",
          detail: "Writes the value you choose into every item that has none.",
        },
      ];
    default:
      return [];
  }
}

/** A change that needs a decision before anything can be applied. */
function needsChoice(change: SchemaChange): boolean {
  return change.severity === "destructive";
}

// ── Plain language ───────────────────────────────────────────
function headline(change: SchemaChange): string {
  switch (change.kind) {
    case "add_field":
      return "new field";
    case "remove_field":
      return "removed";
    case "retype_field":
      return `${String(change.from ?? "?")} → ${String(change.to ?? "?")}`;
    case "require_field":
      return "now required";
    case "unrequire_field":
      return "now optional";
    case "rename_label":
      return "label changed";
    case "change_help_text":
      return "help text changed";
    case "change_options":
      return "options changed";
    case "add_override":
      return "overridden here";
    case "remove_override":
      return "override removed";
    case "rollback":
      return "restored";
    case "reparent":
      return "moved";
    default:
      return change.kind;
  }
}

/**
 * One sentence a human can act on. Never a bare count — the number is
 * always given against the total, and always says what happens next.
 */
function explain(change: SchemaChange, totalItems: number): string {
  const n = change.affected_item_count ?? 0;
  const plural = (count: number) => (count === 1 ? "item" : "items");

  switch (change.kind) {
    case "add_field":
      if (n === 0) return "Optional, so nothing changes for existing items.";
      return `All ${n} ${plural(n)} lack a value for this new required field and will be flagged incomplete.`;

    case "require_field":
      if (n === 0) return `Every one of the ${totalItems} ${plural(totalItems)} already has a value, so nothing is flagged.`;
      return `${n} of ${totalItems} ${plural(totalItems)} have no value for this field and will be flagged incomplete.`;

    case "remove_field":
      if (n === 0) return "No item holds a value for this field, so nothing is at stake.";
      return `${n} ${plural(n)} hold a value. Nothing is deleted unless you choose to — values move to orphaned data and can be restored.`;

    case "retype_field": {
      const lossy = change.lossy_item_count ?? 0;
      if (n === 0) return "No item holds a value for this field yet, so nothing can be lost.";
      if (lossy === 0) return `${n} ${plural(n)} hold a value, and all ${n} convert cleanly to the new type.`;
      return `${n} ${plural(n)} hold a value. ${n - lossy} convert cleanly; ${lossy} will not and must go somewhere.`;
    }

    case "change_options":
      if (n === 0) return "No item holds an option that is being removed.";
      return `${n} ${plural(n)} hold an option that is being removed and will be left with a value the field no longer allows.`;

    case "unrequire_field":
      return "Relaxing a requirement cannot invalidate anything that is already stored.";

    case "rename_label":
      return "Display only. The stored key and every item value are untouched.";

    case "change_help_text":
      return "Guidance shown beside the input. Nothing stored changes.";

    case "add_override":
      return "This category now patches an inherited field. Its ancestors are unaffected.";

    case "remove_override":
      return "This category stops patching the inherited field and falls back to the ancestor's definition.";

    default:
      return "";
  }
}

/** The value shown in a sample chip, without JSON quoting noise. */
function renderSample(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

/**
 * Coerce a backfill value to the field's own type before it is sent.
 *
 * The input is a text box, but the value lands in JSONB. Writing "12"
 * into a `number` field would store a string that then sorts as text
 * and fails its own type check — precisely the silent corruption this
 * dialog exists to prevent.
 */
function coerceBackfill(raw: string, field: EffectiveField | undefined): unknown {
  // "" stays "" so the apply button's "needs a value" guard still bites.
  if (raw === "") return "";

  switch (field?.type) {
    case "number": {
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : raw;
    }
    case "boolean":
      return raw === "true";
    case "multiselect":
      return [raw];
    default:
      return raw;
  }
}

// ── Component ────────────────────────────────────────────────
export function ImpactDialog({
  open,
  onOpenChange,
  categoryId,
  categoryName,
  schema,
  impact,
  analyzing,
  analysisError,
  pending,
  onApply,
  title,
  intro,
  children,
  applyLabel = "Apply changes",
  applyingLabel = "Applying…",
  notReadyReason,
  emptyMessage = "Nothing to save — the draft matches the saved schema.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categoryId: string;
  categoryName: string;
  /** The DRAFT effective schema — supplies each field's type. */
  schema: EffectiveField[];
  /** Result of analyze_schema_change or analyze_category_move. */
  impact: SchemaImpact | null;
  analyzing: boolean;
  analysisError: string | null;
  pending: boolean;
  /** Resolves false when the apply failed, so the draft is kept. */
  onApply: (remediations: Record<string, Remediation>) => Promise<boolean>;
  title?: string;
  /** Replaces the "N categories · M items" summary line. */
  intro?: ReactNode;
  /** Rendered above the change cards — e.g. a destination picker. */
  children?: ReactNode;
  applyLabel?: string;
  applyingLabel?: string;
  /** A caller-side reason the apply is not ready yet. */
  notReadyReason?: string | null;
  emptyMessage?: string;
}) {
  // Only what the user has explicitly picked. Defaults are derived
  // below rather than seeded into state: seeding would mean an effect
  // racing the analysis, and a re-analysis could then quietly overwrite
  // a choice the user had already made.
  const [choices, setChoices] = useState<Record<string, Remediation>>({});
  const [safeOpen, setSafeOpen] = useState(false);

  const changes = useMemo(() => impact?.changes ?? [], [impact]);

  /**
   * The field a change refers to, for typing its backfill input.
   *
   * `schema` is the caller's draft, which covers a schema edit. A MOVE
   * gains fields from the new parent — a schema the client never
   * fetched — so the change's own `to` payload is the fallback. It
   * carries the whole resolved field for add_field.
   */
  const fieldsByKey = useMemo(
    () => new Map(schema.map((field) => [field.key, field])),
    [schema]
  );

  const fieldFor = (change: SchemaChange): EffectiveField | undefined => {
    const known = fieldsByKey.get(change.field_key);
    if (known) return known;
    const payload = change.to ?? change.from;
    if (payload && typeof payload === "object" && "type" in payload) {
      return payload as EffectiveField;
    }
    return undefined;
  };

  const sorted = useMemo(
    () =>
      [...changes].sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          a.field_key.localeCompare(b.field_key)
      ),
    [changes]
  );

  const risky = sorted.filter((change) => change.severity !== "safe");
  const safe = sorted.filter((change) => change.severity === "safe");

  /**
   * The user's choice where they made one, the SAFEST option otherwise.
   * `optionsFor` lists options safest-first, which is what guarantees
   * `discard` is never a default.
   */
  const remediations = useMemo(() => {
    const resolved: Record<string, Remediation> = {};
    for (const change of changes) {
      const id = changeId(change);
      const chosen = choices[id];
      if (chosen) {
        resolved[id] = chosen;
        continue;
      }
      const [safest] = optionsFor(change);
      if (safest) resolved[id] = { strategy: safest.value };
    }
    return resolved;
  }, [changes, choices]);

  const setStrategy = (change: SchemaChange, strategy: RemediationStrategy) =>
    setChoices((previous) => ({
      ...previous,
      // Dropping value/confirm on a switch is deliberate: a confirm
      // ticked for `discard` must not survive a change of mind and back.
      [changeId(change)]: { strategy },
    }));

  const patch = (change: SchemaChange, next: Partial<Remediation>) =>
    setChoices((previous) => ({
      ...previous,
      [changeId(change)]: {
        ...(previous[changeId(change)] ?? remediations[changeId(change)]),
        ...next,
      } as Remediation,
    }));

  /** Why the apply button is disabled, or null when it is ready. */
  const blocker = useMemo(() => {
    if (notReadyReason) return notReadyReason;
    if (!impact) return "Analysing…";
    if (impact.blocked) return impact.blocked_reason ?? "This change cannot be applied.";
    if (changes.length === 0) return "Nothing to apply.";

    for (const change of changes) {
      const chosen = remediations[changeId(change)];

      if (needsChoice(change) && !chosen?.strategy) {
        return `Choose what happens to “${change.field_key}”.`;
      }
      if (chosen?.strategy === "discard" && !chosen.confirm) {
        return `Confirm the permanent deletion on “${change.field_key}”.`;
      }
      if (
        chosen?.strategy === "backfill" &&
        (chosen.value === undefined || chosen.value === "")
      ) {
        return `Enter a value to backfill “${change.field_key}”.`;
      }
    }
    return null;
  }, [impact, changes, remediations, notReadyReason]);

  const destructiveCount = changes.filter((c) => c.severity === "destructive").length;

  const apply = async () => {
    const ok = await onApply(remediations);
    if (ok) {
      setChoices({});
      onOpenChange(false);
    }
    // On failure the dialog stays open with every choice intact.
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            {impact?.max_severity === "destructive" && (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            )}
            {title ?? `Review changes to ${categoryName}`}
          </DialogTitle>
          <DialogDescription>
            {intro ? (
              intro
            ) : analyzing && !impact ? (
              "Measuring the blast radius…"
            ) : impact ? (
              <span className="flex flex-wrap items-center gap-x-1.5">
                <strong className="text-foreground">
                  {impact.affected_categories.length}
                </strong>
                {impact.affected_categories.length === 1 ? "category" : "categories"}
                <span aria-hidden>·</span>
                <strong className="text-foreground">{impact.total_affected_items}</strong>
                {impact.total_affected_items === 1 ? "item" : "items"}
                {destructiveCount > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <strong className="text-destructive">{destructiveCount}</strong>
                    <span className="text-destructive">
                      destructive change{destructiveCount === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </span>
            ) : (
              "No analysis available."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {children}

          {analysisError && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {analysisError}
            </p>
          )}

          {impact?.blocked && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <Ban className="h-4 w-4 shrink-0" />
                This change cannot be applied
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{impact.blocked_reason}</p>
            </div>
          )}

          {!impact?.blocked && impact && changes.length === 0 && !analyzing && (
            <p className="py-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          )}

          {!impact?.blocked &&
            risky.map((change) => (
              <ChangeCard
                key={changeId(change)}
                change={change}
                categoryId={categoryId}
                field={fieldFor(change)}
                totalItems={impact?.total_affected_items ?? 0}
                remediation={remediations[changeId(change)]}
                onStrategy={(strategy) => setStrategy(change, strategy)}
                onPatch={(next) => patch(change, next)}
              />
            ))}

          {/* Safe changes collapse to one line — they are not the point. */}
          {!impact?.blocked && safe.length > 0 && (
            <div className="rounded-md border border-border">
              <button
                type="button"
                aria-expanded={safeOpen}
                onClick={() => setSafeOpen((previous) => !previous)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", !safeOpen && "-rotate-90")}
                />
                <Check className="h-3.5 w-3.5 text-muted-foreground" />
                {safe.length} safe change{safe.length === 1 ? "" : "s"}
              </button>

              {safeOpen && (
                <ul className="space-y-1 border-t border-border px-3 py-2">
                  {safe.map((change) => (
                    <li key={changeId(change)} className="flex items-baseline gap-2 text-sm">
                      <code className="shrink-0 text-xs text-foreground">{change.field_key}</code>
                      <span className="text-xs text-muted-foreground">{headline(change)}</span>
                      <span className="min-w-0 text-xs text-muted-foreground/80">
                        {explain(change, impact?.total_affected_items ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          {impact?.blocked ? (
            <>
              <p className="text-xs text-muted-foreground">
                Fix the conflict in the editor and try again.
              </p>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {analyzing && <Loader2 className="h-3 w-3 animate-spin" />}
                {impact ? (
                  <>
                    Version{" "}
                    <strong className="text-foreground">{impact.current_version}</strong>
                    <ArrowRight className="h-3 w-3" aria-hidden />
                    <strong className="text-foreground">{impact.next_version}</strong>
                  </>
                ) : (
                  "Analysing…"
                )}
              </p>
              <div className="flex items-center gap-2">
                {blocker && (changes.length > 0 || notReadyReason) && (
                  <span className="text-xs text-muted-foreground">{blocker}</span>
                )}
                <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                  Cancel
                </Button>
                <Button onClick={apply} disabled={pending || Boolean(blocker)}>
                  {pending ? applyingLabel : applyLabel}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── One change ───────────────────────────────────────────────
function ChangeCard({
  change,
  categoryId,
  field,
  totalItems,
  remediation,
  onStrategy,
  onPatch,
}: {
  change: SchemaChange;
  categoryId: string;
  /** The drafted field, when it still exists — supplies its type. */
  field: EffectiveField | undefined;
  totalItems: number;
  remediation: Remediation | undefined;
  onStrategy: (strategy: RemediationStrategy) => void;
  onPatch: (next: Partial<Remediation>) => void;
}) {
  const style = SEVERITY_STYLE[change.severity];
  const options = optionsFor(change);
  const samples = change.sample_values ?? [];

  // "View all N" lands on the Items tab already filtered to the rows
  // this change touches, scoped across the subtree the change reaches.
  const itemsHref = `/data-center/${categoryId}?tab=items&scope=subtree&f=${encodeURIComponent(
    encodeFilters([
      {
        key: change.field_key,
        op: change.kind === "require_field" || change.kind === "add_field" ? "is_empty" : "not_empty",
        type: "string",
        value: "",
        value2: "",
      },
    ])
  )}`;

  return (
    <section className={cn("rounded-md border border-l-2 border-border bg-card", style.edge)}>
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <code className="text-sm font-medium text-foreground">{change.field_key}</code>
        <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
        <span className="text-sm text-muted-foreground">{headline(change)}</span>
        <span
          className={cn(
            "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
            style.chip
          )}
        >
          {style.label}
        </span>
      </header>

      <div className="space-y-3 px-4 pb-3">
        <p className="text-sm text-muted-foreground">{explain(change, totalItems)}</p>

        {samples.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              {change.kind === "retype_field" ? "Will not convert:" : "For example:"}
            </span>
            {samples.slice(0, 5).map((value, index) => (
              <code
                key={index}
                className="max-w-[14rem] truncate rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground"
              >
                {renderSample(value)}
              </code>
            ))}
            {change.affected_item_count > samples.length && (
              <Link
                href={itemsHref}
                className="text-[11px] text-primary hover:underline"
              >
                view all {change.affected_item_count}
              </Link>
            )}
          </div>
        )}

        {options.length > 0 && (
          <RadioGroup
            value={remediation?.strategy ?? null}
            onValueChange={(value) => onStrategy(value as RemediationStrategy)}
            className="gap-1.5"
          >
            {options.map((option) => {
              const selected = remediation?.strategy === option.value;
              return (
                <div key={option.value}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
                      selected ? "border-primary/50 bg-accent/40" : "border-border"
                    )}
                  >
                    <RadioGroupItem value={option.value} className="mt-0.5" />
                    <span className="min-w-0">
                      <span
                        className={cn(
                          "block text-sm",
                          option.value === "discard"
                            ? "text-destructive"
                            : "text-foreground"
                        )}
                      >
                        {option.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {option.detail}
                      </span>
                    </span>
                  </label>

                  {/* discard needs a second, deliberate action. */}
                  {selected && option.value === "discard" && (
                    <label className="mt-1 ml-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(remediation?.confirm)}
                        onChange={(event) => onPatch({ confirm: event.target.checked })}
                        className="mt-0.5 h-3.5 w-3.5 rounded border-destructive"
                      />
                      <span className="text-xs text-destructive">
                        I understand {change.affected_item_count} item value
                        {change.affected_item_count === 1 ? "" : "s"} will be deleted permanently
                        and cannot be recovered.
                      </span>
                    </label>
                  )}

                  {/* The control follows the FIELD's type, and the value
                      is coerced to it — "12" backfilled into a number
                      field must land as 12, not as a string. */}
                  {selected && option.value === "backfill" && (
                    <div className="mt-1 ml-3 flex items-center gap-2">
                      {field?.type === "boolean" ? (
                        <select
                          value={
                            remediation?.value === undefined || remediation.value === ""
                              ? ""
                              : String(remediation.value)
                          }
                          onChange={(event) =>
                            onPatch({ value: coerceBackfill(event.target.value, field) })
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">Choose a value…</option>
                          <option value="true">true</option>
                          <option value="false">false</option>
                        </select>
                      ) : field?.options?.length ? (
                        <select
                          value={String(remediation?.value ?? "")}
                          onChange={(event) =>
                            onPatch({ value: coerceBackfill(event.target.value, field) })
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">Choose a value…</option>
                          {field.options.map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={field?.type === "number" ? "number" : "text"}
                          value={String(remediation?.value ?? "")}
                          onChange={(event) =>
                            onPatch({ value: coerceBackfill(event.target.value, field) })
                          }
                          placeholder="Value to write"
                          className="h-8 w-full max-w-xs rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        />
                      )}
                      {field && (
                        <span className="text-[11px] text-muted-foreground">{field.type}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </RadioGroup>
        )}

        {options.length === 0 && change.severity === "warning" && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            No item data is touched by this change.
          </p>
        )}
      </div>
    </section>
  );
}

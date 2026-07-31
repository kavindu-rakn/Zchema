"use client";

// ── Version history & schema diff ────────────────────────────
// The audit trail apply_schema_change() writes, made readable.
//
// The diff here is computed by diffSchemas() from src/lib/schema.ts —
// the SAME function the impact dialog's client-side preview uses. That
// is deliberate: if history rendered its own comparison, the diff shown
// after a change could disagree with the one shown before it, and the
// user would have no way to tell which was lying.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ChevronDown,
  Clock,
  Download,
  History,
  RotateCcw,
  User,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { rollbackSchemaVersion } from "@/app/(dashboard)/data-center/actions";
import { diffSchemas } from "@/lib/schema";
import { cn } from "@/lib/utils";
import type { ChangeSeverity, EffectiveField, SchemaChange, SchemaVersion } from "@/lib/types";

export interface VersionEntry extends SchemaVersion {
  author_email: string | null;
}

// ── Formatting ───────────────────────────────────────────────
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "2 days ago". Falls back to "just now" under a minute. */
function timeAgo(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return formatter.format(-Math.round(elapsed / ms), unit);
    }
  }
  return "just now";
}

const SEVERITY_DOT: Record<ChangeSeverity, string> = {
  destructive: "bg-destructive",
  warning: "bg-warning",
  safe: "bg-muted-foreground/40",
};

function severityOf(changes: SchemaChange[]): ChangeSeverity {
  if (changes.some((change) => change.severity === "destructive")) return "destructive";
  if (changes.some((change) => change.severity === "warning")) return "warning";
  return "safe";
}

/** "+1 field, 1 retyped" — the shape of the change at a glance. */
function summarise(changes: SchemaChange[]): string {
  const counts = new Map<string, number>();
  const bump = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);

  for (const change of changes) {
    switch (change.kind) {
      case "add_field":
        bump("added");
        break;
      case "remove_field":
        bump("removed");
        break;
      case "retype_field":
        bump("retyped");
        break;
      case "require_field":
        bump("now required");
        break;
      case "unrequire_field":
        bump("now optional");
        break;
      case "change_options":
        bump("options changed");
        break;
      case "rename_label":
        bump("relabelled");
        break;
      case "change_help_text":
        bump("help text edited");
        break;
      case "add_override":
      case "remove_override":
        bump("override changed");
        break;
      case "rollback":
        bump("rollback");
        break;
      case "reparent":
        bump("moved");
        break;
      default:
        break;
    }
  }

  if (counts.size === 0) return "no field changes";
  return [...counts.entries()].map(([label, n]) => `${n} ${label}`).join(", ");
}

function describeStrategy(change: SchemaChange): string | null {
  switch (change.strategy) {
    case "backfill":
      return `backfilled ${change.remediated_item_count ?? 0}`;
    case "cast":
      return `converted ${change.remediated_item_count ?? 0}`;
    case "orphan":
      return `moved ${change.remediated_item_count ?? 0} to orphaned data`;
    case "discard":
      return `deleted ${change.remediated_item_count ?? 0}`;
    case "leave":
      return "left as-is";
    default:
      return null;
  }
}

// ── Component ────────────────────────────────────────────────
export function HistoryTimeline({
  categoryId,
  categoryName,
  versions,
  currentSchema,
  staleCount,
  oldestStaleVersion,
  currentVersion,
  canEdit,
}: {
  categoryId: string;
  categoryName: string;
  /** Newest first. */
  versions: VersionEntry[];
  /** Live effective schema — the right-hand side when diffing "now". */
  currentSchema: EffectiveField[];
  staleCount: number;
  oldestStaleVersion: number | null;
  currentVersion: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [restoring, setRestoring] = useState<VersionEntry | null>(null);
  const [pending, startTransition] = useTransition();

  // Default the diff to "the previous version → the latest one", which
  // is the comparison anyone opening this tab actually wants.
  const [left, setLeft] = useState<number>(() =>
    versions.length > 1 ? versions[1].version : versions[0]?.version ?? 0
  );
  const [right, setRight] = useState<number>(() => versions[0]?.version ?? 0);

  const byVersion = useMemo(
    () => new Map(versions.map((entry) => [entry.version, entry])),
    [versions]
  );

  const leftSchema = useMemo(
    () => byVersion.get(left)?.snapshot ?? [],
    [byVersion, left]
  );

  // Comparing against the CURRENT version uses the live effective
  // schema rather than its stored snapshot: an ancestor's change since
  // then would not be in the snapshot, and "current" has to mean now.
  const rightSchema = useMemo(
    () => (right === currentVersion ? currentSchema : byVersion.get(right)?.snapshot ?? []),
    [byVersion, right, currentVersion, currentSchema]
  );

  const diff = useMemo(() => diffSchemas(leftSchema, rightSchema), [leftSchema, rightSchema]);

  const toggle = (version: number) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });

  const exportSnapshot = (entry: VersionEntry) => {
    const blob = new Blob([JSON.stringify(entry.snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${categoryName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-v${entry.version}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const restore = () => {
    if (!restoring) return;
    const target = restoring.version;
    startTransition(async () => {
      const result = await rollbackSchemaVersion(categoryId, target);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Restored v${target} as v${result.data.version}`, {
        description: "Schema only — item values already migrated stay as they are.",
      });
      setRestoring(null);
      router.refresh();
    });
  };

  if (versions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 px-6 py-10 text-center">
        <History className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-2 text-sm font-medium text-foreground">No versions recorded yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The first schema change applied to {categoryName} writes v1, and every change after
          that is kept here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Stale item data ───────────────────────────────── */}
      {staleCount > 0 && oldestStaleVersion !== null && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5">
          <Clock className="h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-sm text-foreground">
            <strong>{staleCount}</strong> item{staleCount === 1 ? " was" : "s were"} written
            against v{oldestStaleVersion} and older.
          </p>
          <Link
            href={`/data-center/${categoryId}?tab=items&sv=${currentVersion}`}
            className="text-sm text-primary hover:underline"
          >
            Review them →
          </Link>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Timeline ────────────────────────────────────── */}
        <section className="min-w-0 rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Timeline
            </h3>
          </header>

          <ol className="divide-y divide-border/60">
            {versions.map((entry) => {
              const changes = entry.change_summary ?? [];
              const isOpen = expanded.has(entry.version);
              const isCurrent = entry.version === currentVersion;

              return (
                <li key={entry.id}>
                  <div className="flex items-start gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => toggle(entry.version)}
                      className="mt-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronDown
                        className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")}
                      />
                    </button>

                    <span
                      className={cn(
                        "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                        SEVERITY_DOT[severityOf(changes)]
                      )}
                      aria-hidden
                    />

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <strong className="text-foreground">v{entry.version}</strong>
                        {isCurrent && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            current
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {timeAgo(entry.created_at)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />
                          {entry.author_email?.split("@")[0] ?? "—"}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">{summarise(changes)}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Export v${entry.version} as JSON`}
                        title="Export snapshot as JSON"
                        onClick={() => exportSnapshot(entry)}
                        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </button>
                      {canEdit && !isCurrent && (
                        <button
                          type="button"
                          aria-label={`Restore v${entry.version}`}
                          title="Restore this version"
                          onClick={() => setRestoring(entry)}
                          className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <ul className="space-y-1 px-4 pb-3 pl-12">
                      {changes.length === 0 && (
                        <li className="text-xs text-muted-foreground">
                          Nothing was recorded for this version.
                        </li>
                      )}
                      {changes.map((change, index) => {
                        const strategy = describeStrategy(change);
                        return (
                          <li
                            key={`${change.field_key}-${change.kind}-${index}`}
                            className="flex flex-wrap items-baseline gap-x-2 text-xs"
                          >
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                SEVERITY_DOT[change.severity]
                              )}
                              aria-hidden
                            />
                            <code className="text-foreground">{change.field_key}</code>
                            <span className="text-muted-foreground">{change.kind}</span>
                            {strategy && (
                              <span className="text-muted-foreground/80">· {strategy}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {/* ── Diff ────────────────────────────────────────── */}
        <section className="min-w-0 rounded-lg border border-border bg-card">
          <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Compare
            </h3>
            <span className="ml-auto flex items-center gap-1.5">
              <VersionSelect
                label="Compare from"
                value={left}
                versions={versions}
                currentVersion={currentVersion}
                onChange={setLeft}
              />
              <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden />
              <VersionSelect
                label="Compare to"
                value={right}
                versions={versions}
                currentVersion={currentVersion}
                onChange={setRight}
              />
            </span>
          </header>

          <div className="max-h-[60vh] overflow-y-auto p-3">
            {left === right ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Pick two different versions to compare.
              </p>
            ) : (
              <DiffTable
                before={leftSchema}
                after={rightSchema}
                changes={diff}
                leftLabel={`v${left}`}
                rightLabel={right === currentVersion ? "current" : `v${right}`}
              />
            )}
          </div>
        </section>
      </div>

      {/* ── Restore confirmation ──────────────────────────── */}
      <Dialog open={Boolean(restoring)} onOpenChange={(open) => !open && setRestoring(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restore v{restoring?.version}?</DialogTitle>
            <DialogDescription>
              The schema goes back to how it looked at v{restoring?.version}.
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              This is recorded as a <strong className="text-foreground">new version</strong>{" "}
              (v{currentVersion + 1}). Nothing in the history is deleted or rewritten.
            </li>
            <li>
              <strong className="text-foreground">Item data is not reverted.</strong> Values that
              a past change converted or moved to orphaned data stay exactly where they are —
              restoring the shape of a schema cannot un-migrate the records inside it.
            </li>
            <li>
              If restoring removes a field that items still hold values for, those values move
              to orphaned data rather than being deleted.
            </li>
          </ul>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRestoring(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={restore} disabled={pending}>
              {pending ? "Restoring…" : `Restore v${restoring?.version}`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Version picker ───────────────────────────────────────────
function VersionSelect({
  label,
  value,
  versions,
  currentVersion,
  onChange,
}: {
  label: string;
  value: number;
  versions: VersionEntry[];
  currentVersion: number;
  onChange: (version: number) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className="h-7 rounded-md border border-input bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {versions.map((entry) => (
        <option key={entry.id} value={entry.version}>
          v{entry.version}
          {entry.version === currentVersion ? " (current)" : ""}
        </option>
      ))}
    </select>
  );
}

// ── Field-level diff ─────────────────────────────────────────
type Row = {
  key: string;
  before: EffectiveField | undefined;
  after: EffectiveField | undefined;
  status: "same" | "changed" | "added" | "removed";
  detail: string[];
};

const MARK: Record<Row["status"], { glyph: string; tone: string }> = {
  same: { glyph: "═", tone: "text-muted-foreground/40" },
  changed: { glyph: "~", tone: "text-warning" },
  added: { glyph: "+", tone: "text-primary" },
  removed: { glyph: "−", tone: "text-destructive" },
};

function DiffTable({
  before,
  after,
  changes,
  leftLabel,
  rightLabel,
}: {
  before: EffectiveField[];
  after: EffectiveField[];
  changes: SchemaChange[];
  leftLabel: string;
  rightLabel: string;
}) {
  const rows = useMemo<Row[]>(() => {
    const beforeByKey = new Map(before.map((field) => [field.key, field]));
    const afterByKey = new Map(after.map((field) => [field.key, field]));

    // Which properties differ, per key — taken from diffSchemas so the
    // "changed" annotation and the impact dialog cannot drift apart.
    const detailByKey = new Map<string, string[]>();
    for (const change of changes) {
      if (change.kind === "add_field" || change.kind === "remove_field") continue;
      const list = detailByKey.get(change.field_key) ?? [];
      list.push(change.kind.replace(/_/g, " "));
      detailByKey.set(change.field_key, list);
    }

    const keys = [...new Set([...before.map((f) => f.key), ...after.map((f) => f.key)])];

    return keys.map((key) => {
      const prev = beforeByKey.get(key);
      const next = afterByKey.get(key);
      const detail = detailByKey.get(key) ?? [];
      const status: Row["status"] = !prev
        ? "added"
        : !next
          ? "removed"
          : detail.length > 0
            ? "changed"
            : "same";
      return { key, before: prev, after: next, status, detail };
    });
  }, [before, after, changes]);

  const changedCount = rows.filter((row) => row.status !== "same").length;

  return (
    <div className="space-y-2">
      <p className="px-1 text-[11px] text-muted-foreground">
        {changedCount === 0
          ? "These two versions have identical schemas."
          : `${changedCount} field${changedCount === 1 ? "" : "s"} differ between ${leftLabel} and ${rightLabel}.`}
      </p>

      <table className="w-full table-fixed text-xs">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-[46%] px-2 py-1 font-medium">{leftLabel}</th>
            <th className="w-8 px-1 py-1 text-center font-medium" aria-label="Change" />
            <th className="px-2 py-1 font-medium">{rightLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const mark = MARK[row.status];
            return (
              <tr key={row.key} className="border-b border-border/40 last:border-0 align-top">
                <td className="px-2 py-1.5">
                  <FieldCell field={row.before} muted={row.status === "added"} />
                </td>
                <td className={cn("px-1 py-1.5 text-center font-mono", mark.tone)}>
                  {mark.glyph}
                </td>
                <td className="px-2 py-1.5">
                  <FieldCell field={row.after} muted={row.status === "removed"} />
                  {row.detail.length > 0 && (
                    <span className="block text-[10px] text-warning">
                      ← {row.detail.join(", ")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldCell({ field, muted }: { field: EffectiveField | undefined; muted: boolean }) {
  if (!field) return <span className="text-muted-foreground/30">—</span>;
  return (
    <span className={cn("flex flex-wrap items-baseline gap-1.5", muted && "opacity-40")}>
      <code className="text-foreground">{field.key}</code>
      <span className="text-muted-foreground">{field.type}</span>
      {field.required && <span className="text-destructive">required</span>}
      {field.inherited && (
        <span className="text-[10px] text-muted-foreground/70">
          ({field.source_category_name})
        </span>
      )}
    </span>
  );
}

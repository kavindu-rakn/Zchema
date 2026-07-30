"use client";

// ── Schema composition editor ────────────────────────────────
// Where inheritance becomes visible and editable. Two columns: what
// this category inherits and what it defines on the left, and on the
// right the actual form a Data Editor will see — rendered by the same
// <DynamicForm> the Items tab uses, so the preview cannot drift.
//
// The preview is recomputed locally from draft state via
// resolveEffectiveSchema(), the pure mirror of the SQL resolver. That
// is what makes edits feel immediate without a round trip.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import {
  AlertTriangle,
  ChevronDown,
  CornerDownRight,
  GripVertical,
  Layers,
  Lock,
  Link2,
  Plus,
  RotateCcw,
  Tags,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DynamicForm } from "@/components/data-center/dynamic-form";
import { OptionsEditor } from "@/components/data-center/options-editor";
import { FieldProvenance } from "@/components/data-center/field-provenance";
import { ImpactDialog } from "@/components/data-center/impact-dialog";
import { Hint } from "@/components/onboarding/hint";
import { AttributePicker } from "@/components/attributes/attribute-picker";
import { SaveAsBlueprint } from "@/components/blueprints/save-as-blueprint";
import {
  analyzeSchemaChange,
  applySchemaChange,
  rollbackSchemaVersion,
} from "@/app/(dashboard)/data-center/actions";
import { resolveEffectiveSchema, slugify, validateFieldKey } from "@/lib/schema";
import { cn } from "@/lib/utils";
import type {
  Category,
  EffectiveField,
  FieldOverride,
  FieldType,
  Remediation,
  SchemaField,
  SchemaImpact,
} from "@/lib/types";

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

/** Properties a descendant is allowed to patch. */
const OVERRIDE_LABELS: { key: keyof FieldOverride; label: string }[] = [
  { key: "label", label: "Label" },
  { key: "required", label: "Required" },
  { key: "help_text", label: "Help text" },
];

type DraftField = SchemaField & { _uid: string; _locked: boolean };

let uidCounter = 0;
function nextUid(): string {
  uidCounter += 1;
  return `draft-${uidCounter}`;
}

function toDraft(fields: SchemaField[]): DraftField[] {
  return fields.map((field) => ({ ...field, _uid: nextUid(), _locked: true }));
}

function stripDraft(fields: DraftField[]): SchemaField[] {
  return fields.map(({ _uid, _locked, ...field }, index) => ({ ...field, position: index }));
}

/** key from label: "Screen Size" → "screen_size" */
function deriveKey(label: string): string {
  return slugify(label).replace(/-/g, "_");
}

export function SchemaEditor({
  category,
  chain,
  canEdit,
  dismissedHints = [],
}: {
  category: Category;
  /** Ancestors root-first, INCLUDING this category last. */
  chain: Pick<Category, "id" | "name" | "own_fields" | "overrides">[];
  canEdit: boolean;
  /** Onboarding hints this user has already dismissed. */
  dismissedHints?: string[];
}) {
  const router = useRouter();
  const [ownFields, setOwnFields] = useState<DraftField[]>(() =>
    toDraft(category.own_fields ?? [])
  );
  const [overrides, setOverrides] = useState<Record<string, FieldOverride>>(
    () => category.overrides ?? {}
  );
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingOverride, setEditingOverride] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pickingAttribute, setPickingAttribute] = useState(false);
  const [pending, startTransition] = useTransition();

  // Live impact analysis. The user should feel the risk building AS
  // THEY TYPE rather than discover it at the end, so the severity badge
  // on the review button is driven by a debounced round trip rather
  // than by opening the dialog.
  const [impact, setImpact] = useState<SchemaImpact | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // The schema as currently drafted — drives the live preview.
  const live = useMemo(() => {
    const draftChain = chain.map((node, index) =>
      index === chain.length - 1
        ? { ...node, own_fields: stripDraft(ownFields), overrides }
        : node
    );
    return resolveEffectiveSchema(draftChain);
  }, [chain, ownFields, overrides]);

  const inherited = live.filter((field) => field.inherited);
  const own = live.filter((field) => !field.inherited);

  const dirty = useMemo(
    () =>
      JSON.stringify(stripDraft(ownFields)) !== JSON.stringify(category.own_fields ?? []) ||
      JSON.stringify(overrides) !== JSON.stringify(category.overrides ?? {}),
    [ownFields, overrides, category]
  );

  // Browser-level guard. Next's App Router has no navigation blocker,
  // so this covers reloads and closing the tab.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ── Validation ─────────────────────────────────────────────
  const inheritedByKey = useMemo(
    () => new Map(inherited.map((field) => [field.key, field])),
    [inherited]
  );

  const errorFor = useCallback(
    (field: DraftField, index: number): string | null => {
      if (!field.label.trim()) return "A label is required.";
      const keyError = validateFieldKey(field.key);
      if (keyError) return keyError;

      const clash = inheritedByKey.get(field.key);
      if (clash) {
        // Name WHERE the conflict is — "duplicate key" alone sends the
        // user hunting through the whole chain.
        return `“${field.key}” is already defined by ${clash.source_category_name}. Override it instead of redefining it.`;
      }
      const duplicate = ownFields.findIndex((other) => other.key === field.key);
      if (duplicate !== -1 && duplicate !== index) {
        return `“${field.key}” is defined twice on this category.`;
      }
      if (
        (field.type === "select" || field.type === "multiselect") &&
        !field.options?.length
      ) {
        return `A ${field.type} field needs at least one option.`;
      }
      return null;
    },
    [inheritedByKey, ownFields]
  );

  const errors = ownFields.map(errorFor);
  const hasErrors = errors.some(Boolean);

  // ── Live impact analysis ───────────────────────────────────
  // Debounced at 400ms and serialised by a generation counter: typing
  // fires several requests and they can land out of order, so a stale
  // response must never overwrite a newer one.
  const draftKey = useMemo(
    () => JSON.stringify({ fields: stripDraft(ownFields), overrides }),
    [ownFields, overrides]
  );

  useEffect(() => {
    let live = true;

    const timer = setTimeout(async () => {
      if (!live) return;

      // An incomplete or invalid draft has nothing meaningful to
      // measure — the editor's own errors are the better signal.
      if (!canEdit || !dirty || hasErrors) {
        setImpact(null);
        setAnalysisError(null);
        setAnalyzing(false);
        return;
      }

      setAnalyzing(true);
      const { fields, overrides: draftOverrides } = JSON.parse(draftKey) as {
        fields: SchemaField[];
        overrides: Record<string, FieldOverride>;
      };
      const result = await analyzeSchemaChange(category.id, {
        own_fields: fields,
        overrides: draftOverrides,
      });
      if (!live) return;

      if (result.ok) {
        setImpact(result.data);
        setAnalysisError(null);
      } else {
        setImpact(null);
        setAnalysisError(result.error);
      }
      setAnalyzing(false);
    }, 400);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [canEdit, dirty, hasErrors, draftKey, category.id]);

  // ── Mutators ───────────────────────────────────────────────
  const patchField = (uid: string, patch: Partial<DraftField>) =>
    setOwnFields((previous) =>
      previous.map((field) => (field._uid === uid ? { ...field, ...patch } : field))
    );

  const addField = () =>
    setOwnFields((previous) => [
      ...previous,
      {
        _uid: nextUid(),
        _locked: false,
        key: "",
        label: "",
        type: "string",
        required: false,
        position: previous.length,
      },
    ]);

  const removeField = (uid: string) =>
    setOwnFields((previous) => previous.filter((field) => field._uid !== uid));

  /**
   * Insert fields pulled from the attribute library.
   *
   * The picker already disables anything the effective chain provides,
   * but a second guard here is cheap and covers the case where the
   * draft gained a key since the picker opened.
   */
  const addFromLibrary = (fields: SchemaField[]) => {
    setOwnFields((previous) => {
      const existing = new Set([
        ...previous.map((field) => field.key),
        ...inherited.map((field) => field.key),
      ]);
      const fresh = fields.filter((field) => !existing.has(field.key));
      const skipped = fields.length - fresh.length;

      if (fresh.length === 0) {
        toast.error("Every one of those is already in this category's schema.");
        return previous;
      }
      if (skipped > 0) {
        toast.warning(
          `Added ${fresh.length}; skipped ${skipped} already present in this category's chain.`
        );
      }

      return [
        ...previous,
        ...fresh.map((field, index) => ({
          ...field,
          _uid: nextUid(),
          // Not locked: the field has never been saved, so its key is
          // still safe to change.
          _locked: false,
          position: previous.length + index,
        })),
      ];
    });
  };

  const startOverride = (field: EffectiveField) => {
    setOverrides((previous) => ({
      ...previous,
      [field.key]: previous[field.key] ?? {},
    }));
    setEditingOverride(field.key);
  };

  const revertOverride = (key: string) => {
    setOverrides((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
    if (editingOverride === key) setEditingOverride(null);
  };

  const patchOverride = (key: string, patch: FieldOverride) =>
    setOverrides((previous) => ({ ...previous, [key]: { ...previous[key], ...patch } }));

  const discard = () => {
    setOwnFields(toDraft(category.own_fields ?? []));
    setOverrides(category.overrides ?? {});
    setEditingOverride(null);
  };

  /**
   * Apply the draft with the remediations chosen in the dialog.
   *
   * Resolves false on failure so the dialog stays open with the user's
   * choices intact — a failed migration should not cost them the work
   * of deciding what happens to each field.
   */
  const apply = (remediations: Record<string, Remediation>): Promise<boolean> =>
    new Promise((resolve) => {
      startTransition(async () => {
        const result = await applySchemaChange(category.id, {
          own_fields: stripDraft(ownFields),
          overrides,
          remediations,
        });

        if (!result.ok) {
          toast.error(result.error);
          resolve(false);
          return;
        }

        const { version, items_updated, items_orphaned, items_incomplete } = result.data;
        const parts = [`v${version}`];
        if (items_updated) parts.push(`${items_updated} item${items_updated === 1 ? "" : "s"} updated`);
        if (items_orphaned) parts.push(`${items_orphaned} orphaned`);
        if (items_incomplete) parts.push(`${items_incomplete} incomplete`);

        toast.success("Schema applied", {
          description: parts.join(" · "),
          // Undo restores the schema, NOT the item data — say so rather
          // than let the word "undo" imply more than it delivers.
          action:
            version > 1
              ? {
                  label: "Undo",
                  onClick: async () => {
                    const undone = await rollbackSchemaVersion(category.id, version - 1);
                    if (!undone.ok) {
                      toast.error(undone.error);
                      return;
                    }
                    toast.success(`Restored v${version - 1} as v${undone.data.version}`, {
                      description: "Schema only — item values already migrated stay as they are.",
                    });
                    router.refresh();
                  },
                }
              : undefined,
        });

        setImpact(null);
        resolve(true);
        router.refresh();
      });
    });

  // Severity badge on the review button. Only `safe` is left silent —
  // a badge that is always lit stops being a signal.
  const destructiveCount =
    impact?.changes.filter((change) => change.severity === "destructive").length ?? 0;
  const warningCount =
    impact?.changes.filter((change) => change.severity === "warning").length ?? 0;
  const severity =
    destructiveCount > 0 ? "destructive" : warningCount > 0 ? "warning" : null;

  // ── Grouping ───────────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; fields: EffectiveField[] }>();
    for (const field of inherited) {
      const entry = map.get(field.source_category_id) ?? {
        name: field.source_category_name,
        fields: [],
      };
      entry.fields.push(field);
      map.set(field.source_category_id, entry);
    }
    return [...map.entries()];
  }, [inherited]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-foreground">
          Schema · <span className="text-muted-foreground">{category.name}</span>
        </h2>
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">{live.length}</strong> field
          {live.length === 1 ? "" : "s"} ({inherited.length} inherited · {own.length} own)
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {/* The entire tutorial: one line, pointing at something
              already on screen. A hint that explains a concept you
              cannot see is a tour, and tours get skipped. */}
          {inherited.length > 0 && (
            <Hint hintKey="inherited-block" dismissed={dismissedHints} tone="primary">
              These <strong>{inherited.length} fields</strong> are not defined here — they come
              from {groups.map(([, group]) => group.name).join(" and ")}, further up the tree.
              Add a field below and only {category.name} and its descendants get it; the rest of
              the tree is untouched.
            </Hint>
          )}

          {/* ── Inherited ─────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center gap-2 border-b border-border px-4 py-2">
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Inherited
              </h3>
              <span className="text-xs text-muted-foreground">({inherited.length})</span>
            </header>

            {groups.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                Nothing inherited — this is a root category.
              </p>
            ) : (
              groups.map(([sourceId, group]) => {
                const isCollapsed = collapsed.has(sourceId);
                return (
                  <div key={sourceId} className="border-b border-border/60 last:border-0">
                    <div className="flex items-center gap-2 px-4 py-2">
                      <button
                        type="button"
                        aria-expanded={!isCollapsed}
                        onClick={() =>
                          setCollapsed((previous) => {
                            const next = new Set(previous);
                            if (next.has(sourceId)) next.delete(sourceId);
                            else next.add(sourceId);
                            return next;
                          })
                        }
                        className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <ChevronDown
                          className={cn("h-3.5 w-3.5 transition-transform", isCollapsed && "-rotate-90")}
                        />
                      </button>
                      <span className="text-xs text-muted-foreground">from</span>
                      <Link
                        href={`/data-center/${sourceId}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {group.name}
                      </Link>
                    </div>

                    {!isCollapsed && (
                      <ul className="space-y-0.5 pb-2">
                        {group.fields.map((field) => {
                          const patch = overrides[field.key];
                          const isOverridden = Boolean(patch);
                          const patched = Object.keys(patch ?? {}).filter(
                            (key) => (patch as Record<string, unknown>)[key] !== undefined
                          );

                          return (
                            <li key={field.key} className="px-4">
                              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40">
                                {isOverridden && (
                                  <span
                                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
                                    aria-hidden
                                  />
                                )}
                                <FieldProvenance chain={chain} fieldKey={field.key}>
                                  <button
                                    type="button"
                                    title="Where did this come from?"
                                    className="flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  >
                                    <code className="shrink-0 text-xs text-foreground underline decoration-dotted underline-offset-2">
                                      {field.key}
                                    </code>
                                    <span className="truncate text-xs text-muted-foreground">
                                      {field.label}
                                    </span>
                                  </button>
                                </FieldProvenance>
                                <span className="shrink-0 text-[11px] text-muted-foreground">
                                  {field.type}
                                </span>
                                {field.required && (
                                  <span className="shrink-0 text-[11px] text-destructive">
                                    required
                                  </span>
                                )}

                                {canEdit && (
                                  <span className="ml-auto flex shrink-0 items-center gap-1">
                                    {isOverridden ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setEditingOverride(
                                              editingOverride === field.key ? null : field.key
                                            )
                                          }
                                          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-background hover:text-foreground"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          type="button"
                                          aria-label={`Revert override on ${field.key}`}
                                          title="Revert to inherited"
                                          onClick={() => revertOverride(field.key)}
                                          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                                        >
                                          <RotateCcw className="h-3 w-3" />
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        aria-label={`Override ${field.key} here`}
                                        title="Override here"
                                        onClick={() => startOverride(field)}
                                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
                                      >
                                        <CornerDownRight className="h-3 w-3" />
                                      </button>
                                    )}
                                  </span>
                                )}
                              </div>

                              {isOverridden && patched.length > 0 && (
                                <p className="px-2 pb-1 text-[11px] text-warning">
                                  overridden here: {patched.join(", ")}
                                </p>
                              )}

                              {editingOverride === field.key && (
                                <div className="mb-2 space-y-2 rounded-md border border-border bg-background p-3">
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <label className="space-y-1">
                                      <span className="text-[11px] text-muted-foreground">Label</span>
                                      <input
                                        value={patch?.label ?? field.label}
                                        onChange={(event) =>
                                          patchOverride(field.key, { label: event.target.value })
                                        }
                                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      />
                                    </label>

                                    <label className="space-y-1">
                                      <span className="text-[11px] text-muted-foreground">
                                        Help text
                                      </span>
                                      <input
                                        value={patch?.help_text ?? field.help_text ?? ""}
                                        onChange={(event) =>
                                          patchOverride(field.key, {
                                            help_text: event.target.value,
                                          })
                                        }
                                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      />
                                    </label>

                                    {/* key and type are NOT patchable */}
                                    <Tooltip>
                                      <TooltipTrigger
                                        render={
                                          <label className="space-y-1 text-left">
                                            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                              <Lock className="h-2.5 w-2.5" />
                                              Type
                                            </span>
                                            <input
                                              disabled
                                              value={field.type}
                                              className="h-8 w-full cursor-not-allowed rounded-md border border-border bg-muted px-2 text-xs text-muted-foreground"
                                            />
                                          </label>
                                        }
                                      />
                                      <TooltipContent>
                                        Type is fixed by {field.source_category_name}. Changing it
                                        would invalidate stored item data.
                                      </TooltipContent>
                                    </Tooltip>

                                    <label className="flex items-end gap-2 pb-1">
                                      <input
                                        type="checkbox"
                                        checked={patch?.required ?? field.required}
                                        onChange={(event) =>
                                          patchOverride(field.key, {
                                            required: event.target.checked,
                                          })
                                        }
                                        className="h-3.5 w-3.5 rounded border-border"
                                      />
                                      <span className="text-xs text-foreground">Required here</span>
                                    </label>
                                  </div>

                                  {(field.type === "select" || field.type === "multiselect") && (
                                    <div className="space-y-1">
                                      <span className="text-[11px] text-muted-foreground">
                                        Options
                                      </span>
                                      <OptionsEditor
                                        options={patch?.options ?? field.options ?? []}
                                        onChange={(options) =>
                                          patchOverride(field.key, { options })
                                        }
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })
            )}
          </section>

          {/* ── Defined here ──────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card">
            <header className="flex items-center gap-2 border-b border-border px-4 py-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Defined here
              </h3>
              <span className="text-xs text-muted-foreground">({ownFields.length})</span>
            </header>

            {ownFields.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                No fields of its own yet. Add one to extend what it inherits.
              </p>
            ) : (
              <Reorder.Group
                axis="y"
                values={ownFields}
                onReorder={setOwnFields}
                className="space-y-1 p-2"
              >
                {ownFields.map((field, index) => (
                  <FieldRow
                    key={field._uid}
                    field={field}
                    error={errors[index]}
                    canEdit={canEdit}
                    onPatch={(patch) => patchField(field._uid, patch)}
                    onRemove={() => removeField(field._uid)}
                  />
                ))}
              </Reorder.Group>
            )}

            {canEdit && (
              <div className="flex flex-wrap gap-2 border-t border-border px-4 py-3">
                <Button size="sm" variant="outline" onClick={addField}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add field
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPickingAttribute(true)}>
                  <Tags className="mr-1.5 h-3.5 w-3.5" />
                  From attribute library
                </Button>
                <SaveAsBlueprint
                  categoryId={category.id}
                  categoryName={category.name}
                  ownFields={stripDraft(ownFields)}
                />
              </div>
            )}
          </section>
        </div>

        {/* ── Live preview ────────────────────────────────── */}
        <aside className="min-w-0">
          <div className="sticky top-4 rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Preview
              </h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                The form a Data Editor will see
              </p>
            </header>

            <div className="max-h-[60vh] overflow-y-auto p-4">
              <DynamicForm schema={live} disabled showProvenance />
            </div>

            <footer className="flex flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-0.5 bg-muted-foreground/30" aria-hidden />
                inherited
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-0.5 bg-primary/70" aria-hidden />
                defined here
              </span>
            </footer>
          </div>
        </aside>
      </div>

      {/* ── Save bar ──────────────────────────────────────── */}
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-xs text-muted-foreground">
            {dirty ? "Unsaved changes" : "No changes"}
            {hasErrors && <span className="ml-2 text-destructive">· fix errors to continue</span>}
          </p>
          <div className="flex items-center gap-2">
            {/* The risk is visible BEFORE the dialog is opened. */}
            {severity && (
              <span
                className={cn(
                  "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                  severity === "destructive"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-warning/10 text-warning"
                )}
              >
                <AlertTriangle className="h-3 w-3" />
                {destructiveCount > 0
                  ? `${destructiveCount} destructive`
                  : `${warningCount} warning${warningCount === 1 ? "" : "s"}`}
              </span>
            )}
            <Button variant="ghost" size="sm" onClick={discard} disabled={!dirty || pending}>
              Discard
            </Button>
            <Button
              size="sm"
              onClick={() => setReviewOpen(true)}
              disabled={!dirty || hasErrors || pending}
            >
              Review changes →
            </Button>
          </div>
        </div>
      )}

      <AttributePicker
        open={pickingAttribute}
        onOpenChange={setPickingAttribute}
        schema={live}
        onAdd={addFromLibrary}
      />

      <ImpactDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        categoryId={category.id}
        categoryName={category.name}
        schema={live}
        impact={impact}
        analyzing={analyzing}
        analysisError={analysisError}
        pending={pending}
        onApply={apply}
      />
    </div>
  );
}

// ── One authored field ───────────────────────────────────────
function FieldRow({
  field,
  error,
  canEdit,
  onPatch,
  onRemove,
}: {
  field: DraftField;
  error: string | null;
  canEdit: boolean;
  onPatch: (patch: Partial<DraftField>) => void;
  onRemove: () => void;
}) {
  const controls = useDragControls();

  return (
    <Reorder.Item
      value={field}
      dragListener={false}
      dragControls={controls}
      className="rounded-md border border-border bg-background"
    >
      <div className="flex items-center gap-2 p-2">
        {canEdit && (
          <button
            type="button"
            aria-label={`Reorder ${field.label || "field"}`}
            onPointerDown={(event) => controls.start(event)}
            className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}

        <input
          value={field.label}
          disabled={!canEdit}
          onChange={(event) => {
            const label = event.target.value;
            // The key follows the label until the field has been saved
            // once; after that it is locked, because item data is keyed
            // on it.
            onPatch(field._locked ? { label } : { label, key: deriveKey(label) });
          }}
          placeholder="Field label"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex shrink-0 items-center gap-1">
          {/* Linked to the shared registry — editing the attribute
              updates this field too, which is worth knowing before
              someone edits the label here and wonders why it moved. */}
          {field.attribute_id && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    href={`/data-center/attributes/${field.attribute_id}`}
                    aria-label={`View the shared ${field.key} attribute`}
                    className="flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-primary/10"
                  >
                    <Link2 className="h-3 w-3" />
                  </Link>
                }
              />
              <TooltipContent>
                Linked to the shared “{field.key}” attribute. Its label, options and unit are
                managed in the attribute library.
              </TooltipContent>
            </Tooltip>
          )}

          {field._locked ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <code className="flex items-center gap-1 rounded bg-muted px-1.5 py-1 text-[11px] text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" />
                    {field.key}
                  </code>
                }
              />
              <TooltipContent>
                The key is locked once saved — item data is stored against it.
              </TooltipContent>
            </Tooltip>
          ) : (
            <input
              value={field.key}
              disabled={!canEdit}
              onChange={(event) => onPatch({ key: event.target.value })}
              placeholder="key"
              className="h-8 w-28 rounded-md border border-border bg-background px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}

          <select
            value={field.type}
            disabled={!canEdit}
            onChange={(event) => onPatch({ type: event.target.value as FieldType })}
            className="h-8 rounded-md border border-border bg-background px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {FIELD_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-1 px-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={field.required}
              disabled={!canEdit}
              onChange={(event) => onPatch({ required: event.target.checked })}
              className="h-3.5 w-3.5 rounded border-border"
            />
            req
          </label>

          {canEdit && (
            <button
              type="button"
              aria-label={`Delete ${field.label || "field"}`}
              onClick={onRemove}
              className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {(field.type === "select" || field.type === "multiselect") && (
        <div className="border-t border-border px-2 pb-2 pt-2">
          <OptionsEditor
            options={field.options ?? []}
            onChange={(options) => onPatch({ options })}
          />
        </div>
      )}

      {error && <p className="px-2 pb-2 text-[11px] text-destructive">{error}</p>}
    </Reorder.Item>
  );
}

"use client";

// ── Step 3 · Destination and mapping ─────────────────────────
// Where the rows land, and — when they land somewhere that already has
// a schema — which incoming column writes into which existing field.
//
// The mapping table is shown EXPLICITLY and is fully editable. Matching
// `Brand` onto an inherited `brand` is the difference between an import
// that becomes instantly searchable across the catalog and one that
// quietly creates a second, unrelated brand field beside the first. A
// guess that good is still a guess, so it is proposed, never applied
// silently.

import { Loader2, Link2, Plus } from "lucide-react";

import { iconFor } from "@/components/data-center/category-icons";
import { cn } from "@/lib/utils";
import type { Destination } from "@/components/import/import-wizard";
import type { ColumnPlan } from "@/lib/import";
import type { CategoryNode, EffectiveField } from "@/lib/types";

function flatten(nodes: CategoryNode[], depth = 0): { node: CategoryNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children, depth + 1)]);
}

export function DestinationStep({
  tree,
  destination,
  onChange,
  plans,
  targetSchema,
  onPlansChange,
  loading,
}: {
  tree: CategoryNode[];
  destination: Destination;
  onChange: (destination: Destination) => void;
  plans: ColumnPlan[];
  targetSchema: EffectiveField[];
  onPlansChange: (plans: ColumnPlan[]) => void;
  loading: boolean;
}) {
  const rows = flatten(tree);
  const active = plans.filter((plan) => !plan.skip);
  const needsParent = destination.mode === "new-child";
  const needsCategory = destination.mode === "existing";

  const remap = (header: string, key: string | null) =>
    onPlansChange(
      plans.map((plan) => {
        if (plan.header !== header) return plan;
        if (!key) return { ...plan, mappedTo: null };
        const match = targetSchema.find((field) => field.key === key);
        if (!match) return { ...plan, mappedTo: null };
        return {
          ...plan,
          mappedTo: match.inherited ? "inherited" : "own",
          field: { ...plan.field, key: match.key, type: match.type, label: match.label },
        };
      })
    );

  const options: { value: Destination["mode"]; label: string; hint: string }[] = [
    { value: "new-root", label: "A new top-level category", hint: "Nothing is inherited." },
    {
      value: "new-child",
      label: "A new category under an existing one",
      hint: "Inherits that parent's fields.",
    },
    {
      value: "existing",
      label: "An existing category",
      hint: "Rows are added alongside what is already there.",
    },
  ];

  return (
    <div className="space-y-4">
      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium text-foreground">Where should these go?</legend>
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2",
              destination.mode === option.value
                ? "border-primary/50 bg-accent/40"
                : "border-border"
            )}
          >
            <input
              type="radio"
              name="destination-mode"
              checked={destination.mode === option.value}
              onChange={() =>
                onChange({ ...destination, mode: option.value, categoryId: null, parentId: null })
              }
              className="mt-1 h-3.5 w-3.5"
            />
            <span className="min-w-0">
              <span className="block text-sm text-foreground">{option.label}</span>
              <span className="block text-xs text-muted-foreground">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {(destination.mode === "new-root" || destination.mode === "new-child") && (
        <label className="block space-y-1">
          <span className="text-sm text-foreground">Category name</span>
          <input
            value={destination.name}
            onChange={(event) => onChange({ ...destination, name: event.target.value })}
            placeholder="Laptops"
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
      )}

      {(needsParent || needsCategory) && (
        <div className="space-y-1">
          <span className="text-sm text-foreground">
            {needsParent ? "Parent category" : "Target category"}
          </span>
          <div className="max-h-48 overflow-y-auto rounded-md border border-border">
            {rows.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">
                There are no categories yet — pick “a new top-level category” instead.
              </p>
            ) : (
              rows.map(({ node, depth }) => {
                const Icon = iconFor(node.icon);
                const chosen =
                  needsParent ? destination.parentId === node.id : destination.categoryId === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...destination,
                        parentId: needsParent ? node.id : null,
                        categoryId: needsCategory ? node.id : null,
                      })
                    }
                    style={{ paddingLeft: `${12 + depth * 16}px` }}
                    className={cn(
                      "flex w-full items-center gap-2 py-2 pr-3 text-left text-sm transition-colors hover:bg-accent",
                      chosen && "bg-accent"
                    )}
                  >
                    <Icon
                      className="h-3.5 w-3.5 shrink-0"
                      style={node.color ? { color: node.color } : undefined}
                    />
                    <span className="truncate">{node.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                      {node.item_count} item{node.item_count === 1 ? "" : "s"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Working out which columns already exist…
        </p>
      )}

      {/* ── Mapping ─────────────────────────────────────────── */}
      {targetSchema.length > 0 && !loading && (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-medium text-foreground">Column mapping</h3>
            <p className="text-xs text-muted-foreground">
              A column matched to an existing field writes into it. Anything left as “new field”
              is added to this category.
            </p>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-1 pr-2 font-medium">From the file</th>
                <th className="py-1 font-medium">Writes into</th>
              </tr>
            </thead>
            <tbody>
              {active.map((plan) => (
                <tr key={plan.header} className="border-b border-border/40 last:border-0">
                  <td className="py-1.5 pr-2 align-middle">
                    <code className="text-xs text-foreground">{plan.header}</code>
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      {plan.field.type}
                    </span>
                  </td>
                  <td className="py-1.5 align-middle">
                    <span className="flex items-center gap-1.5">
                      {plan.mappedTo ? (
                        <Link2 className="h-3 w-3 shrink-0 text-primary" />
                      ) : (
                        <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                      )}
                      <select
                        value={plan.mappedTo ? plan.field.key : ""}
                        onChange={(event) => remap(plan.header, event.target.value || null)}
                        aria-label={`Map ${plan.header}`}
                        className="h-7 w-full max-w-xs rounded border border-input bg-background px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">＋ Create a new field</option>
                        {targetSchema.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label} ({field.type})
                            {field.inherited ? ` — inherited from ${field.source_category_name}` : ""}
                          </option>
                        ))}
                      </select>
                    </span>

                    {/* A type mismatch is the one thing worth shouting
                        about: the values will be coerced into the
                        EXISTING field's type, not the inferred one. */}
                    {plan.mappedTo &&
                      targetSchema.find((field) => field.key === plan.field.key)?.type !==
                        plan.field.type && (
                        <span className="block pl-4.5 text-[11px] text-warning">
                          Values will be stored as{" "}
                          {targetSchema.find((f) => f.key === plan.field.key)?.type}.
                        </span>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

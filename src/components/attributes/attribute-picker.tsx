"use client";

// ── Pull attributes into a category ──────────────────────────
// Grouped, searchable, multi-select.
//
// The part worth getting right is the refusal. A key already present
// anywhere in the effective chain cannot be added — the database
// trigger would reject it — so those rows are disabled and say WHICH
// category already provides the field. "3 skipped" with no explanation
// is the failure mode this avoids.

import { useEffect, useMemo, useState } from "react";
import { Check, Layers, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listAttributes } from "@/app/(dashboard)/data-center/attributes/actions";
import { cn } from "@/lib/utils";
import type { Attribute, EffectiveField, SchemaField } from "@/lib/types";

const UNGROUPED = "Ungrouped";

export function AttributePicker({
  open,
  onOpenChange,
  /** The category's current effective schema — what is already taken. */
  schema,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: EffectiveField[];
  onAdd: (fields: SchemaField[]) => void;
}) {
  const [attributes, setAttributes] = useState<Attribute[] | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;

    (async () => {
      if (!open) {
        setQuery("");
        setChosen(new Set());
        return;
      }
      const result = await listAttributes();
      if (!live) return;
      if (result.ok) setAttributes(result.data);
      else toast.error(result.error);
    })();

    return () => {
      live = false;
    };
  }, [open]);

  /** key → the category already providing it, when taken. */
  const taken = useMemo(
    () => new Map(schema.map((field) => [field.key, field])),
    [schema]
  );

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = (attributes ?? []).filter(
      (attribute) =>
        !needle ||
        attribute.label.toLowerCase().includes(needle) ||
        attribute.key.toLowerCase().includes(needle)
    );

    const map = new Map<string, Attribute[]>();
    for (const attribute of matched) {
      const group = attribute.group_name?.trim() || UNGROUPED;
      map.set(group, [...(map.get(group) ?? []), attribute]);
    }
    return [...map.entries()].sort(([a], [b]) =>
      a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)
    );
  }, [attributes, query]);

  const toggle = (id: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const add = () => {
    const selected = (attributes ?? []).filter((attribute) => chosen.has(attribute.id));

    const fields: SchemaField[] = selected.map((attribute, index) => ({
      key: attribute.key,
      label: attribute.label,
      type: attribute.type,
      required: false,
      options: attribute.options?.length ? attribute.options : undefined,
      help_text: attribute.description ?? undefined,
      unit: attribute.unit ?? undefined,
      position: index,
      attribute_id: attribute.id,
    }));

    onAdd(fields);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Add from the attribute library</DialogTitle>
          <DialogDescription>
            These stay linked: editing the attribute later updates this field too.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search attributes"
              aria-label="Search attributes"
              className="h-9 w-full rounded-md border border-input bg-background pl-7 pr-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {attributes === null ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : attributes.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              The library is empty. Promote a repeated field from Data Center → Attributes.
            </p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              Nothing matches “{query}”.
            </p>
          ) : (
            groups.map(([group, entries]) => (
              <div key={group} className="mb-2">
                <p className="px-2 pb-1 pt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  {group}
                </p>
                <ul className="space-y-0.5">
                  {entries.map((attribute) => {
                    const clash = taken.get(attribute.key);
                    const selected = chosen.has(attribute.id);

                    return (
                      <li key={attribute.id}>
                        <button
                          type="button"
                          disabled={Boolean(clash)}
                          onClick={() => toggle(attribute.id)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                            clash
                              ? "cursor-not-allowed opacity-60"
                              : selected
                                ? "bg-accent"
                                : "hover:bg-accent/50"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                              selected
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-border"
                            )}
                          >
                            {selected && <Check className="h-2.5 w-2.5" />}
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-1.5">
                              <span className="truncate text-sm text-foreground">
                                {attribute.label}
                              </span>
                              <code className="shrink-0 text-[11px] text-muted-foreground">
                                {attribute.key}
                              </code>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {attribute.type}
                              </span>
                            </span>

                            {/* Say WHICH category already provides it —
                                "skipped" alone sends the user hunting. */}
                            {clash && (
                              <span className="block text-[11px] text-warning">
                                {clash.inherited
                                  ? `Already inherited from ${clash.source_category_name}.`
                                  : "Already defined on this category."}
                              </span>
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="h-3 w-3" />
            {chosen.size} selected
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={add} disabled={chosen.size === 0}>
              Add {chosen.size > 0 ? chosen.size : ""} field
              {chosen.size === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

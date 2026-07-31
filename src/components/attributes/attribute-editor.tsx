"use client";

// ── Attribute editor ─────────────────────────────────────────
// Two halves: what the attribute IS, and where it is used.
//
// The design point is what is disabled and why. `key` and `type` are
// locked with the reason stated inline rather than hidden — a control
// that silently isn't there teaches nothing, and the reason ("a global
// retype has no blast radius anyone can assess") is the whole argument
// for the per-category impact flow.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, Info, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OptionsEditor } from "@/components/data-center/options-editor";
import { iconFor } from "@/components/data-center/category-icons";
import {
  deleteAttribute,
  updateAttribute,
} from "@/app/(dashboard)/data-center/attributes/actions";
import type { Attribute, AttributeUsage } from "@/lib/types";

export function AttributeEditor({
  attribute,
  usage,
  canEdit,
}: {
  attribute: Attribute;
  usage: AttributeUsage[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(attribute.label);
  const [unit, setUnit] = useState(attribute.unit ?? "");
  const [description, setDescription] = useState(attribute.description ?? "");
  const [groupName, setGroupName] = useState(attribute.group_name ?? "");
  const [options, setOptions] = useState<string[]>(attribute.options ?? []);
  const [deleting, setDeleting] = useState(false);
  const [pending, startTransition] = useTransition();

  const hasOptions = attribute.type === "select" || attribute.type === "multiselect";
  const categoryCount = usage.length;
  const itemCount = usage.reduce((total, entry) => total + entry.item_count, 0);

  const dirty =
    label !== attribute.label ||
    unit !== (attribute.unit ?? "") ||
    description !== (attribute.description ?? "") ||
    groupName !== (attribute.group_name ?? "") ||
    JSON.stringify(options) !== JSON.stringify(attribute.options ?? []);

  const labelChanged = label !== attribute.label;
  const optionsChanged = JSON.stringify(options) !== JSON.stringify(attribute.options ?? []);
  const removedOptions = (attribute.options ?? []).filter(
    (option) => !options.includes(option)
  );

  const save = () => {
    startTransition(async () => {
      const result = await updateAttribute(attribute.id, {
        label,
        unit,
        description,
        group_name: groupName,
        ...(hasOptions ? { options } : {}),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Attribute saved", {
        description:
          categoryCount > 0
            ? `Propagated to ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"}.`
            : undefined,
      });
      router.refresh();
    });
  };

  const confirmDelete = () => {
    startTransition(async () => {
      const result = await deleteAttribute(attribute.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted “${attribute.label}”`, {
        description:
          categoryCount > 0
            ? `${categoryCount} field${categoryCount === 1 ? "" : "s"} kept their definition — only the link was removed.`
            : undefined,
      });
      setDeleting(false);
      router.push("/data-center/attributes");
      router.refresh();
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      {/* ── Definition ────────────────────────────────────── */}
      <section className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Definition
        </h3>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Label</span>
            <input
              value={label}
              disabled={!canEdit}
              onChange={(event) => setLabel(event.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Group</span>
            <input
              value={groupName}
              disabled={!canEdit}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Physical, Commercial, Media…"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {/* key and type are structural and cannot change */}
          <Tooltip>
            <TooltipTrigger
              render={
                <label className="space-y-1 text-left">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" />
                    Key
                  </span>
                  <input
                    disabled
                    value={attribute.key}
                    className="h-9 w-full cursor-not-allowed rounded-md border border-input bg-muted px-2 font-mono text-xs text-muted-foreground"
                  />
                </label>
              }
            />
            <TooltipContent>
              Item data is stored against this key. Changing it would orphan every value.
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <label className="space-y-1 text-left">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" />
                    Type
                  </span>
                  <input
                    disabled
                    value={attribute.type}
                    className="h-9 w-full cursor-not-allowed rounded-md border border-input bg-muted px-2 text-sm text-muted-foreground"
                  />
                </label>
              }
            />
            <TooltipContent>
              Change the type on a category&apos;s Schema tab instead.
            </TooltipContent>
          </Tooltip>

          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Unit</span>
            <input
              value={unit}
              disabled={!canEdit}
              onChange={(event) => setUnit(event.target.value)}
              placeholder="kg, GB, cm…"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs text-muted-foreground">Help text</span>
            <input
              value={description}
              disabled={!canEdit}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Shown beside the input when someone fills this in"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>

        {hasOptions && (
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Options</span>
            <OptionsEditor options={options} onChange={setOptions} />
          </div>
        )}

        {/* Why the type is locked — stated, not merely disabled. */}
        <p className="flex items-start gap-1.5 rounded-md border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            The type cannot be changed here. It is used by {categoryCount} categor
            {categoryCount === 1 ? "y" : "ies"} holding {itemCount} item
            {itemCount === 1 ? "" : "s"}, and one global retype gives no blast radius anyone
            could assess. Change it on a category&apos;s Schema tab, where the impact is
            measured against that category&apos;s own items.
          </span>
        </p>

        {canEdit && dirty && categoryCount > 0 && (
          <p className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
            <span>
              {labelChanged && (
                <>
                  This label change propagates to {categoryCount} categor
                  {categoryCount === 1 ? "y" : "ies"} immediately.{" "}
                </>
              )}
              {optionsChanged && removedOptions.length > 0 && (
                <>
                  Removing {removedOptions.map((option) => `“${option}”`).join(", ")} leaves any
                  item still holding that value with an option the field no longer allows.
                </>
              )}
              {optionsChanged && removedOptions.length === 0 && (
                <>New options are added everywhere this attribute is used.</>
              )}
            </span>
          </p>
        )}

        {canEdit && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleting(true)}
              disabled={pending || attribute.is_system}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || pending}>
              {pending ? "Saving…" : "Save attribute"}
            </Button>
          </div>
        )}
      </section>

      {/* ── Used by ───────────────────────────────────────── */}
      <aside className="min-w-0">
        <div className="sticky top-4 rounded-lg border border-border bg-card">
          <header className="border-b border-border px-4 py-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Used by
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {categoryCount === 0
                ? "Not referenced by any category yet"
                : `${categoryCount} categor${categoryCount === 1 ? "y" : "ies"} · ${itemCount} item${itemCount === 1 ? "" : "s"}`}
            </p>
          </header>

          {categoryCount === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Pull it into a category from its Schema tab — “From attribute library”.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
              {usage.map((entry) => {
                const Icon = iconFor(entry.category_icon);
                return (
                  <li key={`${entry.category_id}-${entry.field_key}`}>
                    <Link
                      href={`/data-center/${entry.category_id}?tab=schema`}
                      className="flex items-center gap-2 px-4 py-2 transition-colors hover:bg-accent/40"
                    >
                      <Icon
                        className="h-3.5 w-3.5 shrink-0"
                        style={entry.category_color ? { color: entry.category_color } : undefined}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-foreground">
                          {entry.category_name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          <code>{entry.field_key}</code>
                          {entry.required && (
                            <span className="ml-1 text-destructive">required</span>
                          )}
                          {" · "}
                          {entry.item_count} item{entry.item_count === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* ── Delete confirmation ───────────────────────────── */}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete “{attribute.label}”?</DialogTitle>
            <DialogDescription>
              This removes the attribute from the library.
            </DialogDescription>
          </DialogHeader>

          {/* The reasonable fear here is that deleting destroys the
              fields. It does not, and saying so is the whole message. */}
          <div className="rounded-md border border-border bg-card/50 p-3 text-sm text-muted-foreground">
            {categoryCount > 0 ? (
              <>
                <strong className="text-foreground">
                  {categoryCount} categor{categoryCount === 1 ? "y" : "ies"}
                </strong>{" "}
                use this attribute. Every one keeps its field exactly as it is, along with all{" "}
                {itemCount} item value{itemCount === 1 ? "" : "s"} — only the shared link is
                removed. They simply stop being recognised as the same thing.
              </>
            ) : (
              <>No category references this attribute.</>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setDeleting(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              onClick={confirmDelete}
              disabled={pending}
              className="bg-destructive text-white hover:bg-destructive/90"
            >
              {pending ? "Deleting…" : "Delete attribute"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

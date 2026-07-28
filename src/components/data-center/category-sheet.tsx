"use client";

// ── Create / edit a category ─────────────────────────────────
// A sheet rather than a dialog because there is a real choice to make
// here, and because of the panel that matters most: BEFORE the category
// exists, we resolve the parent's effective schema and show exactly
// what the new node will inherit. That single panel teaches the whole
// mental model at the moment the user needs it — you are told what you
// already have before being asked what to add.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Info, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { IconColorPicker } from "@/components/data-center/icon-color-picker";
import { createCategory, updateCategory } from "@/app/(dashboard)/data-center/actions";
import { createClient } from "@/utils/supabase/client";
import { slugify, validateFieldKey } from "@/lib/schema";
import { cn } from "@/lib/utils";
import type {
  Blueprint,
  Category,
  EffectiveField,
  FieldType,
  SchemaField,
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

type StartFrom = "inherited" | "blueprint" | "define";

export interface CategorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Create mode: the parent this category will sit under (null = root). */
  parentId?: string | null;
  parentName?: string | null;
  /** Edit mode: the category being edited. */
  category?: Category | null;
}

export function CategorySheet({
  open,
  onOpenChange,
  parentId = null,
  parentName = null,
  category = null,
}: CategorySheetProps) {
  const router = useRouter();
  const isEdit = Boolean(category);
  const effectiveParentId = isEdit ? category!.parent_id : parentId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [color, setColor] = useState<string | null>(null);
  const [startFrom, setStartFrom] = useState<StartFrom>("inherited");
  const [blueprintId, setBlueprintId] = useState<string>("");
  const [draftFields, setDraftFields] = useState<SchemaField[]>([]);

  const [inherited, setInherited] = useState<EffectiveField[]>([]);
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [siblings, setSiblings] = useState<{ name: string; slug: string; id: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();

  // Reset whenever the sheet opens so a previous edit never leaks in.
  useEffect(() => {
    if (!open) return;
    setName(category?.name ?? "");
    setDescription(category?.description ?? "");
    setIcon(category?.icon ?? null);
    setColor(category?.color ?? null);
    setStartFrom("inherited");
    setBlueprintId("");
    setDraftFields([]);
  }, [open, category]);

  // Resolve what the new node will inherit, plus siblings and presets.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const supabase = createClient();

      const siblingQuery = supabase.from("categories").select("id, name, slug");
      const scoped = effectiveParentId
        ? siblingQuery.eq("parent_id", effectiveParentId)
        : siblingQuery.is("parent_id", null);

      const [schemaRes, blueprintRes, siblingRes] = await Promise.all([
        effectiveParentId
          ? supabase.rpc("get_effective_schema", { p_category_id: effectiveParentId })
          : Promise.resolve({ data: [], error: null }),
        supabase.from("blueprints").select("*").order("name"),
        scoped,
      ]);

      if (cancelled) return;
      setInherited((schemaRes.data ?? []) as EffectiveField[]);
      setBlueprints((blueprintRes.data ?? []) as Blueprint[]);
      setSiblings(
        ((siblingRes.data ?? []) as { id: string; name: string; slug: string }[]).filter(
          (row) => row.id !== category?.id
        )
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, effectiveParentId, category?.id]);

  const slug = useMemo(() => slugify(name), [name]);
  const duplicate = useMemo(
    () =>
      siblings.find(
        (sibling) =>
          sibling.name.toLowerCase() === name.trim().toLowerCase() || sibling.slug === slug
      ),
    [siblings, name, slug]
  );

  const selectedBlueprint = blueprints.find((b) => b.id === blueprintId) ?? null;
  const inheritedKeys = useMemo(() => new Set(inherited.map((f) => f.key)), [inherited]);

  /** Blueprint fields whose key is already inherited cannot be copied. */
  const blueprintConflicts = useMemo(
    () => (selectedBlueprint?.fields ?? []).filter((f) => inheritedKeys.has(f.key)),
    [selectedBlueprint, inheritedKeys]
  );

  const addDraftField = useCallback(() => {
    setDraftFields((previous) => [
      ...previous,
      {
        key: "",
        label: "",
        type: "string",
        required: false,
        position: previous.length,
      },
    ]);
  }, []);

  const ownFieldsToSave = (): SchemaField[] => {
    if (startFrom === "blueprint" && selectedBlueprint) {
      return (selectedBlueprint.fields ?? [])
        .filter((field) => !inheritedKeys.has(field.key))
        .map((field, index) => ({ ...field, position: index }));
    }
    if (startFrom === "define") {
      return draftFields
        .filter((field) => field.label.trim())
        .map((field, index) => ({
          ...field,
          key: field.key || slugify(field.label).replace(/-/g, "_"),
          position: index,
        }));
    }
    return [];
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;

    const fields = isEdit ? undefined : ownFieldsToSave();

    // Validate authored keys before a round trip.
    if (fields) {
      for (const field of fields) {
        const keyError = validateFieldKey(field.key);
        if (keyError) {
          toast.error(keyError);
          return;
        }
        if (inheritedKeys.has(field.key)) {
          const source = inherited.find((f) => f.key === field.key);
          toast.error(
            `“${field.key}” is already defined by ${source?.source_category_name ?? "an ancestor"}.`
          );
          return;
        }
      }
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateCategory(category!.id, {
            name: trimmed,
            description: description.trim() || null,
            icon,
            color,
          })
        : await createCategory({
            name: trimmed,
            parent_id: effectiveParentId,
            description: description.trim() || null,
            icon,
            color,
            blueprint_id: startFrom === "blueprint" ? blueprintId || null : null,
            own_fields: fields,
          });

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(isEdit ? `Saved “${trimmed}”` : `Created “${trimmed}”`);
      onOpenChange(false);
      router.refresh();
      if (!isEdit && "data" in result && result.data) {
        router.push(`/data-center/${result.data.id}`);
      }
    });
  };

  const groupedInherited = useMemo(() => {
    const groups = new Map<string, EffectiveField[]>();
    for (const field of inherited) {
      const list = groups.get(field.source_category_name) ?? [];
      list.push(field);
      groups.set(field.source_category_name, list);
    }
    return [...groups.entries()];
  }, [inherited]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-4">
          <SheetTitle className="flex flex-wrap items-center gap-1.5 text-base">
            {isEdit ? (
              <>Edit category</>
            ) : effectiveParentId ? (
              <>
                New category under
                <span className="inline-flex items-center gap-1 text-primary">
                  {parentName}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </>
            ) : (
              <>New root category</>
            )}
          </SheetTitle>
          <SheetDescription>
            {isEdit
              ? "Rename it, or change how it appears in the tree."
              : effectiveParentId
                ? "It will inherit its parent's fields and can add more of its own."
                : "A root category defines its own fields from scratch."}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="category-name" className="text-sm font-medium text-foreground">
              Name
            </label>
            <input
              id="category-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Laptops"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">
                {name.trim() ? (
                  <>
                    URL: <code className="text-foreground">/{slug}</code>
                  </>
                ) : (
                  "A URL slug is generated from the name."
                )}
              </span>
              {duplicate && (
                <span className="text-destructive">
                  A sibling called “{duplicate.name}” already exists
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="category-description" className="text-sm font-medium text-foreground">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="category-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
              placeholder="What belongs in here?"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* Icon + colour */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Icon &amp; colour</span>
            <IconColorPicker
              icon={icon}
              color={color}
              onIconChange={setIcon}
              onColorChange={setColor}
            />
          </div>

          {/* What it inherits — the panel that teaches the model */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground">Fields</span>
            {loading ? (
              <div className="flex items-center gap-2 rounded-md border border-border bg-card/50 px-3 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Resolving inherited fields…
              </div>
            ) : effectiveParentId ? (
              inherited.length > 0 ? (
                <div className="space-y-2 rounded-md border border-border bg-card/50 p-3">
                  <p className="text-sm text-foreground">
                    Inherits <strong>{inherited.length}</strong> field
                    {inherited.length === 1 ? "" : "s"} from {groupedInherited.length} categor
                    {groupedInherited.length === 1 ? "y" : "ies"}
                  </p>
                  {groupedInherited.map(([source, fields]) => (
                    <div key={source} className="space-y-1">
                      <p className="text-xs uppercase tracking-wider text-muted-foreground">
                        from {source}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {fields.map((field) => (
                          <span
                            key={field.key}
                            title={`${field.type}${field.required ? " · required" : ""}`}
                            className="rounded border border-border bg-secondary/40 px-1.5 py-0.5 font-mono text-[11px] text-secondary-foreground"
                          >
                            {field.key}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
                  Its parent defines no fields yet, so there is nothing to inherit.
                </p>
              )
            ) : (
              <p className="rounded-md border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground">
                Root category — defines its own fields from scratch.
              </p>
            )}
          </div>

          {/* Start from — create only */}
          {!isEdit && (
            <div className="space-y-2">
              <span className="text-sm font-medium text-foreground">Start from</span>

              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors",
                  startFrom === "inherited" ? "border-primary bg-primary/5" : "border-border"
                )}
              >
                <input
                  type="radio"
                  name="start-from"
                  checked={startFrom === "inherited"}
                  onChange={() => setStartFrom("inherited")}
                  className="mt-0.5"
                />
                <span className="text-sm">
                  <span className="block text-foreground">
                    {effectiveParentId ? "Inherited fields only" : "No fields yet"}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Add fields later from the Schema tab.
                  </span>
                </span>
              </label>

              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors",
                  startFrom === "blueprint" ? "border-primary bg-primary/5" : "border-border"
                )}
              >
                <input
                  type="radio"
                  name="start-from"
                  checked={startFrom === "blueprint"}
                  onChange={() => setStartFrom("blueprint")}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block text-foreground">Copy a blueprint&apos;s fields</span>
                  {startFrom === "blueprint" && (
                    <span className="mt-2 block space-y-2">
                      <select
                        value={blueprintId}
                        onChange={(event) => setBlueprintId(event.target.value)}
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <option value="">Choose a blueprint…</option>
                        {blueprints.map((blueprint) => (
                          <option key={blueprint.id} value={blueprint.id}>
                            {blueprint.name} ({blueprint.fields?.length ?? 0} fields)
                          </option>
                        ))}
                      </select>

                      {selectedBlueprint && (
                        <span className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <Info className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>
                            Copies{" "}
                            {(selectedBlueprint.fields?.length ?? 0) - blueprintConflicts.length}{" "}
                            field
                            {(selectedBlueprint.fields?.length ?? 0) - blueprintConflicts.length === 1
                              ? ""
                              : "s"}
                            . Later edits to the blueprint won&apos;t affect this category.
                            {blueprintConflicts.length > 0 && (
                              <>
                                {" "}
                                Skipping{" "}
                                {blueprintConflicts.map((f) => f.key).join(", ")} — already
                                inherited.
                              </>
                            )}
                          </span>
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </label>

              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors",
                  startFrom === "define" ? "border-primary bg-primary/5" : "border-border"
                )}
              >
                <input
                  type="radio"
                  name="start-from"
                  checked={startFrom === "define"}
                  onChange={() => setStartFrom("define")}
                  className="mt-0.5"
                />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block text-foreground">Define fields now</span>
                  {startFrom === "define" && (
                    <span className="mt-2 block space-y-2">
                      {draftFields.map((field, index) => (
                        <span key={index} className="flex items-center gap-1.5">
                          <input
                            value={field.label}
                            onChange={(event) =>
                              setDraftFields((previous) =>
                                previous.map((f, i) =>
                                  i === index
                                    ? {
                                        ...f,
                                        label: event.target.value,
                                        key: slugify(event.target.value).replace(/-/g, "_"),
                                      }
                                    : f
                                )
                              )
                            }
                            placeholder="Field label"
                            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                          <select
                            value={field.type}
                            onChange={(event) =>
                              setDraftFields((previous) =>
                                previous.map((f, i) =>
                                  i === index ? { ...f, type: event.target.value as FieldType } : f
                                )
                              )
                            }
                            className="h-8 rounded-md border border-border bg-background px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {FIELD_TYPES.map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            aria-label={`Remove ${field.label || "field"}`}
                            onClick={() =>
                              setDraftFields((previous) => previous.filter((_, i) => i !== index))
                            }
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      ))}
                      <button
                        type="button"
                        onClick={addDraftField}
                        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-primary hover:underline"
                      >
                        <Plus className="h-3 w-3" />
                        Add field
                      </button>
                    </span>
                  )}
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending || !name.trim() || Boolean(duplicate)}>
            {pending ? "Saving…" : isEdit ? "Save changes" : "Create category"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

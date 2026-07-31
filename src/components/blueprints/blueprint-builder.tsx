"use client";

// ── Blueprint field builder ──────────────────────────────────
// Simpler than the schema editor: a blueprint has no inheritance, so
// there is no chain to resolve and no override machinery. Same field
// vocabulary though — the full FieldType union plus position, unit and
// help_text.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { OptionsEditor } from "@/components/data-center/options-editor";
import { updateBlueprint } from "@/app/(dashboard)/data-center/blueprints/actions";
import { slugify, validateFieldKey } from "@/lib/schema";
import type { Blueprint, FieldType, SchemaField } from "@/lib/types";

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

type DraftField = SchemaField & { _uid: string };

let uidCounter = 0;
const nextUid = () => `bp-${(uidCounter += 1)}`;

const toDraft = (fields: SchemaField[]): DraftField[] =>
  fields.map((field) => ({ ...field, _uid: nextUid() }));

const strip = (fields: DraftField[]): SchemaField[] =>
  fields.map(({ _uid, ...field }, index) => ({ ...field, position: index }));

const deriveKey = (label: string) => slugify(label).replace(/-/g, "_");

export function BlueprintBuilder({
  blueprint,
  canEdit,
}: {
  blueprint: Blueprint;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<DraftField[]>(() => toDraft(blueprint.fields ?? []));
  const [pending, startTransition] = useTransition();

  // Reset when navigating between blueprints.
  useEffect(() => {
    setFields(toDraft(blueprint.fields ?? []));
  }, [blueprint.id, blueprint.fields]);

  const dirty = useMemo(
    () => JSON.stringify(strip(fields)) !== JSON.stringify(blueprint.fields ?? []),
    [fields, blueprint.fields]
  );

  const errors = fields.map((field, index) => {
    if (!field.label.trim()) return "A label is required.";
    const keyError = validateFieldKey(field.key);
    if (keyError) return keyError;
    const duplicate = fields.findIndex((other) => other.key === field.key);
    if (duplicate !== -1 && duplicate !== index) {
      return `“${field.key}” appears twice in this blueprint.`;
    }
    if ((field.type === "select" || field.type === "multiselect") && !field.options?.length) {
      return `A ${field.type} field needs at least one option.`;
    }
    return null;
  });
  const hasErrors = errors.some(Boolean);

  const patch = (uid: string, next: Partial<DraftField>) =>
    setFields((previous) =>
      previous.map((field) => (field._uid === uid ? { ...field, ...next } : field))
    );

  const save = () => {
    startTransition(async () => {
      const result = await updateBlueprint(blueprint.id, { fields: strip(fields) });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Blueprint saved");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {fields.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          No fields yet. Add the fields a category should start with.
        </p>
      ) : (
        <Reorder.Group axis="y" values={fields} onReorder={setFields} className="space-y-1">
          {fields.map((field, index) => (
            <BlueprintFieldRow
              key={field._uid}
              field={field}
              error={errors[index]}
              canEdit={canEdit}
              onPatch={(next) => patch(field._uid, next)}
              onRemove={() =>
                setFields((previous) => previous.filter((item) => item._uid !== field._uid))
              }
            />
          ))}
        </Reorder.Group>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setFields((previous) => [
                ...previous,
                {
                  _uid: nextUid(),
                  key: "",
                  label: "",
                  type: "string",
                  required: false,
                  position: previous.length,
                },
              ])
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add field
          </Button>

          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            <Button
              size="sm"
              onClick={save}
              disabled={!dirty || hasErrors || pending}
            >
              {pending ? "Saving…" : "Save fields"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BlueprintFieldRow({
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
      className="rounded-md border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2 p-2">
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
          onChange={(event) =>
            onPatch({ label: event.target.value, key: deriveKey(event.target.value) })
          }
          placeholder="Field label"
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <input
          value={field.key}
          disabled={!canEdit}
          onChange={(event) => onPatch({ key: event.target.value })}
          placeholder="key"
          className="h-8 w-28 rounded-md border border-input bg-background px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <select
          value={field.type}
          disabled={!canEdit}
          onChange={(event) => onPatch({ type: event.target.value as FieldType })}
          className="h-8 rounded-md border border-input bg-background px-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <input
          value={field.unit ?? ""}
          disabled={!canEdit}
          onChange={(event) => onPatch({ unit: event.target.value || undefined })}
          placeholder="unit"
          title="Display-only unit, e.g. kg or GB"
          className="h-8 w-16 rounded-md border border-input bg-background px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={field.required}
            disabled={!canEdit}
            onChange={(event) => onPatch({ required: event.target.checked })}
            className="h-3.5 w-3.5 rounded border-input"
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

      <div className="space-y-2 border-t border-border px-2 py-2">
        <input
          value={field.help_text ?? ""}
          disabled={!canEdit}
          onChange={(event) => onPatch({ help_text: event.target.value || undefined })}
          placeholder="Help text (optional)"
          className="h-7 w-full rounded-md border border-input bg-background px-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {(field.type === "select" || field.type === "multiselect") && (
          <OptionsEditor
            options={field.options ?? []}
            onChange={(options) => onPatch({ options })}
          />
        )}
      </div>

      {error && <p className="px-2 pb-2 text-[11px] text-destructive">{error}</p>}
    </Reorder.Item>
  );
}

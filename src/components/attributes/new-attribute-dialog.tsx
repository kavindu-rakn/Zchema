"use client";

// ── New attribute ────────────────────────────────────────────
// The one place `type` is editable, because after this it never is.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OptionsEditor } from "@/components/data-center/options-editor";
import { createAttribute } from "@/app/(dashboard)/data-center/attributes/actions";
import { slugify, validateFieldKey } from "@/lib/schema";
import type { FieldType } from "@/lib/types";

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

export function NewAttributeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>("string");
  const [groupName, setGroupName] = useState("");
  const [options, setOptions] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  // Reset on close in the event handler rather than an effect: closing
  // is a discrete action, with nothing to synchronise afterwards.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLabel("");
      setKey("");
      setKeyTouched(false);
      setType("string");
      setGroupName("");
      setOptions([]);
    }
    onOpenChange(next);
  };

  const needsOptions = type === "select" || type === "multiselect";
  const keyError = key ? validateFieldKey(key) : null;
  const ready =
    label.trim().length > 0 && key.length > 0 && !keyError && (!needsOptions || options.length > 0);

  const create = () => {
    startTransition(async () => {
      const result = await createAttribute({
        key,
        label,
        type,
        options: needsOptions ? options : [],
        group_name: groupName,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Created “${label}”`);
      // Via the wrapper so the form is clean next time it opens — the
      // rail keeps this dialog mounted after navigation.
      handleOpenChange(false);
      router.push(`/data-center/attributes/${result.data.id}`);
      router.refresh();
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New attribute</DialogTitle>
          <DialogDescription>
            A field definition categories can share, so the same concept is the same thing
            everywhere it appears.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm text-foreground">Label</span>
            <input
              value={label}
              autoFocus
              onChange={(event) => {
                setLabel(event.target.value);
                // The key follows the label until it is edited by hand.
                if (!keyTouched) setKey(slugify(event.target.value).replace(/-/g, "_"));
              }}
              placeholder="Brand"
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm text-foreground">Key</span>
            <input
              value={key}
              onChange={(event) => {
                setKeyTouched(true);
                setKey(event.target.value);
              }}
              placeholder="brand"
              className="h-9 w-full rounded-md border border-input bg-background px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {keyError && <span className="block text-[11px] text-destructive">{keyError}</span>}
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-sm text-foreground">Type</span>
              <select
                value={type}
                onChange={(event) => setType(event.target.value as FieldType)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {FIELD_TYPES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-sm text-foreground">Group</span>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Commercial"
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </div>

          {needsOptions && (
            <div className="space-y-1">
              <span className="text-sm text-foreground">Options</span>
              <OptionsEditor options={options} onChange={setOptions} />
            </div>
          )}

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Choose the type carefully — it is fixed once the attribute exists, because changing
            it later would affect every category using it at once.
          </p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => handleOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!ready || pending}>
            {pending ? "Creating…" : "Create attribute"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

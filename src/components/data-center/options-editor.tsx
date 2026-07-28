"use client";

// ── select / multiselect options ─────────────────────────────
// Pasting a multi-line list splits into one option per line, because
// that is where option lists actually come from — a spreadsheet column
// or a wiki table, not typed one at a time.

import { useState } from "react";
import { Plus, X } from "lucide-react";

export function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (options: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const addMany = (raw: string) => {
    const parts = raw
      .split(/[\n\r\t,;]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...options];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
    setDraft("");
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <span
            key={option}
            className="inline-flex items-center gap-1 rounded border border-border bg-secondary/40 px-1.5 py-0.5 text-xs text-secondary-foreground"
          >
            {option}
            <button
              type="button"
              aria-label={`Remove option ${option}`}
              onClick={() => onChange(options.filter((item) => item !== option))}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {options.length === 0 && (
          <span className="text-xs text-destructive">At least one option is required.</span>
        )}
      </div>

      <div className="flex gap-1">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            if (/[\n\r\t,;]/.test(text)) {
              event.preventDefault();
              addMany(text);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addMany(draft);
            }
          }}
          placeholder="Add an option, or paste a list"
          aria-label="Add an option"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="button"
          onClick={() => addMany(draft)}
          disabled={!draft.trim()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          aria-label="Add option"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

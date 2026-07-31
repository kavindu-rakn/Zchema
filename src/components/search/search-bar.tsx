"use client";

// ── Query bar ────────────────────────────────────────────────
// Sticky, with autocomplete on field keys before the colon and on
// values after it.
//
// The autocomplete is deliberately not a dropdown that steals Enter:
// this is a search box, and the overwhelmingly common action is "type
// words, press Enter". Suggestions are a Tab-to-accept affordance, not
// a gate.

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { SearchableField } from "@/lib/types";

export function SearchBar({
  initialQuery,
  fields,
}: {
  initialQuery: string;
  fields: SearchableField[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialQuery);
  const [focused, setFocused] = useState(false);

  /** The fragment being typed right now — the last whitespace-run. */
  const fragment = useMemo(() => {
    const match = /(\S*)$/.exec(value);
    return match ? match[1] : "";
  }, [value]);

  const suggestions = useMemo(() => {
    if (!focused || fragment === "") return [];

    const colon = fragment.indexOf(":");

    // Before the colon → suggest field keys.
    if (colon === -1) {
      const needle = fragment.replace(/^-/, "").toLowerCase();
      return fields
        .filter((field) => field.key.startsWith(needle) || field.label.toLowerCase().startsWith(needle))
        .slice(0, 6)
        .map((field) => ({
          insert: `${field.key}:`,
          label: field.key,
          hint: `${field.label} · ${field.type} · ${field.category_count} categor${
            field.category_count === 1 ? "y" : "ies"
          }`,
          shared: field.is_shared_attribute,
        }));
    }

    // After the colon → suggest values this field actually holds.
    const key = fragment.slice(0, colon).replace(/^-/, "").toLowerCase();
    const typed = fragment.slice(colon + 1).toLowerCase();
    const field = fields.find((entry) => entry.key === key);
    if (!field) return [];

    return (field.options ?? [])
      .filter((option) => option.toLowerCase().startsWith(typed))
      .slice(0, 6)
      .map((option) => ({
        insert: `${key}:${/\s/.test(option) ? `"${option}"` : option}`,
        label: option,
        hint: field.label,
        shared: false,
      }));
  }, [focused, fragment, fields]);

  const submit = (query: string) => {
    const trimmed = query.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : "/search");
  };

  const accept = (insert: string) => {
    // Replace only the fragment being typed, keeping the rest intact.
    setValue((previous) => previous.replace(/(\S*)$/, insert));
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(value);
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          // A click on a suggestion must land before blur closes the
          // list, hence the delay rather than an onMouseDown dance.
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          onKeyDown={(event) => {
            if (event.key === "Tab" && suggestions.length > 0) {
              event.preventDefault();
              accept(suggestions[0].insert);
            }
            if (event.key === "Escape") setFocused(false);
          }}
          placeholder="Search everything —  brand:Sony  price:>500  missing:sku  in:electronics"
          aria-label="Search the catalog"
          className="h-11 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {value && (
          <button
            type="button"
            aria-label="Clear the search"
            onClick={() => {
              setValue("");
              submit("");
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-md">
          {suggestions.map((suggestion, index) => (
            <li key={suggestion.insert}>
              <button
                type="button"
                onClick={() => accept(suggestion.insert)}
                className={cn(
                  "flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent",
                  index === 0 && "bg-accent/40"
                )}
              >
                <code className="shrink-0 text-foreground">{suggestion.label}</code>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {suggestion.hint}
                </span>
                {suggestion.shared && (
                  <span className="shrink-0 text-[10px] text-primary">shared</span>
                )}
                {index === 0 && (
                  <kbd className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                    Tab
                  </kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

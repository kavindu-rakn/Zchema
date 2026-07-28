"use client";

// ── Appearance: display density ──────────────────────────────
// Writes data-density on <html>; globals.css tightens the data-heavy
// surfaces from there. Persisted to localStorage and re-applied before
// first paint by the inline script in the root layout.

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Density = "comfortable" | "compact";

const STORAGE_KEY = "schemashift:density";

const OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: "comfortable", label: "Comfortable", hint: "Roomier spacing" },
  { value: "compact", label: "Compact", hint: "More rows on screen" },
];

export function DensityToggle() {
  const [density, setDensity] = useState<Density>("comfortable");

  // Read after mount so server and client markup agree.
  useEffect(() => {
    const stored = document.documentElement.getAttribute("data-density");
    if (stored === "compact" || stored === "comfortable") setDensity(stored);
  }, []);

  const apply = (next: Density) => {
    setDensity(next);
    document.documentElement.setAttribute("data-density", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode or storage disabled — the setting just won't persist.
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Display density"
      className="flex flex-wrap gap-2"
    >
      {OPTIONS.map((option) => {
        const active = density === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => apply(option.value)}
            className={cn(
              "flex min-w-[9rem] flex-col items-start rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            <span className="text-sm font-medium">{option.label}</span>
            <span className="text-xs text-muted-foreground">{option.hint}</span>
          </button>
        );
      })}
    </div>
  );
}

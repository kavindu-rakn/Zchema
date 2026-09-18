"use client";

// ── Appearance: display density ──────────────────────────────
// Writes data-density on <html>; globals.css tightens the data-heavy
// surfaces from there. Persisted to localStorage and re-applied before
// first paint by the inline script in the root layout.

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Density = "comfortable" | "compact";

const STORAGE_KEY = "zchema:density";

// The source of truth is the data-density attribute on <html>, which the
// root layout's inline script sets before first paint. Read it as an
// external store: the server snapshot keeps hydration consistent, and a
// MutationObserver re-renders whenever the attribute changes — including
// from apply() below — so there is no local state to keep in step.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-density"],
  });
  return () => observer.disconnect();
}

function readDensity(): Density {
  return document.documentElement.getAttribute("data-density") === "compact"
    ? "compact"
    : "comfortable";
}

function serverDensity(): Density {
  return "comfortable";
}

const OPTIONS: { value: Density; label: string; hint: string }[] = [
  { value: "comfortable", label: "Comfortable", hint: "Roomier spacing" },
  { value: "compact", label: "Compact", hint: "More rows on screen" },
];

export function DensityToggle() {
  const density = useSyncExternalStore(subscribe, readDensity, serverDensity);

  const apply = (next: Density) => {
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

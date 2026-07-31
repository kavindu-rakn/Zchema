"use client";

// ── Dismissible hint ─────────────────────────────────────────
// One line, one point, permanently dismissible per user.
//
// The rule these follow: a hint may only ever point at something
// already on screen. A hint that explains a concept you cannot see is a
// tutorial, and tutorials get skipped. "Those seven fields came from
// two ancestors" works because the seven fields are right there.

import { useState, useTransition } from "react";
import { Lightbulb, X } from "lucide-react";

import { dismissHint } from "@/app/(dashboard)/onboarding/actions";
import { cn } from "@/lib/utils";

export function Hint({
  hintKey,
  children,
  dismissed,
  tone = "info",
}: {
  /** Stable key stored in profiles.onboarding_state. */
  hintKey: string;
  children: React.ReactNode;
  /** Keys this user has already dismissed, from the server. */
  dismissed: string[];
  tone?: "info" | "primary";
}) {
  const [hidden, setHidden] = useState(false);
  const [, startTransition] = useTransition();

  if (hidden || dismissed.includes(hintKey)) return null;

  const dismiss = () => {
    // Hide immediately; persistence is not worth a spinner. If the write
    // fails the hint returns on the next load, which is the correct
    // failure mode for something this small.
    setHidden(true);
    startTransition(async () => {
      await dismissHint(hintKey);
    });
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2",
        tone === "primary"
          ? "border-primary/30 bg-primary/5"
          : "border-border bg-card/50"
      )}
    >
      <Lightbulb
        className={cn(
          "mt-0.5 h-3.5 w-3.5 shrink-0",
          tone === "primary" ? "text-primary" : "text-muted-foreground"
        )}
      />
      <div className="min-w-0 flex-1 text-xs text-foreground">{children}</div>
      <button
        type="button"
        aria-label="Dismiss this hint"
        onClick={dismiss}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

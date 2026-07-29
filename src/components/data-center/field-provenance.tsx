"use client";

// ── Field provenance ─────────────────────────────────────────
// "Where did this field come from?" answered in one click: the chain
// that produced it, from the category that defined it down to the one
// you are looking at, marking every category that patched it.

import { ArrowDown, Pencil, PlusCircle } from "lucide-react";
import Link from "next/link";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fieldProvenance } from "@/lib/schema";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";

const ROLE_COPY = {
  defined: { label: "defined here", icon: PlusCircle, tone: "text-primary" },
  inherited: { label: "inherited", icon: ArrowDown, tone: "text-muted-foreground" },
  overridden: { label: "overridden", icon: Pencil, tone: "text-warning" },
} as const;

export function FieldProvenance({
  chain,
  fieldKey,
  children,
}: {
  chain: Pick<Category, "id" | "name" | "own_fields" | "overrides">[];
  fieldKey: string;
  children: React.ReactNode;
}) {
  const steps = fieldProvenance(chain, fieldKey);

  return (
    <Popover>
      <PopoverTrigger render={children as React.ReactElement} />
      <PopoverContent align="start" className="w-72 p-0">
        <div className="border-b border-border px-3 py-2">
          <p className="font-mono text-xs text-foreground">{fieldKey}</p>
          <p className="text-[11px] text-muted-foreground">
            {steps.length === 0
              ? "Not defined anywhere in this chain."
              : `Travelled through ${steps.length} categor${steps.length === 1 ? "y" : "ies"}`}
          </p>
        </div>

        <ol className="space-y-0 p-2">
          {steps.map((step, index) => {
            const copy = ROLE_COPY[step.role];
            const Icon = copy.icon;
            const isLast = index === steps.length - 1;

            return (
              <li key={step.category_id} className="relative flex gap-2 pb-2 last:pb-0">
                {/* Connector down the chain */}
                {!isLast && (
                  <span
                    aria-hidden
                    className="absolute left-[7px] top-5 h-full w-px bg-border"
                  />
                )}

                <Icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", copy.tone)} />

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/data-center/${step.category_id}`}
                    className="block truncate text-xs font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {step.category_name}
                  </Link>
                  <p className={cn("text-[11px]", copy.tone)}>
                    {copy.label}
                    {step.role === "overridden" && step.patched.length > 0 && (
                      <span className="text-muted-foreground"> ({step.patched.join(", ")})</span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

"use client";

// ── Promotion prompt ─────────────────────────────────────────
// "`brand` is defined separately on Electronics, Clothing and
// Home & Kitchen — all string. Promote to a shared attribute?"
//
// This is the feature. Asking someone to model their attributes before
// they have data produces an empty registry; showing them the three
// places they already wrote the same field produces a full one.
//
// Dismissals are per-key and live in localStorage: this is a nudge, and
// a nudge you cannot silence is nagging.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { promoteFieldToAttribute } from "@/app/(dashboard)/data-center/attributes/actions";
import { cn } from "@/lib/utils";
import type { DuplicateFieldDefinition } from "@/lib/types";

const DISMISSED_KEY = "zchema:dismissed-promotions";

export function DuplicatesPanel({ duplicates }: { duplicates: DuplicateFieldDefinition[] }) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Restored after mount so server and client markup agree. Read in a
  // microtask rather than synchronously in the effect body — localStorage
  // is an external store, and this is the shape that says so.
  useEffect(() => {
    let live = true;

    void (async () => {
      let restored: string[] = [];
      try {
        const stored = window.localStorage.getItem(DISMISSED_KEY);
        if (stored) restored = JSON.parse(stored) as string[];
      } catch {
        restored = [];
      }
      if (!live) return;
      setDismissed(restored);
      setHydrated(true);
    })();

    return () => {
      live = false;
    };
  }, []);

  const dismiss = (key: string) => {
    const next = [...dismissed, key];
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // Just won't persist.
    }
  };

  const promote = (duplicate: DuplicateFieldDefinition) => {
    // Promote from the category that defines it with the majority type,
    // so the attribute inherits the definition most of the catalog
    // already agrees on rather than whichever happened to sort first.
    const source =
      duplicate.categories.find((category) => category.type === duplicate.type) ??
      duplicate.categories[0];
    if (!source) return;

    setPendingKey(duplicate.key);
    startTransition(async () => {
      const result = await promoteFieldToAttribute(source.id, duplicate.key);
      setPendingKey(null);

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      const { linked, skipped } = result.data;
      toast.success(`Promoted “${duplicate.key}”`, {
        description:
          skipped.length > 0
            ? `Linked ${linked} definition${linked === 1 ? "" : "s"} · ${skipped.length} skipped for a type mismatch: ${skipped
                .map((entry) => `${entry.name} (${entry.type})`)
                .join(", ")}`
            : `Linked all ${linked} definitions.`,
      });
      router.push(`/data-center/attributes/${result.data.attribute_id}`);
      router.refresh();
    });
  };

  // Rendering before hydration would flash prompts the user has
  // already dismissed.
  if (!hydrated) return null;

  const visible = duplicates.filter((duplicate) => !dismissed.includes(duplicate.key));
  if (visible.length === 0) return null;

  return (
    <div className="mb-3 space-y-2 rounded-md border border-primary/30 bg-primary/5 p-2">
      <p className="flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-primary">
        <Sparkles className="h-3 w-3" />
        Repeated fields
      </p>

      {visible.slice(0, 4).map((duplicate) => (
        <div
          key={duplicate.key}
          className="rounded-md border border-border bg-background p-2"
        >
          <div className="flex items-start gap-1">
            <p className="min-w-0 flex-1 text-xs text-foreground">
              <code className="font-medium">{duplicate.key}</code> is defined separately on{" "}
              {duplicate.categories.map((category, index) => (
                <span key={category.id}>
                  {index > 0 && (index === duplicate.categories.length - 1 ? " and " : ", ")}
                  <span className="text-muted-foreground">{category.name}</span>
                </span>
              ))}
              .
            </p>
            <button
              type="button"
              aria-label={`Dismiss the suggestion for ${duplicate.key}`}
              onClick={() => dismiss(duplicate.key)}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {duplicate.types_agree ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              All {duplicate.type} · {duplicate.item_count} item
              {duplicate.item_count === 1 ? "" : "s"} across them.
            </p>
          ) : (
            <p className="mt-0.5 flex items-start gap-1 text-[11px] text-warning">
              <AlertTriangle className="mt-0.5 h-2.5 w-2.5 shrink-0" />
              <span>
                Defined as {duplicate.types.join(" and ")}. Only the {duplicate.type}{" "}
                definitions will link — the rest keep their own field, unchanged.
              </span>
            </p>
          )}

          <button
            type="button"
            onClick={() => promote(duplicate)}
            disabled={pendingKey === duplicate.key}
            className={cn(
              "mt-1.5 w-full rounded-md border border-primary/40 px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10",
              pendingKey === duplicate.key && "opacity-60"
            )}
          >
            {pendingKey === duplicate.key ? "Promoting…" : "Promote to a shared attribute"}
          </button>
        </div>
      ))}

      {visible.length > 4 && (
        <p className="px-1 text-[11px] text-muted-foreground">
          and {visible.length - 4} more repeated field
          {visible.length - 4 === 1 ? "" : "s"}.
        </p>
      )}
    </div>
  );
}

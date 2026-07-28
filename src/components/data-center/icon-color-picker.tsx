"use client";

import { CATEGORY_COLORS, CATEGORY_ICONS, ICON_NAMES, iconFor } from "./category-icons";
import { cn } from "@/lib/utils";

export function IconColorPicker({
  icon,
  color,
  onIconChange,
  onColorChange,
}: {
  icon: string | null;
  color: string | null;
  onIconChange: (icon: string | null) => void;
  onColorChange: (color: string | null) => void;
}) {
  const Preview = iconFor(icon);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-card"
          aria-hidden
        >
          <Preview className="h-4 w-4" style={color ? { color } : undefined} />
        </span>
        <p className="text-xs text-muted-foreground">
          Shown in the tree. Optional — a plain folder is used otherwise.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Category icon"
        className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-md border border-border p-2"
      >
        {ICON_NAMES.map((name) => {
          const Icon = CATEGORY_ICONS[name];
          const active = icon === name;
          return (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={name}
              title={name}
              onClick={() => onIconChange(active ? null : name)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-primary/15 text-primary ring-1 ring-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          );
        })}
      </div>

      <div role="radiogroup" aria-label="Category colour" className="flex flex-wrap gap-1.5">
        {CATEGORY_COLORS.map((swatch) => {
          const active = color === swatch;
          return (
            <button
              key={swatch}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`Colour ${swatch}`}
              onClick={() => onColorChange(active ? null : swatch)}
              style={{ backgroundColor: swatch }}
              className={cn(
                "h-5 w-5 rounded-full transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background" : "hover:scale-110"
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

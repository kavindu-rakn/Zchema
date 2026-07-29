// ── Inheritance flow ─────────────────────────────────────────
// The ancestor chain as stacked bands, each listing the fields it
// contributes, with the running total accumulating downward. Static
// SVG, no charting library.
//
// This is the single clearest picture of what the product does: you
// can see 3 fields become 7 become 9 as you descend, and see exactly
// which category added what.

import type { EffectiveField } from "@/lib/types";

interface Band {
  id: string;
  name: string;
  depth: number;
  contributes: string[];
  overrides: string[];
  runningTotal: number;
}

const BAND_HEIGHT = 62;
const BAND_GAP = 8;
const WIDTH = 640;
const PADDING_X = 12;

export function InheritanceFlow({
  chain,
  effective,
}: {
  /** Ancestors root-first, target last. */
  chain: { id: string; name: string; depth: number }[];
  effective: EffectiveField[];
}) {
  if (chain.length === 0) return null;

  // Fields are attributed to whichever category defined them; overrides
  // are attributed to the category that applied the patch.
  let running = 0;
  const bands: Band[] = chain.map((node) => {
    const contributes = effective
      .filter((field) => field.source_category_id === node.id)
      .map((field) => field.key);
    const overrides = effective
      .filter((field) => field.overridden_by?.includes(node.id))
      .map((field) => field.key);
    running += contributes.length;
    return {
      id: node.id,
      name: node.name,
      depth: node.depth,
      contributes,
      overrides,
      runningTotal: running,
    };
  });

  const height = bands.length * BAND_HEIGHT + (bands.length - 1) * BAND_GAP + 8;

  return (
    <figure className="space-y-2">
      <figcaption className="sr-only">
        How {chain[chain.length - 1]?.name} accumulates its {effective.length} fields down the
        category chain.
      </figcaption>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="h-auto w-full min-w-[420px]"
          role="img"
          aria-label={`Inheritance chain producing ${effective.length} fields`}
        >
          {bands.map((band, index) => {
            const y = index * (BAND_HEIGHT + BAND_GAP) + 4;
            const indent = index * 14;
            const isTarget = index === bands.length - 1;

            return (
              <g key={band.id}>
                {/* Connector into the next band */}
                {index < bands.length - 1 && (
                  <line
                    x1={PADDING_X + indent + 10}
                    y1={y + BAND_HEIGHT}
                    x2={PADDING_X + indent + 24}
                    y2={y + BAND_HEIGHT + BAND_GAP}
                    stroke="currentColor"
                    className="text-border"
                    strokeWidth={1}
                  />
                )}

                <rect
                  x={PADDING_X + indent}
                  y={y}
                  width={WIDTH - PADDING_X * 2 - indent}
                  height={BAND_HEIGHT}
                  rx={6}
                  className={
                    isTarget ? "fill-primary/10 stroke-primary/40" : "fill-card stroke-border"
                  }
                  strokeWidth={1}
                />

                {/* Category name */}
                <text
                  x={PADDING_X + indent + 12}
                  y={y + 20}
                  className={isTarget ? "fill-foreground" : "fill-muted-foreground"}
                  style={{ fontSize: 12, fontWeight: isTarget ? 600 : 500 }}
                >
                  {band.name}
                </text>

                {/* Running total, right-aligned */}
                <text
                  x={WIDTH - PADDING_X - 12}
                  y={y + 20}
                  textAnchor="end"
                  className={isTarget ? "fill-primary" : "fill-muted-foreground"}
                  style={{ fontSize: 11, fontWeight: 600 }}
                >
                  {band.runningTotal} field{band.runningTotal === 1 ? "" : "s"}
                </text>

                {/* Contributed keys */}
                <text
                  x={PADDING_X + indent + 12}
                  y={y + 38}
                  className="fill-foreground/80"
                  style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)" }}
                >
                  {band.contributes.length > 0
                    ? `+ ${band.contributes.slice(0, 5).join("  ")}${
                        band.contributes.length > 5
                          ? `  +${band.contributes.length - 5} more`
                          : ""
                      }`
                    : "— adds nothing of its own"}
                </text>

                {/* Overrides applied here */}
                {band.overrides.length > 0 && (
                  <text
                    x={PADDING_X + indent + 12}
                    y={y + 52}
                    className="fill-warning"
                    style={{ fontSize: 10, fontFamily: "var(--font-mono, monospace)" }}
                  >
                    ↻ overrides {band.overrides.join("  ")}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-xs text-muted-foreground">
        Each level keeps everything above it and adds its own. This category ends up with{" "}
        <strong className="text-foreground">{effective.length}</strong> field
        {effective.length === 1 ? "" : "s"}.
      </p>
    </figure>
  );
}

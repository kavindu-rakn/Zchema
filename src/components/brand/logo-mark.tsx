// ── Zchema mark ──────────────────────────────────────────────
// The app icon, as a component: a rounded square cut by a stepped 45°
// line, charcoal plate above, green below, a hairline seam between.
// Same geometry as src/app/icon.svg — that one is the browser-tab copy
// and this one is for the UI, so a change to the shape belongs in both.
//
// The green is `currentColor`, so callers keep tinting it with
// `text-primary` and it follows the theme. The plate and the seam are
// fixed: they are the part of the mark that reads as "dark", and on the
// near-black shell they are what the tile's edge is made of.

const PLATE = "#2a2e33";
const SEAM = "#0be08f";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role="img"
      aria-label="Zchema"
    >
      {/* Shows only through the gap between the plates: in the rendered
          art that edge is lit by the green, not shadowed. */}
      <rect width="512" height="512" rx="88" fill={SEAM} />
      <path
        fill={PLATE}
        d="M0 88A88 88 0 0 1 88 0h336a88 88 0 0 1 88 88v184.7H315.5L202.4 159.6H0Z"
      />
      <path
        fill="currentColor"
        d="M0 168.1h198.7L311.4 280.8H512V424a88 88 0 0 1-88 88H88a88 88 0 0 1-88-88Z"
      />
    </svg>
  );
}

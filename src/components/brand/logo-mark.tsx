// ── Zchema mark ──────────────────────────────────────────────
// A folded-ribbon Z: two bars joined by a diagonal that sits in shadow,
// echoing the faceted look of the original mark. Drawn in currentColor
// so the caller sets the colour (usually `text-primary`) and it follows
// the theme; src/app/icon.svg is the fixed-colour copy for browser tabs.

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Zchema"
      fill="currentColor"
    >
      {/* depth: the same Z, offset down-right */}
      <path
        d="M17 15H53V25L30 45H53V55H17V45L40 25H17Z"
        opacity="0.35"
      />
      {/* face */}
      <path d="M14 12H50V22L27 42H50V52H14V42L37 22H14Z" />
      {/* the fold: diagonal band in shadow */}
      <path d="M37 22H50L27 42H14Z" fill="#000" opacity="0.22" />
      {/* catch-light along the top edge */}
      <path d="M14 12H50V14.5H14Z" fill="#fff" opacity="0.3" />
    </svg>
  );
}

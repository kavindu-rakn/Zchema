// ── Brand constants ─────────────────────────────────────────
// One copy of the things that have to match in more than one place:
// the root layout's <head>, the web app manifest, and the alt text
// beside the social cards. Drift here is the kind that only shows up
// as a wrong-coloured splash screen or a stale title on someone's home
// screen, so it is worth the indirection.
//
// The artwork these describe lives in brand/ and is turned into icons
// by scripts/generate-brand-assets.mjs (`npm run gen:brand`).

export const BRAND = {
  name: "Zchema",
  tagline: "See what breaks before it breaks",
  description:
    "Change your data model against live records — and see exactly what breaks before it breaks.",

  /** --background in globals.css. The splash screen and the mobile URL bar. */
  background: "#060606",
  /** --primary in globals.css, and the green in the mark. Safari's pinned tab tint. */
  accent: "#00c483",
} as const;

/**
 * Absolute origin, for the metadata fields that cannot be relative:
 * og:image and og:url are fetched by a crawler that has no idea what
 * host it came from.
 *
 * Set NEXT_PUBLIC_SITE_URL once a custom domain is in front of the app.
 * Until then Vercel's own variable is right for production deploys, and
 * localhost is right for `next dev` — which keeps the build free of the
 * "metadataBase is not set" warning either way.
 */
export function siteUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined);

  try {
    return new URL(configured ?? `http://localhost:${process.env.PORT ?? 3000}`);
  } catch {
    // A malformed NEXT_PUBLIC_SITE_URL should not fail the build; a
    // wrong-but-valid base only costs link previews, and the warning
    // says which variable to fix.
    console.warn(`Ignoring malformed NEXT_PUBLIC_SITE_URL: ${configured}`);
    return new URL(`http://localhost:${process.env.PORT ?? 3000}`);
  }
}

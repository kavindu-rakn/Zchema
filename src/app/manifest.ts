import type { MetadataRoute } from "next";

import { BRAND } from "@/lib/brand";

// Served at /manifest.webmanifest. This is what "Add to Home Screen"
// and "Install app" read: the name under the icon, the icon itself, and
// the colours the splash screen is painted in before the app has
// rendered anything.
//
// Unlike every other metadata file this one has no image extension, so
// it does NOT fall through src/proxy.ts's matcher — it is named as a
// public route in src/utils/supabase/middleware.ts, or a logged-out
// visitor gets a redirect to /login where the JSON should be.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: BRAND.name,
    description: BRAND.description,
    // The landing page is for people who have not signed up. Anyone who
    // installed the app has, so they start where the work is; the
    // middleware sends them to /login if the session has lapsed.
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: BRAND.background,
    theme_color: BRAND.background,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Android crops adaptive icons to whatever shape the launcher
      // uses, so the maskable copy is the one with room to lose.
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

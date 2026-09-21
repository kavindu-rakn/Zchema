# Brand assets

Two source files, and everything else is generated from them.

| File | What it is |
|---|---|
| `zchema-mark.webp` | The rendered app icon, 1254². Bevel, glow, black field. |
| `zchema-lockup.png` | Mark + wordmark on black, 1983×793, letterboxed. |

A third source is checked in next to the code it serves: **`src/app/icon.svg`**,
a flat vector trace of the same mark. It is not a smaller copy of the render —
it is what the render looks like once the bevel and the glow are gone, which is
what a 16px browser tab shows anyway. Its geometry was measured off
`zchema-mark.webp`: a rounded square (radius 17.2% of the side) cut by a
horizontal → 45° → horizontal step, with a constant-width seam between the two
plates. `src/components/brand/logo-mark.tsx` carries the same path data for the
UI, so a change to the shape belongs in both.

## Regenerating

```bash
npm run gen:brand
```

| Output | From | Serves |
|---|---|---|
| `src/app/favicon.ico` | vector, 16/32/48 | tabs, the bookmarks bar, Windows shortcuts |
| `src/app/icon.svg` | *(the source)* | tabs on anything that takes an SVG favicon |
| `src/app/apple-icon.png` | render, 180² | iOS home screen, Safari bookmarks and Top Sites |
| `public/icons/icon-192.png`, `icon-512.png` | render | the web app manifest, Android install |
| `public/icons/icon-maskable-512.png` | render, inset to 58% | Android adaptive icons, which crop |
| `src/app/opengraph-image.png` | lockup, 1200×630 | WhatsApp, Slack, iMessage, Facebook, LinkedIn |
| `src/app/twitter-image.png` | lockup, 1200×630 | X — it does not fall back to og:image |

`public/icons/safari-pinned-tab.svg` is hand-written rather than generated:
Safari draws it as a one-colour silhouette, so it drops the fills and widens
the seam to something that survives at 16px.

Everything under `src/app/` is picked up by Next.js's file conventions — the
`<link>` and `<meta>` tags follow from the filenames, and nothing lists them by
hand. The two tags with no file convention (`mask-icon`, the Apple web app
title) are in `src/app/layout.tsx`, and the manifest is `src/app/manifest.ts`.

## Replacing the artwork

Drop a new `zchema-mark.webp` or `zchema-lockup.png` in here and run
`npm run gen:brand`. If the mark's *shape* changed, re-trace `src/app/icon.svg`
and `src/components/brand/logo-mark.tsx` too — the generator rasterises the
vector for the favicon, so a stale trace silently ships a stale favicon beside
a current home-screen icon.

`LOCKUP_CROP` in `scripts/generate-brand-assets.mjs` is measured against the
current lockup's letterboxing; a differently-padded replacement needs that
rectangle re-measured, or the social card will be off-centre.

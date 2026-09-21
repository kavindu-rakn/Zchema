// ── Brand asset generator ────────────────────────────────────
// Every icon the app serves is derived here from three checked-in
// sources, so nothing is a hand-edited binary nobody can reproduce:
//
//   brand/zchema-mark.webp    the rendered app icon (1254²)
//   brand/zchema-lockup.png   mark + wordmark, on black (1983×793)
//   src/app/icon.svg          a flat vector trace of the same mark
//
// Rule of thumb for which source feeds what: the rendered art carries
// the bevel and the glow and wants room to show them, so it feeds the
// large icons (home screens, PWA installs). Below ~64px that detail
// turns to mush, so the flat vector feeds the favicon instead.
//
// Run with `npm run gen:brand` after changing any source.

import sharp from "sharp";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (...p) => path.join(root, ...p);

/**
 * The black `zchema-mark.webp` was rendered on, measured off its own
 * corner pixels. Deliberately NOT BRAND.background (#060606, the splash
 * screen and the URL bar): this is the field the maskable icon shows
 * around the inset art, so it has to match the art rather than the app,
 * or a launcher cropping to a circle draws a visible square seam where
 * the two blacks meet. Re-measure it if the artwork is re-rendered.
 */
const CANVAS = "#080808";

const MARK = at("brand", "zchema-mark.webp");
const LOCKUP = at("brand", "zchema-lockup.png");
const VECTOR = at("src", "app", "icon.svg");

const written = [];
async function emit(file, buffer) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  written.push([path.relative(root, file).replaceAll("\\", "/"), buffer.length]);
}

// ── favicon.ico ─────────────────────────────────────────────
// Three sizes in one file: 16 for the tab, 32 for retina tabs and the
// bookmarks bar, 48 for Windows shortcuts and the Chrome new-tab grid.
// Rasterised from the vector, which was drawn full-bleed for exactly
// this — the rendered art's 9% margin costs a third of a 16px tile.
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(({ size, png }, i) => {
    const e = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, e + 0); // 0 means 256
    directory.writeUInt8(size >= 256 ? 0 : size, e + 1);
    directory.writeUInt8(0, e + 2); // palette size
    directory.writeUInt8(0, e + 3); // reserved
    directory.writeUInt16LE(1, e + 4); // colour planes
    directory.writeUInt16LE(32, e + 6); // bits per pixel
    directory.writeUInt32LE(png.length, e + 8);
    directory.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });

  return Buffer.concat([header, directory, ...images.map((i) => i.png)]);
}

async function favicon() {
  const svg = await readFile(VECTOR);
  const images = [];
  for (const size of [16, 32, 48]) {
    images.push({
      size,
      png: await sharp(svg).resize(size, size).png({ compressionLevel: 9 }).toBuffer(),
    });
  }
  await emit(at("src", "app", "favicon.ico"), encodeIco(images));
}

// ── Touch and PWA icons ─────────────────────────────────────
// Straight from the rendered art. Its own margin is what iOS and
// Android round the corners of, so these stay square and opaque —
// a transparent touch icon gets composited onto black by iOS anyway,
// and onto white by some Android launchers.
async function squareIcon(size, file) {
  const png = await sharp(MARK)
    .resize(size, size, { fit: "contain", background: CANVAS })
    .flatten({ background: CANVAS })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await emit(file, png);
}

// Android adaptive icons crop to a shape the launcher picks, and only
// the inner 80% circle is guaranteed to survive. Sizing the mark to
// 58% of the canvas keeps every corner of it inside that circle.
async function maskableIcon(size, file) {
  const inner = Math.round(size * 0.58);
  const art = await sharp(MARK).resize(inner, inner).toBuffer();
  const png = await sharp({
    create: { width: size, height: size, channels: 3, background: CANVAS },
  })
    .composite([{ input: art, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await emit(file, png);
}

// ── Social cards ────────────────────────────────────────────
// The lockup on black, in the 1.91:1 frame Open Graph asks for. The
// source is letterboxed inside a much larger black field, so it is
// cropped to the artwork first and re-centred with even margins.
//
// Kept under 300KB: WhatsApp fetches the image before it renders the
// bubble and gives up on large ones, which is the failure mode where a
// link "has no preview" everywhere except WhatsApp.
const LOCKUP_CROP = { left: 494, top: 245, width: 1040, height: 260 };
const OG = { width: 1200, height: 630 };

async function socialCard() {
  const artWidth = 800;
  const artHeight = Math.round((artWidth * LOCKUP_CROP.height) / LOCKUP_CROP.width);

  const art = await sharp(LOCKUP)
    .extract(LOCKUP_CROP)
    .resize(artWidth, artHeight)
    .toBuffer();

  // A soft green bloom behind the lockup, so the card is not a flat
  // black rectangle in a feed of flat white ones. Its black is a third
  // value again (#050505, darker than both CANVAS and BRAND.background)
  // and that is fine: no icon abuts this one, it is only ever seen
  // alone in someone else's feed, and the bloom needs the darkest
  // floor it can get before the ramp starts banding.
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG.width}" height="${OG.height}">
       <defs>
         <radialGradient id="bloom" cx="50%" cy="50%" r="52%">
           <stop offset="0" stop-color="#00c483" stop-opacity="0.20"/>
           <stop offset="0.5" stop-color="#00c483" stop-opacity="0.05"/>
           <stop offset="1" stop-color="#00c483" stop-opacity="0"/>
         </radialGradient>
       </defs>
       <rect width="${OG.width}" height="${OG.height}" fill="#050505"/>
       <ellipse cx="${OG.width / 2}" cy="${OG.height / 2}" rx="640" ry="330" fill="url(#bloom)"/>
     </svg>`
  );

  // The lockup's own background is pure black, so `screen` drops it and
  // lets the bloom show through instead of stamping a black box on it.
  const png = await sharp(background)
    .composite([
      {
        input: art,
        left: Math.round((OG.width - artWidth) / 2),
        top: Math.round((OG.height - artHeight) / 2),
        blend: "screen",
      },
    ])
    // Truecolour, not a 255-entry palette: the bloom is a wide, shallow
    // ramp and quantising it puts visible rings behind the wordmark.
    // The cost is ~100KB, which the 300KB budget above can carry.
    .png({ compressionLevel: 9 })
    .toBuffer();

  await emit(at("src", "app", "opengraph-image.png"), png);
  // X reads twitter:image and does not fall back to og:image, and
  // Next.js keeps the two file conventions separate too.
  await emit(at("src", "app", "twitter-image.png"), png);
}

await favicon();
await squareIcon(180, at("src", "app", "apple-icon.png"));
await squareIcon(192, at("public", "icons", "icon-192.png"));
await squareIcon(512, at("public", "icons", "icon-512.png"));
await maskableIcon(512, at("public", "icons", "icon-maskable-512.png"));
await socialCard();

const width = Math.max(...written.map(([f]) => f.length));
for (const [file, bytes] of written) {
  console.log(`${file.padEnd(width)}  ${(bytes / 1024).toFixed(1).padStart(7)} KB`);
}

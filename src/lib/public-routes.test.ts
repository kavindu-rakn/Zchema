// ── Public route unit tests ──────────────────────────────────
// Run with:  npm test
//
// Both directions of this list fail quietly. Drop a route and a browser
// gets a redirect where it expected JSON, with no error anyone sees;
// add one and a page that should have asked for a password just opens.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { isPublicRoute } from "./public-routes.ts";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("isPublicRoute", () => {
  it("lets a signed-out visitor reach the marketing and auth pages", () => {
    for (const path of ["/", "/login", "/signup", "/forgot-password"]) {
      assert.equal(isPublicRoute(path), true, path);
    }
  });

  it("lets /auth/callback through, or no confirmation link ever works", () => {
    // There is no session yet when the PKCE code lands here, so gating
    // it bounces the link to /login before the code can be exchanged.
    assert.equal(isPublicRoute("/auth/callback"), true);
  });

  it("lets the web app manifest through", () => {
    // Fetched by the browser before anyone signs in, for the bookmark
    // name and the install prompt. It is also the only metadata route
    // that gets this far: the icons and social cards end in .ico/.svg/
    // .png, which the matcher in src/proxy.ts skips outright.
    assert.equal(isPublicRoute("/manifest.webmanifest"), true);
  });

  it("keeps /update-password behind the session the reset link creates", () => {
    assert.equal(isPublicRoute("/update-password"), false);
  });

  it("keeps the app itself signed in", () => {
    for (const path of ["/dashboard", "/data-center", "/settings", "/search"]) {
      assert.equal(isPublicRoute(path), false, path);
    }
  });

  it("matches whole paths, not prefixes", () => {
    // "/" is public; "/anything" underneath it is not, and a startsWith
    // check here would have opened the whole app.
    for (const path of ["/login/../dashboard", "/loginx", "/auth/callback/x"]) {
      assert.equal(isPublicRoute(path), false, path);
    }
  });
});

// ── The other half of the rule ──────────────────────────────
// The list above only decides the requests that REACH the middleware.
// Which ones those are is decided by the matcher in src/proxy.ts, and
// the two are written against each other: the manifest is on the list
// because the matcher does not skip it, and the icons are absent from
// the list because it does. Loosen the matcher and the icons start
// redirecting to /login with every assertion above still green — which
// is the same silent failure, one file over.
//
// The matcher is read out of the source rather than imported: importing
// src/proxy.ts would pull in next/server, @supabase/ssr and the "@/"
// path alias, none of which resolve under a bare `node --test`.
const MATCHER = (() => {
  const src = readFileSync(join(SRC, "proxy.ts"), "utf8").replace(/\r/g, "");
  const line = src.split("\n").find((l) => l.includes('"/((?!'));
  assert.ok(line, "no matcher pattern found in src/proxy.ts");
  const literal = line.slice(line.indexOf('"') + 1, line.lastIndexOf('"'));
  return new RegExp(`^${JSON.parse(`"${literal}"`)}$`);
})();

describe("the proxy matcher, which decides what isPublicRoute even sees", () => {
  it("lets the manifest reach the middleware, so the list has to name it", () => {
    // If this ever flips to skipped, /manifest.webmanifest can come off
    // PUBLIC_ROUTES — and until then it must stay on it.
    assert.equal(MATCHER.test("/manifest.webmanifest"), true);
  });

  it("skips every icon and social card, so the list must NOT name them", () => {
    for (const path of [
      "/favicon.ico",
      "/icon.svg",
      "/apple-icon.png",
      "/opengraph-image.png",
      "/twitter-image.png",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/icon-maskable-512.png",
      "/icons/safari-pinned-tab.svg",
    ]) {
      assert.equal(MATCHER.test(path), false, path);
    }
  });

  it("still guards the app itself", () => {
    // The skip list is extensions and _next internals. Nothing that
    // renders a page may fall through it.
    for (const path of ["/", "/dashboard", "/settings", "/update-password"]) {
      assert.equal(MATCHER.test(path), true, path);
    }
  });
});

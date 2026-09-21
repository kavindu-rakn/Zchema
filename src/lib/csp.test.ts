// ── Content Security Policy unit tests ───────────────────────
// Run with:  npm test
//
// A CSP fails open silently: a stray 'unsafe-inline' in script-src
// switches off the whole point of it and nothing visibly breaks. These
// tests pin the directives that carry the weight.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { contentSecurityPolicy, createNonce } from "./csp.ts";

/** The policy as directive → sources. */
function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    })
  );
}

const production = parse(
  contentSecurityPolicy({ nonce: "abc123", dev: false, supabaseUrl: "https://ref.supabase.co/" })
);

describe("contentSecurityPolicy — script-src", () => {
  it("allows scripts only by nonce, and the chunks they load", () => {
    assert.deepEqual(production.get("script-src"), [
      "'self'",
      "'nonce-abc123'",
      "'strict-dynamic'",
    ]);
  });

  it("never allows inline script or eval in production", () => {
    const scripts = production.get("script-src") ?? [];
    assert.ok(!scripts.includes("'unsafe-inline'"));
    assert.ok(!scripts.includes("'unsafe-eval'"));
  });

  it("adds eval only in development, for React's error overlay", () => {
    const dev = parse(contentSecurityPolicy({ nonce: "n", dev: true }));
    assert.ok(dev.get("script-src")?.includes("'unsafe-eval'"));
  });
});

describe("contentSecurityPolicy — the rest", () => {
  it("forbids framing, plugins and base-tag hijacking", () => {
    assert.deepEqual(production.get("frame-ancestors"), ["'none'"]);
    assert.deepEqual(production.get("object-src"), ["'none'"]);
    assert.deepEqual(production.get("base-uri"), ["'self'"]);
    assert.deepEqual(production.get("form-action"), ["'self'"]);
  });

  it("does not put a nonce in style-src, which would disable 'unsafe-inline'", () => {
    const styles = production.get("style-src") ?? [];
    assert.ok(styles.includes("'unsafe-inline'"));
    assert.ok(!styles.some((source) => source.startsWith("'nonce-")));
  });

  it("names the Supabase origin, not its full URL", () => {
    assert.ok(production.get("connect-src")?.includes("https://ref.supabase.co"));
  });

  it("survives a missing or malformed Supabase URL", () => {
    for (const supabaseUrl of [undefined, "", "not a url"]) {
      const policy = parse(contentSecurityPolicy({ nonce: "n", dev: false, supabaseUrl }));
      assert.deepEqual(policy.get("connect-src"), ["'self'", "https:"]);
    }
  });

  it("upgrades insecure requests in production only", () => {
    assert.ok(production.has("upgrade-insecure-requests"));
    const dev = parse(contentSecurityPolicy({ nonce: "n", dev: true }));
    assert.ok(!dev.has("upgrade-insecure-requests"));
  });
});

describe("createNonce", () => {
  it("is fresh every time and safe inside a header", () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    assert.equal(nonces.size, 100);
    for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9+/=]+$/);
  });
});

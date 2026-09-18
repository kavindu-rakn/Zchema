// ── Post-auth redirect validation tests ──────────────────────
// Run with:  npm test
//
// /auth/callback concatenates the result of safeNext onto the origin,
// and the URL it comes from is the one delivered by the confirmation
// email. A value that escapes the origin here is a phishing link signed
// by our own domain, so the open-redirect shapes are the whole point of
// this file — the happy path is the easy half.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_REDIRECT, safeNext } from "./safe-redirect.ts";

describe("safeNext — values that must be rejected", () => {
  it("rejects a protocol-relative path", () => {
    // "//evil.com" is a valid URL meaning "same scheme, host evil.com".
    assert.equal(safeNext("//evil.com"), DEFAULT_REDIRECT);
  });

  it("rejects a backslash authority, which browsers normalise to //", () => {
    assert.equal(safeNext("/\\evil.com"), DEFAULT_REDIRECT);
  });

  it("rejects a userinfo payload — the origin-concatenation trap", () => {
    // `${origin}${next}` would build "https://ourapp.com@evil.com",
    // where ourapp.com is userinfo and the real host is evil.com.
    assert.equal(safeNext("@evil.com"), DEFAULT_REDIRECT);
  });

  it("rejects an absolute URL", () => {
    assert.equal(safeNext("https://evil.com"), DEFAULT_REDIRECT);
    assert.equal(safeNext("http://evil.com/dashboard"), DEFAULT_REDIRECT);
  });

  it("rejects a scheme-only payload", () => {
    assert.equal(safeNext("javascript:alert(1)"), DEFAULT_REDIRECT);
  });

  it("rejects a bare relative path with no leading slash", () => {
    assert.equal(safeNext("dashboard"), DEFAULT_REDIRECT);
    assert.equal(safeNext(".evil.com"), DEFAULT_REDIRECT);
  });

  it("rejects control characters that could split a Location header", () => {
    assert.equal(safeNext("/dashboard\r\nSet-Cookie: a=b"), DEFAULT_REDIRECT);
    // Built with fromCharCode so no raw control byte has to live in this
    // source file — a NUL here would make the whole file read as binary.
    const NUL = String.fromCharCode(0);
    const DEL = String.fromCharCode(0x7f);
    assert.equal(safeNext(`/dash${NUL}board`), DEFAULT_REDIRECT);
    assert.equal(safeNext(`/dashboard${DEL}`), DEFAULT_REDIRECT);
  });

  it("falls back for empty and missing input", () => {
    assert.equal(safeNext(null), DEFAULT_REDIRECT);
    assert.equal(safeNext(undefined), DEFAULT_REDIRECT);
    assert.equal(safeNext(""), DEFAULT_REDIRECT);
  });
});

describe("safeNext — values that must be preserved", () => {
  it("keeps an ordinary in-app path", () => {
    assert.equal(safeNext("/dashboard"), "/dashboard");
    assert.equal(safeNext("/data-center"), "/data-center");
  });

  it("keeps a deep path with a query string and fragment", () => {
    const next = "/data-center/abc123?tab=schema&page=2#field-brand";
    assert.equal(safeNext(next), next);
  });

  it("keeps a single slash", () => {
    assert.equal(safeNext("/"), "/");
  });

  it("keeps a path whose second segment starts with a slash-like name", () => {
    // Guard against an over-eager rule: only position 1 may not be a
    // slash, deeper ones are ordinary path separators.
    assert.equal(safeNext("/a//b"), "/a//b");
  });
});

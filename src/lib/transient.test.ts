// ── Transient-error unit tests ───────────────────────────────
// Run with:  npm test
//
// The risk in both directions: retrying an error that will never
// succeed, or showing a user a JWT message they cannot act on.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isTransientError } from "./transient.ts";

describe("isTransientError", () => {
  it("recognises the session and connection errors that clear by themselves", () => {
    for (const message of [
      'invalid claim: "iat" is in the future (JWT issued at future)',
      "JWT expired",
      "token is expired by 2s",
      "TypeError: fetch failed",
      "read ECONNRESET",
      "503 Service Unavailable",
    ]) {
      assert.equal(isTransientError(message), true, message);
    }
  });

  it("leaves errors about the data alone", () => {
    for (const message of [
      'Field key "brand" is already defined by an ancestor category.',
      "Destructive change to \"price\" has no remediation.",
      "Only a SCHEMA_ADMIN may change the schema.",
      "This schema changed while you were editing it: it is at v4 now.",
      "",
      null,
    ]) {
      assert.equal(isTransientError(message), false, String(message));
    }
  });
});

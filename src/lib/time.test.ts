// ── Relative time unit tests ─────────────────────────────────
// Run with:  npm test

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { timeAgo } from "./time.ts";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const before = (ms: number) => new Date(NOW - ms).toISOString();

describe("timeAgo", () => {
  it("says just now under a minute", () => {
    assert.equal(timeAgo(before(30_000), NOW), "just now");
  });

  it("picks the largest whole unit", () => {
    assert.equal(timeAgo(before(5 * 60_000), NOW), "5 minutes ago");
    assert.equal(timeAgo(before(3 * 3_600_000), NOW), "3 hours ago");
    assert.equal(timeAgo(before(2 * 86_400_000), NOW), "2 days ago");
  });

  it("uses words where English does", () => {
    assert.equal(timeAgo(before(86_400_000), NOW), "yesterday");
  });
});

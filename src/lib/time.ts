// ── Relative time ────────────────────────────────────────────

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/**
 * "2 days ago". Falls back to "just now" under a minute. `now` is a
 * parameter so the tests do not depend on the clock. It changes between
 * the server render and hydration, so render it with
 * suppressHydrationWarning.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return formatter.format(-Math.round(elapsed / ms), unit);
    }
  }
  return "just now";
}

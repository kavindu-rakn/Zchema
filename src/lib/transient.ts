// ── Errors worth trying again ────────────────────────────────
// A token that has just rotated, or a clock a second out of step with
// Supabase's, makes PostgREST reject exactly one request — "JWT issued
// at future" — and the page lands on its error boundary showing a
// message no user can act on. Trying again a moment later works.
//
// Deliberately narrow: only errors that are about the connection or the
// session, never about the data. A trigger saying a field key is taken
// must be shown, not retried.

const TRANSIENT = [
  /\bjwt\b/i, // issued at future, expired, malformed after a rotation
  /token is expired/i,
  /jws|jwk/i,
  /fetch failed/i,
  /network|econnreset|etimedout|socket hang up/i,
  /502|503|504/,
];

export function isTransientError(message: string | null | undefined): boolean {
  if (!message) return false;
  return TRANSIENT.some((pattern) => pattern.test(message));
}

/** What to show when a retry did not help either. */
export const TRANSIENT_MESSAGE =
  "Zchema could not reach the database just then. This usually clears by itself.";

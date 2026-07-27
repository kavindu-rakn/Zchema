// ── Server-action error normalisation ────────────────────────

/**
 * Turn a thrown value into a toast-safe failure result.
 *
 * Database triggers in this project raise human-readable messages
 * ("Field key \"brand\" is already defined by an ancestor category…"),
 * so an Error's message is worth surfacing verbatim. Anything that is
 * not an Error falls back to a generic message rather than leaking an
 * unknown shape to the client.
 */
export function actionError(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof Error && error.message) {
    return { ok: false, error: error.message };
  }
  return { ok: false, error: fallback };
}

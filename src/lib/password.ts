// ── Password policy (client side) ────────────────────────────
// Shared by signup and password reset so the two forms cannot drift.
// This is a UX floor only — the real boundary is Supabase Auth's own
// minimum (Authentication → Policies in the dashboard), which should be
// set to at least this value or the server will accept shorter ones
// submitted outside these forms.
export const MIN_PASSWORD_LENGTH = 8;

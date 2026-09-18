// ── Post-auth redirect validation ────────────────────────────
// The `next` parameter on /auth/callback is attacker-controlled, and the
// URL carrying it is the one delivered by the confirmation email — the
// link a user has been trained to trust. An unvalidated value is a
// phishing primitive, so this is the one place that decides where a
// freshly authenticated session is allowed to land.
//
// Lives here rather than in the route file because a Next.js route
// module may only export route handlers; a helper exported alongside GET
// is a build error. Being a plain module also makes it unit-testable.

export const DEFAULT_REDIRECT = "/dashboard";

/**
 * Reduce a caller-supplied `next` to a same-origin path, or the default.
 *
 * Checking only for a leading "/" is NOT enough — two shapes get past it
 * and both change the origin:
 *   "//evil.com"  protocol-relative; the browser loads evil.com
 *   "/\evil.com"  browsers normalise "\" to "/" inside the authority
 * And when the value is concatenated onto an origin (`${origin}${next}`),
 * a leading "@" turns the real host into userinfo:
 *   "https://ourapp.com" + "@evil.com" → the host is evil.com
 * The "@" shape cannot survive the leading-slash rule, but that rule only
 * saves us while callers concatenate. Anything not starting with exactly
 * one slash is rejected outright, so the guarantee holds either way.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_REDIRECT;
  if (!raw.startsWith("/")) return DEFAULT_REDIRECT;
  // Second character decides: "//" and "/\" both escape the origin.
  if (raw[1] === "/" || raw[1] === "\\") return DEFAULT_REDIRECT;
  // Control characters can split a Location header, or be stripped by the
  // browser in ways that change the target it actually parses. Checked by
  // code point rather than a regex literal so no control byte has to
  // survive being written into this source file.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return DEFAULT_REDIRECT;
  }
  return raw;
}

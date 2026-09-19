// ── Content Security Policy ──────────────────────────────────
// Built per request in src/proxy.ts, around a fresh nonce. Pure so the
// policy itself — the part that is easy to loosen by accident — is
// unit-tested without a request.
//
// The one directive that matters most is script-src. Next.js stamps the
// nonce on every script it renders, and 'strict-dynamic' lets those
// scripts load their own chunks. There is no 'unsafe-inline': a script
// injected through item data has no nonce, so it does not run.

export interface CspOptions {
  /** Fresh per request, unguessable. */
  nonce: string;
  /** React needs eval in development for its error overlays. */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL — the browser talks to it for auth. */
  supabaseUrl?: string;
}

export function contentSecurityPolicy({ nonce, dev, supabaseUrl }: CspOptions): string {
  const supabase = originOf(supabaseUrl);

  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    ["script-src", "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // Style ATTRIBUTES — React's style={}, framer-motion — cannot carry a
    // nonce, and listing a nonce here would make browsers ignore
    // 'unsafe-inline'. CSS cannot run script, so this is the usual trade.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    // https: rather than a list, deliberately. The import wizard's
    // "fetch a URL" mode reads any https address FROM THE BROWSER — a
    // server-side fetch of a user-supplied URL would be SSRF. Supabase is
    // named as well so a local http instance works in development.
    ["connect-src", "'self'", ...(supabase ? [supabase] : []), "https:", ...(dev ? ["ws:"] : [])],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    // Nobody may frame the app: the destructive dialogs are one click.
    ["frame-ancestors", "'none'"],
    // Not on http://localhost, where there is nothing to upgrade to.
    ...(dev ? [] : [["upgrade-insecure-requests"] as [string]]),
  ];

  return directives.map((parts) => parts.join(" ")).join("; ");
}

/** A fresh nonce: a v4 UUID's 122 random bits, base64-encoded. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

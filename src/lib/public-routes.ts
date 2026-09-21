// ── Routes reachable without a session ──────────────────────
// Called from src/utils/supabase/middleware.ts on every request the
// proxy matcher does not skip. Pure, so the list — the part that is
// easy to loosen by accident, and easy to tighten by accident — is
// unit-tested without a request.

const PUBLIC_ROUTES = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  // The PKCE code-exchange landing page. By definition there is no
  // session yet when it is hit, so omitting it bounces every
  // confirmation link to /login before exchangeCodeForSession() can
  // run — which silently breaks email verification and any future
  // OAuth or magic-link flow.
  "/auth/callback",
  // The web app manifest. Browsers fetch it before anyone has signed
  // in — to name a bookmark, to offer "Install app" — and a 307 to
  // /login makes that fail with no error anyone sees. It is the only
  // metadata route that needs naming here: the rest end in .ico, .svg
  // or .png and never reach the middleware at all, because the matcher
  // in src/proxy.ts skips those extensions.
  "/manifest.webmanifest",
]);

// /update-password is deliberately NOT public: it is only useful with
// the session /auth/callback creates from a reset link.
export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.has(pathname);
}

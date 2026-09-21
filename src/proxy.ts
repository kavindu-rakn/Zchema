import { type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "@/lib/csp";
import { updateSession } from "@/utils/supabase/middleware";

export async function proxy(request: NextRequest) {
  // A fresh nonce per request. Next.js reads it back out of the REQUEST's
  // CSP header while rendering and stamps it on its own scripts; the root
  // layout reads x-nonce for the one inline script written by hand. The
  // RESPONSE header is what the browser enforces.
  const nonce = createNonce();
  const csp = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);

  // updateSession forwards request.headers, so the two above reach the
  // renderer on every path through it.
  const response = await updateSession(request);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public assets (svg, png, jpg, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

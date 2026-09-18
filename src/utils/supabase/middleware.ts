import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: DO NOT remove this line.
  // Refreshing the auth token ensures the session stays alive.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If user is not signed in and the current path is not public,
  // redirect to /login.
  //
  // /auth/callback MUST be public. It is the PKCE code-exchange landing
  // page, so by definition there is no session yet when it is hit —
  // omitting it bounced every confirmation link to /login before
  // exchangeCodeForSession() could run, which silently broke email
  // verification and any future OAuth or magic-link flow.
  const path = request.nextUrl.pathname;
  const isPublicRoute =
    path === "/" ||
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/auth/callback";
  // /update-password is deliberately NOT public: it is only useful with
  // the session /auth/callback creates from a reset link.

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirect = NextResponse.redirect(url);
    // Carry over any cookies the getUser() refresh above set. Returning
    // a bare redirect discards them, which logs the user out spuriously
    // the next time a token rotates.
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return supabaseResponse;
}

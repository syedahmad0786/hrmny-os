import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, updateSession } from "@/lib/supabase/middleware";
import { getAuthModeFromEnv } from "@/lib/auth-mode";

/**
 * Edge middleware — security headers + optional Supabase session gate.
 *
 * When AUTH_MODE=supabase, anonymous visitors are redirected to /login
 * (or /portal/login for portal routes). AUTH_MODE=dev keeps the x-dev-role
 * demo path open (no cookie gate).
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  if (getAuthModeFromEnv() === "supabase" && !user) {
    const { pathname } = request.nextUrl;
    if (!isPublicPath(pathname)) {
      const login = request.nextUrl.clone();
      login.pathname = pathname.startsWith("/portal")
        ? "/portal/login"
        : "/login";
      login.searchParams.set("next", pathname);
      return NextResponse.redirect(login);
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

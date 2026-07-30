import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge middleware — baseline security headers on every app/API response.
 *
 * Deliberately headers-only: auth stays enforced per-handler (tRPC context +
 * webhook signature checks), so this cannot fail-open or break the dev-role
 * header / Supabase bearer flows. Deferred: edge-level auth enforcement and a
 * tuned Content-Security-Policy (both need per-route calibration — a wrong CSP
 * silently breaks the app).
 */
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-DNS-Prefetch-Control": "off",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  // Ignored by browsers over plain http (local dev), enforced on HTTPS prod.
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
};

export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

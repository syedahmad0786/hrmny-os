import { NextResponse, type NextRequest } from "next/server";
import { SECURITY_HEADERS } from "../security-headers";

/**
 * Diagnostic Edge probe for the baseline security headers.
 *
 * The live policy is emitted by next.config.ts without a per-request Edge
 * response bridge. Auth remains enforced per-handler (tRPC context + webhook
 * signatures). A tuned Content-Security-Policy still needs route calibration.
 */
export function middleware(_request: NextRequest) {
  const response = NextResponse.next();
  for (const { key, value } of SECURITY_HEADERS) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  // The active header policy is emitted by next.config.ts without an Edge
  // response bridge. Retain this bounded probe only for platform diagnostics.
  matcher: ["/__edge-security-header-probe"],
};

import { NextResponse } from "next/server";
import {
  googleWorkspaceConnectionsDest,
  googleWorkspaceRedirectUri,
  verifyGoogleWorkspaceOAuthState,
} from "@/server/google-workspace-oauth";

/**
 * Return the code to the authenticated Connections page. The public callback
 * never exchanges or saves tokens; the staff API verifies the completing user.
 *
 * Google Cloud must allow this exact URI on the OAuth client:
 *   {page origin}/api/integrations/google-workspace/callback
 */
function destFromStateOrRequest(request: Request, state: string | null): URL {
  if (state) {
    try {
      return googleWorkspaceConnectionsDest(
        verifyGoogleWorkspaceOAuthState(state).redirectUri,
      );
    } catch {
      // Fall through to the request-derived callback.
    }
  }
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestOrigin =
    forwardedHost && forwardedProto
      ? `${forwardedProto.split(",")[0]!.trim()}://${forwardedHost.split(",")[0]!.trim()}`
      : undefined;
  return googleWorkspaceConnectionsDest(
    googleWorkspaceRedirectUri(requestOrigin),
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const dest = destFromStateOrRequest(request, state);

  if (err) {
    dest.searchParams.set("gw", "error");
    dest.searchParams.set("reason", err);
    return NextResponse.redirect(dest);
  }
  if (!code || !state) {
    dest.searchParams.set("gw", "error");
    dest.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(dest);
  }

  try {
    verifyGoogleWorkspaceOAuthState(state);
    // A fragment keeps the authorization code out of subsequent HTTP requests.
    dest.hash = new URLSearchParams({ gw: "complete", code, state }).toString();
  } catch (e) {
    dest.searchParams.set("gw", "error");
    dest.searchParams.set(
      "reason",
      e instanceof Error ? e.message.slice(0, 160) : "exchange_failed",
    );
  }
  return NextResponse.redirect(dest, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

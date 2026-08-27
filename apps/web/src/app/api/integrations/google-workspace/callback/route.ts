import { NextResponse } from "next/server";
import { completeGoogleWorkspaceOAuth } from "@/server/google-workspace-oauth";

/**
 * Google Workspace OAuth redirect target. Exchanges the code with the same
 * GOOGLE_OAUTH_* client used for token refresh, persists tokens to Vault,
 * then sends staff back to Connections.
 *
 * Add this exact URI to the Google Cloud OAuth client:
 *   {NEXT_PUBLIC_APP_URL}/api/integrations/google-workspace/callback
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  const dest = new URL("/settings/connections", appBase);
  dest.hash = "conn-google_workspace";

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
    const result = await completeGoogleWorkspaceOAuth({ code, state });
    dest.searchParams.set("gw", "connected");
    dest.searchParams.set("account", result.account);
  } catch (e) {
    dest.searchParams.set("gw", "error");
    dest.searchParams.set(
      "reason",
      e instanceof Error ? e.message.slice(0, 160) : "exchange_failed",
    );
  }
  return NextResponse.redirect(dest);
}

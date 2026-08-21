import { NextResponse } from "next/server";
import { completeXeroOAuth } from "@/server/finance/xero-tokens";

/**
 * Xero OAuth redirect target. Exchanges code, persists tokens to Vault,
 * then sends staff back to Connections.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  const appBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000";
  const dest = new URL("/settings/connections", appBase);

  if (err) {
    dest.searchParams.set("xero", "error");
    dest.searchParams.set("reason", err);
    return NextResponse.redirect(dest);
  }
  if (!code || !state) {
    dest.searchParams.set("xero", "error");
    dest.searchParams.set("reason", "missing_code");
    return NextResponse.redirect(dest);
  }

  try {
    const result = await completeXeroOAuth({ code, state });
    dest.searchParams.set("xero", "connected");
    dest.searchParams.set("tenant", result.tenantId);
  } catch (e) {
    dest.searchParams.set("xero", "error");
    dest.searchParams.set(
      "reason",
      e instanceof Error ? e.message.slice(0, 120) : "exchange_failed",
    );
  }
  return NextResponse.redirect(dest);
}

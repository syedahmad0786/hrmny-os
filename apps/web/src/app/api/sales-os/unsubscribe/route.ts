import { NextResponse } from "next/server";
import { honorUnsubscribe } from "@/server/sales-os/replies";

export const dynamic = "force-dynamic";

/** One-click unsubscribe — no auth. Adds the address to the suppression list. */
export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json({ ok: false, error: "email required" }, { status: 400 });
  }
  await honorUnsubscribe({ email, source: "one-click" });
  return new NextResponse(
    `<!doctype html><html><body style="font-family:sans-serif;padding:2rem">
      <h1>You are unsubscribed</h1>
      <p>${email} will not receive further hrmny outreach.</p>
    </body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function POST(request: Request) {
  return GET(request);
}

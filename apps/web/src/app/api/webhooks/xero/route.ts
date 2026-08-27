import { emitHealthSignal } from "@/server/m1-persistence";
import { verifyXeroSignature } from "./verify";

/**
 * POST /api/webhooks/xero
 *
 * Official Intent-to-Receive + event delivery.
 * - Verify `x-xero-signature` over the raw body.
 * - 200 empty body on match, 401 empty body on mismatch (no cookies).
 * - Empty `events` is the ITR handshake — acknowledge only.
 * - Invoice events enqueue a read-only mirror sync. Never writes Xero.
 *
 * Callback / destination URL (production):
 * https://hrmny-os.vercel.app/api/webhooks/xero
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const verify = verifyXeroSignature(raw, request.headers.get("x-xero-signature"));
  if (!verify.ok) {
    return new Response(null, { status: 401 });
  }

  let eventCount = 0;
  let categories: string[] = [];
  try {
    const body = raw ? (JSON.parse(raw) as { events?: Array<{ eventCategory?: string }> }) : {};
    const events = Array.isArray(body.events) ? body.events : [];
    eventCount = events.length;
    categories = [
      ...new Set(events.map((e) => String(e.eventCategory ?? "UNKNOWN"))),
    ];
    if (eventCount > 0) {
      const { syncXeroInvoiceMirror } = await import(
        "@/server/finance/xero-mirror-sync"
      );
      await syncXeroInvoiceMirror().catch(() => undefined);
      await emitHealthSignal("xero_webhook", "info", {
        eventCount,
        categories,
        verified: verify.reason,
      }).catch(() => undefined);
    }
  } catch {
    // ITR payloads must still 200 after a valid signature.
  }

  return new Response(null, { status: 200 });
}

export async function GET() {
  return Response.json({
    ok: true,
    endpoint: "/api/webhooks/xero",
    methods: ["POST"],
    signature: "x-xero-signature HMAC-SHA256 base64 of raw body",
    docs: "https://developer.xero.com/documentation/guides/webhooks/overview/",
    writeEnabled: process.env.XERO_WRITE_ENABLED === "true",
  });
}

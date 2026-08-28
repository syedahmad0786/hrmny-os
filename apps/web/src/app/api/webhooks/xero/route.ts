import { createHash } from "node:crypto";
import { recordIntegrationReceipt } from "@/server/integrations/inbox";
import { verifyXeroSignature } from "./verify";

/**
 * POST /api/webhooks/xero
 *
 * Official Intent-to-Receive + event delivery.
 * - Verify `x-xero-signature` over the raw body.
 * - 200 empty body on match, 401 empty body on mismatch (no cookies).
 * - Empty `events` is the ITR handshake — acknowledge only.
 * - Event envelopes are written to the replay-safe integration inbox.
 * - The scheduled reconciliation reads current Xero state; the receiver never
 *   calls Xero in the five-second acknowledgement window and never writes Xero.
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

  try {
    const body = raw
      ? (JSON.parse(raw) as {
          events?: Array<{
            eventId?: string;
            eventCategory?: string;
            eventType?: string;
            resourceId?: string;
          }>;
          firstEventSequence?: number;
          lastEventSequence?: number;
          entropy?: string;
        })
      : {};
    const events = Array.isArray(body.events) ? body.events : [];
    // Intent-to-Receive is signature validation only and must not depend on DB.
    if (events.length === 0) return new Response(null, { status: 200 });

    const envelopeId = `envelope:${createHash("sha256").update(raw).digest("hex")}`;
    await recordIntegrationReceipt({
      provider: "xero",
      externalEventId: envelopeId,
      operation: "accounting.webhook.invoice",
      rawBody: raw,
      payload: {
        firstEventSequence: body.firstEventSequence ?? null,
        lastEventSequence: body.lastEventSequence ?? null,
        eventIds: events.map((event) => event.eventId).filter(Boolean),
        categories: [...new Set(events.map((event) => event.eventCategory ?? "UNKNOWN"))],
        types: [...new Set(events.map((event) => event.eventType ?? "UNKNOWN"))],
        resourceIds: events.map((event) => event.resourceId).filter(Boolean),
      },
      completed: true,
      result: { reconciliation: "scheduled-read-current-state" },
    });
  } catch {
    // A valid event that was not durably recorded must be retried by Xero.
    return new Response(null, { status: 503 });
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

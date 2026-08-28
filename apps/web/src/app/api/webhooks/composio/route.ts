import { emitHealthSignal, writeAudit } from "@/server/m1-persistence";
import { recordIntegrationReceipt } from "@/server/integrations/inbox";
import { verifyComposioSignature } from "./verify";

/**
 * POST /api/webhooks/composio
 *
 * Official Composio trigger ingress. Verifies HMAC, records an audit + health
 * signal, and acknowledges. Connection reconcile / tool execution stays
 * fail-closed until a separately approved live Composio subscription exists.
 *
 * Destination URL (production): https://hrmny-os.vercel.app/api/webhooks/composio
 * Docs: https://docs.composio.dev/docs/webhook-verification
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const raw = await request.text();
  const verify = verifyComposioSignature({
    rawBody: raw,
    signature: request.headers.get("webhook-signature"),
    webhookId: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
  });
  if (!verify.ok) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED", reason: verify.reason },
      { status: 401 },
    );
  }

  let triggerSlug = "unknown";
  try {
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const metadata =
      body.metadata && typeof body.metadata === "object"
        ? (body.metadata as Record<string, unknown>)
        : {};
    triggerSlug = String(
      metadata.trigger_slug ?? metadata.triggerSlug ?? body.type ?? "unknown",
    );
  } catch {
    /* acknowledge signed but unparseable bodies */
  }

  const webhookId = request.headers.get("webhook-id") ?? "unknown";
  let receipt;
  try {
    receipt = await recordIntegrationReceipt({
      provider: "composio",
      externalEventId: webhookId,
      operation: `trigger.${triggerSlug}`,
      rawBody: raw,
      payload: { triggerSlug },
      completed: true,
      result: { handled: "acknowledged", sideEffects: false },
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 200) : "receipt_failed";
    const conflict = reason === "INTEGRATION_RECEIPT_PAYLOAD_MISMATCH";
    return Response.json(
      {
        ok: false,
        code: conflict ? "EVENT_ID_CONFLICT" : "RECEIPT_UNAVAILABLE",
        reason,
      },
      { status: conflict ? 409 : 503 },
    );
  }
  if (receipt.duplicate) {
    return Response.json({
      ok: true,
      received: true,
      duplicate: true,
      webhookId,
      triggerSlug,
      handled: "acknowledged",
    });
  }
  await emitHealthSignal("composio_webhook", "info", {
    webhookId,
    triggerSlug,
    handled: "acknowledged",
  }).catch(() => undefined);
  await writeAudit({
    actorEmployeeId: null,
    action: "composio.webhook.received",
    entityType: "connection_account",
    entityId: webhookId,
    before: null,
    after: { triggerSlug, verified: verify.reason },
    reason: "composio inbound ack — no side effects",
  }).catch(() => undefined);

  return Response.json({
    ok: true,
    received: true,
    webhookId,
    triggerSlug,
    handled: "acknowledged",
    duplicate: false,
  });
}

export async function GET() {
  return Response.json({
    ok: true,
    endpoint: "/api/webhooks/composio",
    methods: ["POST"],
    signature: "webhook-signature v1,base64 HMAC over webhook-id.timestamp.body",
    docs: "https://docs.composio.dev/docs/webhook-verification",
  });
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Official Composio webhook verification (V3):
 * HMAC-SHA256(`${webhook-id}.${webhook-timestamp}.${rawBody}`, secret)
 * compared to `webhook-signature` formatted `v1,<base64>`.
 *
 * https://docs.composio.dev/docs/webhook-verification
 * https://github.com/ComposioHQ/composio
 */
export function verifyComposioSignature(input: {
  rawBody: string;
  signature: string | null;
  webhookId: string | null;
  timestamp: string | null;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): { ok: boolean; reason: string } {
  const secret = process.env.COMPOSIO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return { ok: false, reason: "COMPOSIO_WEBHOOK_SECRET not configured" };
  }
  const signature = input.signature?.trim();
  const webhookId = input.webhookId?.trim();
  const timestamp = input.timestamp?.trim();
  if (!signature || !webhookId || !timestamp) {
    return { ok: false, reason: "missing webhook-id, webhook-timestamp, or webhook-signature" };
  }
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const ts = Number(timestamp);
  const skew = input.maxSkewSeconds ?? 300;
  if (!Number.isFinite(ts) || Math.abs(now - ts) > skew) {
    return { ok: false, reason: "timestamp outside tolerance" };
  }
  const signingString = `${webhookId}.${timestamp}.${input.rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(signingString, "utf8")
    .digest("base64");
  const received = signature.includes(",")
    ? signature.split(",")[1] ?? ""
    : signature;
  return safeEqual(expected, received)
    ? { ok: true, reason: "hmac-sha256-v1" }
    : { ok: false, reason: "signature mismatch" };
}

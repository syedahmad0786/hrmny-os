import { createHash, createHmac, timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Official Xero webhook signature:
 * HMAC-SHA256(raw body, webhook key) → Base64, compared to `x-xero-signature`.
 * https://developer.xero.com/documentation/guides/webhooks/overview/
 * https://github.com/XeroAPI/Xero-OpenAPI/blob/master/xero-webhooks.yaml
 */
export function verifyXeroSignature(
  rawBody: string,
  signatureHeader: string | null,
): { ok: boolean; reason: string } {
  const key = process.env.XERO_WEBHOOK_KEY?.trim();
  if (!key) {
    return { ok: false, reason: "XERO_WEBHOOK_KEY not configured" };
  }
  const signature = signatureHeader?.trim();
  if (!signature) {
    return { ok: false, reason: "missing x-xero-signature" };
  }
  const expected = createHmac("sha256", key).update(rawBody, "utf8").digest("base64");
  return safeEqual(expected, signature)
    ? { ok: true, reason: "hmac-sha256-base64" }
    : { ok: false, reason: "signature mismatch" };
}

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Constant-time string compare; hashes to a fixed length so it never throws. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Verify an n8n webhook against N8N_WEBHOOK_SECRET.
 * - `sha256=<hex>` → HMAC-SHA256 of the raw body (preferred).
 * - otherwise → the shared secret sent verbatim as a static header token.
 * Fails closed: no secret configured ⇒ reject in production.
 */
export function verifyN8nSignature(
  rawBody: string,
  signatureHeader: string | null,
): { ok: boolean; reason: string } {
  const secret =
    process.env.N8N_WEBHOOK_SECRET?.trim() ||
    process.env.HRMNY_N8N_WEBHOOK_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret) {
    const requireSecret =
      process.env.NODE_ENV === "production" ||
      process.env.N8N_WEBHOOK_REQUIRE_SECRET === "true";
    if (requireSecret) {
      return { ok: false, reason: "N8N_WEBHOOK_SECRET not configured" };
    }
    return {
      ok: true,
      reason: "N8N_WEBHOOK_SECRET unset — accepted in non-production only",
    };
  }
  const signature = signatureHeader?.trim();
  if (!signature) {
    return { ok: false, reason: "missing signature header" };
  }
  const hmac = /^sha256=([0-9a-f]{64})$/i.exec(signature);
  if (hmac) {
    const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
    return safeEqual(hmac[1]!.toLowerCase(), expected)
      ? { ok: true, reason: "hmac-sha256" }
      : { ok: false, reason: "signature mismatch" };
  }
  return safeEqual(signature, secret)
    ? { ok: true, reason: "shared-secret" }
    : { ok: false, reason: "signature mismatch" };
}

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyN8nSignature } from "./verify";

const SECRET = "s3cr3t-n8n-webhook-key";
const BODY = JSON.stringify({ event: "lead.created", id: 42 });

function hmac(secret: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyN8nSignature", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts a valid HMAC-SHA256 signature", () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    expect(verifyN8nSignature(BODY, hmac(SECRET, BODY)).ok).toBe(true);
  });

  it("accepts the shared secret sent as a static header token", () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    expect(verifyN8nSignature(BODY, SECRET).ok).toBe(true);
  });

  it("rejects an HMAC computed with the wrong secret", () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    expect(verifyN8nSignature(BODY, hmac("wrong-secret", BODY)).ok).toBe(false);
  });

  it("rejects a tampered body under a previously valid signature", () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    const sig = hmac(SECRET, BODY);
    expect(verifyN8nSignature(BODY + "tampered", sig).ok).toBe(false);
  });

  it("rejects a wrong shared-secret token", () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    expect(verifyN8nSignature(BODY, "not-the-secret").ok).toBe(false);
  });

  it("rejects when the signature header is missing but a secret is set", () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", SECRET);
    expect(verifyN8nSignature(BODY, null).ok).toBe(false);
  });

  it("fails closed in production when the secret is unset", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "");
    expect(verifyN8nSignature(BODY, null).ok).toBe(false);
  });

  it("accepts an unsigned body only in non-production when the secret is unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "");
    expect(verifyN8nSignature(BODY, null).ok).toBe(true);
  });

  it("fails closed in non-production when N8N_WEBHOOK_REQUIRE_SECRET=true", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("N8N_WEBHOOK_SECRET", "");
    vi.stubEnv("N8N_WEBHOOK_REQUIRE_SECRET", "true");
    expect(verifyN8nSignature(BODY, null).ok).toBe(false);
  });
});

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyXeroSignature } from "./verify";

const KEY = "xero-webhook-key";
const BODY = JSON.stringify({
  events: [],
  firstEventSequence: 0,
  lastEventSequence: 0,
  entropy: "S0m3r4Nd0mt3xt",
});

function sign(body: string, key = KEY) {
  return createHmac("sha256", key).update(body, "utf8").digest("base64");
}

describe("verifyXeroSignature", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts an official HMAC-SHA256 base64 signature", () => {
    vi.stubEnv("XERO_WEBHOOK_KEY", KEY);
    expect(verifyXeroSignature(BODY, sign(BODY)).ok).toBe(true);
  });

  it("rejects a wrong key (Intent to Receive incorrect payload)", () => {
    vi.stubEnv("XERO_WEBHOOK_KEY", KEY);
    expect(verifyXeroSignature(BODY, sign(BODY, "other")).ok).toBe(false);
  });

  it("fails closed without a webhook key", () => {
    vi.stubEnv("XERO_WEBHOOK_KEY", "");
    expect(verifyXeroSignature(BODY, sign(BODY)).ok).toBe(false);
  });
});

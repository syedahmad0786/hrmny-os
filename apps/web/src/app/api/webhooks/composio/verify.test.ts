import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyComposioSignature } from "./verify";

const SECRET = "composio-webhook-secret";
const BODY = JSON.stringify({
  metadata: { trigger_slug: "GMAIL_NEW_EMAIL" },
  data: {},
});
const ID = "msg_1";
const TS = "1787871000";

function sign(id: string, ts: string, body: string, secret = SECRET) {
  const digest = createHmac("sha256", secret)
    .update(`${id}.${ts}.${body}`, "utf8")
    .digest("base64");
  return `v1,${digest}`;
}

describe("verifyComposioSignature", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the official v1,base64 HMAC over id.timestamp.body", () => {
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", SECRET);
    expect(
      verifyComposioSignature({
        rawBody: BODY,
        signature: sign(ID, TS, BODY),
        webhookId: ID,
        timestamp: TS,
        nowSeconds: Number(TS),
      }).ok,
    ).toBe(true);
  });

  it("rejects a stale timestamp", () => {
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", SECRET);
    expect(
      verifyComposioSignature({
        rawBody: BODY,
        signature: sign(ID, TS, BODY),
        webhookId: ID,
        timestamp: TS,
        nowSeconds: Number(TS) + 301,
      }).ok,
    ).toBe(false);
  });

  it("fails closed without a secret", () => {
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", "");
    expect(
      verifyComposioSignature({
        rawBody: BODY,
        signature: sign(ID, TS, BODY),
        webhookId: ID,
        timestamp: TS,
        nowSeconds: Number(TS),
      }).ok,
    ).toBe(false);
  });
});

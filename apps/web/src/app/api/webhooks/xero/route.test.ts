import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIntegrationReceiptMemory } from "@/server/integrations/inbox";
import { POST } from "./route";

const KEY = "xero-webhook-key";

function request(body: string, key = KEY): Request {
  const signature = createHmac("sha256", key)
    .update(body, "utf8")
    .digest("base64");
  return new Request("http://localhost/api/webhooks/xero", {
    method: "POST",
    headers: { "x-xero-signature": signature },
    body,
  });
}

describe("Xero webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("XERO_WEBHOOK_KEY", KEY);
    resetIntegrationReceiptMemory();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("acknowledges Intent-to-Receive without a database dependency", async () => {
    const body = JSON.stringify({
      events: [],
      firstEventSequence: 0,
      lastEventSequence: 0,
      entropy: "proof",
    });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });

  it("records and safely acknowledges a replayed event envelope", async () => {
    const body = JSON.stringify({
      events: [
        {
          eventId: "event-1",
          eventCategory: "INVOICE",
          eventType: "UPDATE",
          resourceId: "invoice-1",
        },
      ],
      firstEventSequence: 10,
      lastEventSequence: 10,
      entropy: "proof",
    });
    expect((await POST(request(body))).status).toBe(200);
    expect((await POST(request(body))).status).toBe(200);
  });

  it("returns the official 401 response for a bad signature", async () => {
    const body = JSON.stringify({ events: [] });
    expect((await POST(request(body, "wrong"))).status).toBe(401);
  });
});

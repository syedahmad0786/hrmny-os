import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIntegrationReceiptMemory } from "@/server/integrations/inbox";
import { POST } from "./route";

const SECRET = "composio-webhook-secret";

function request(id: string, body: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", SECRET)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest("base64");
  return new Request("http://localhost/api/webhooks/composio", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${digest}`,
    },
    body,
  });
}

describe("Composio webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("DATABASE_URL", "");
    resetIntegrationReceiptMemory();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("durably claims a signed event before acknowledging a replay", async () => {
    const body = JSON.stringify({
      metadata: { trigger_slug: "GMAIL_NEW_EMAIL" },
      data: {},
    });
    const first = await POST(request("msg_1", body));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      ok: true,
      duplicate: false,
      handled: "acknowledged",
    });

    const replay = await POST(request("msg_1", body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("rejects an invalid signature before creating a receipt", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/composio", {
        method: "POST",
        headers: {
          "webhook-id": "msg_bad",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,invalid",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a webhook id reused for a different signed payload", async () => {
    expect((await POST(request("msg_conflict", '{"value":1}'))).status).toBe(
      200,
    );
    const conflict = await POST(request("msg_conflict", '{"value":2}'));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "EVENT_ID_CONFLICT",
    });
  });
});

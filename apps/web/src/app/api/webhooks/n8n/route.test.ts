import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInboundLeadMemory } from "@/server/crm/inbound-leads";
import { resetIntegrationReceiptMemory } from "@/server/integrations/inbox";
import { POST } from "./route";

function request(body: Record<string, unknown>, eventId?: string) {
  return new Request("http://localhost/api/webhooks/n8n", {
    method: "POST",
    headers: {
      "x-hrmny-n8n-signature": "test-inbound-secret",
      ...(eventId ? { "idempotency-key": eventId } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("n8n webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "test-inbound-secret");
    vi.stubEnv("DATABASE_URL", "");
    resetInboundLeadMemory();
    resetIntegrationReceiptMemory();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("requires a stable event id for every signed callback", async () => {
    const response = await POST(request({ event: "workflow.completed" }));
    expect(response.status).toBe(400);
  });

  it("records an unhandled callback and acknowledges its replay", async () => {
    const body = { event: "workflow.completed", result: "ok" };
    const first = await POST(request(body, "execution-001"));
    const replay = await POST(request(body, "execution-001"));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ handled: false, duplicate: false });
    expect(await replay.json()).toMatchObject({ handled: false, duplicate: true });
  });

  it("rejects an event id reused for another payload", async () => {
    expect(
      (await POST(request({ event: "workflow.completed" }, "execution-002")))
        .status,
    ).toBe(200);
    const conflict = await POST(
      request({ event: "workflow.failed" }, "execution-002"),
    );
    expect(conflict.status).toBe(409);
  });
});

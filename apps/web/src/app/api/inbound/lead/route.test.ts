import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

function jsonRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/inbound/lead", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("/api/inbound/lead", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("describes the endpoint on GET", async () => {
    const res = await GET();
    const body = (await res.json()) as { endpoint: string };
    expect(body.endpoint).toBe("/api/inbound/lead");
  });

  it("returns 503 when no webhook secret is configured", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "");
    vi.stubEnv("HRMNY_N8N_WEBHOOK_SECRET", "");
    const res = await POST(jsonRequest({ company: "Acme", email: "a@b.co" }));
    expect(res.status).toBe(503);
  });

  it("returns 401 when the shared secret does not match", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "expected-secret");
    const res = await POST(
      jsonRequest(
        { company: "Acme", email: "a@b.co" },
        { "x-webhook-secret": "wrong" },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when company/email aliases are missing", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "expected-secret");
    const res = await POST(
      jsonRequest(
        { name: "Pat" },
        {
          "x-webhook-secret": "expected-secret",
          "idempotency-key": "test-invalid-001",
        },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("accepts n8n aliases and creates an inbound lead", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "expected-secret");
    const res = await POST(
      jsonRequest(
        {
          company: "Inbound Co LLC",
          email: "pat@inbound.example",
          name: "Pat",
          source: "n8n-test",
        },
        {
          "x-webhook-secret": "expected-secret",
          "idempotency-key": "test-lead-001",
        },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      dealId: string;
      leadSourceLane: string;
    };
    expect(body.ok).toBe(true);
    expect(body.dealId).toBeTruthy();
    expect(body.leadSourceLane).toBe("inbound");
  });

  it("requires an explicit replay key", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "expected-secret");
    const res = await POST(
      jsonRequest(
        { company: "No Replay Key", email: "pat@noreplay.example" },
        { "x-webhook-secret": "expected-secret" },
      ),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      code: "VALIDATION",
      reason: expect.stringContaining("Idempotency-Key"),
    });
  });

  it("returns the original deal for a replayed event", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "expected-secret");
    const headers = {
      "x-webhook-secret": "expected-secret",
      "idempotency-key": "test-lead-replay-001",
    };
    const first = await POST(
      jsonRequest({ company: "Replay Co", email: "pat@replay.example" }, headers),
    );
    const second = await POST(
      jsonRequest({ company: "Replay Co", email: "pat@replay.example" }, headers),
    );
    const firstBody = (await first.json()) as { dealId: string };
    const secondBody = (await second.json()) as {
      dealId: string;
      duplicate: boolean;
    };
    expect(secondBody.dealId).toBe(firstBody.dealId);
    expect(secondBody.duplicate).toBe(true);
  });

  it("rejects reuse of an idempotency key for a different lead", async () => {
    vi.stubEnv("N8N_WEBHOOK_SECRET", "expected-secret");
    const headers = {
      "x-webhook-secret": "expected-secret",
      "idempotency-key": "test-lead-conflict-001",
    };
    expect(
      (
        await POST(
          jsonRequest(
            { company: "Original Co", email: "pat@original.example" },
            headers,
          ),
        )
      ).status,
    ).toBe(200);
    const conflict = await POST(
      jsonRequest(
        { company: "Different Co", email: "pat@different.example" },
        headers,
      ),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "CONFLICT" });
  });
});

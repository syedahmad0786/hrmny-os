import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createN8nMock,
  createN8nAdapter,
  normalizeN8nBaseUrl,
  resolveN8nWebhookUrl,
  getN8nWebhookUrlOverride,
  N8N_DEFAULT_BASE_URL,
  N8N_EVENT_MAP,
  mapCrmEventToWebhookPath,
} from "../index";

describe("n8n config + event map", () => {
  it("normalizes base URL without trailing slash", () => {
    expect(normalizeN8nBaseUrl("https://hrmny.app.n8n.cloud/")).toBe(
      "https://hrmny.app.n8n.cloud",
    );
    expect(normalizeN8nBaseUrl(undefined)).toBe(N8N_DEFAULT_BASE_URL);
  });

  it("maps CRM events to webhook paths", () => {
    expect(mapCrmEventToWebhookPath("deal.won")).toBe("hrmny-deal-won");
    expect(mapCrmEventToWebhookPath("ticket.created")).toBe(
      "hrmny-ticket-created",
    );
    expect(N8N_EVENT_MAP.length).toBeGreaterThanOrEqual(5);
  });

  it("resolves webhook URL overrides without API key", () => {
    const env = {
      N8N_WEBHOOK_DEAL_WON: "https://hrmny.app.n8n.cloud/webhook/hrmny-deal-won",
    } as NodeJS.ProcessEnv;
    expect(getN8nWebhookUrlOverride("hrmny-deal-won", env)).toBe(
      "https://hrmny.app.n8n.cloud/webhook/hrmny-deal-won",
    );
    expect(
      resolveN8nWebhookUrl(
        "https://hrmny.app.n8n.cloud",
        "hrmny-ticket-created",
        env,
      ),
    ).toBe("https://hrmny.app.n8n.cloud/webhook/hrmny-ticket-created");
  });
});

describe("n8n mock adapter", () => {
  it("health reports mock without requiring API key", async () => {
    const n8n = createN8nMock();
    const health = await n8n.health();
    expect(health.ok).toBe(true);
    expect(health.mode).toBe("mock");
    expect(health.baseUrl).toBe("https://hrmny.app.n8n.cloud");
  });

  it("lists mock workflows", async () => {
    const n8n = createN8nMock();
    const list = await n8n.listWorkflows();
    expect(list.some((w) => w.name === "hrmny-deal-won")).toBe(true);
  });

  it("propose never fires; trigger blocked without HITL allow", async () => {
    const n8n = createN8nAdapter();
    const proposal = await n8n.proposeWorkflow({
      event: "deal.won",
      payload: { dealId: "demo" },
    });
    expect(proposal.proposed).toBe(true);
    expect(proposal.webhookUrl).toContain("/webhook/hrmny-deal-won");

    const blocked = await n8n.triggerWebhook({
      webhookPath: "hrmny-deal-won",
      payload: { dealId: "demo" },
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.triggered).toBe(false);

    const allowed = await n8n.triggerWebhook({
      webhookPath: "hrmny-deal-won",
      payload: { dealId: "demo" },
      allowProductionTrigger: true,
    });
    expect(allowed.blocked).toBe(false);
    expect(allowed.triggered).toBe(true);
    expect(allowed.mode).toBe("mock");
  });

  it("HITL trigger with N8N_WEBHOOK_* override POSTs without API key", async () => {
    vi.stubEnv(
      "N8N_WEBHOOK_DEAL_WON",
      "https://hrmny.app.n8n.cloud/webhook/hrmny-deal-won",
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const n8n = createN8nAdapter({ mode: "mock" });
    const result = await n8n.triggerWebhook({
      webhookPath: "hrmny-deal-won",
      payload: { dealId: "demo" },
      allowProductionTrigger: true,
    });

    expect(result.blocked).toBe(false);
    expect(result.triggered).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hrmny.app.n8n.cloud/webhook/hrmny-deal-won",
      expect.objectContaining({ method: "POST" }),
    );

    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("getExecutionStatus returns mock success", async () => {
    const n8n = createN8nMock();
    const status = await n8n.getExecutionStatus("exec-1");
    expect(status.finished).toBe(true);
    expect(status.status).toBe("success");
  });
});

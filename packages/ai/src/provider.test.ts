import { describe, expect, it, vi } from "vitest";
import {
  MonthlyCapExceededError,
  createMockProvider,
  createProvider,
  estimateCostAed,
  OPENROUTER_FREE_DEFAULT_MODEL,
  OPENROUTER_FREE_FALLBACK_MODELS,
  assertOpenRouterFreeRoute,
  isOpenRouterFreeRoute,
  resolveDefaultLlmModel,
  runtimeLlmSnapshot,
  priceForModel,
  withMetering,
  type CostEvent,
  type LLMProvider,
} from "./provider";

const tokenProvider: LLMProvider = {
  name: "openrouter",
  async generate() {
    return {
      text: "ok",
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    };
  },
};

describe("cost estimation", () => {
  it("prices a known model from the map", () => {
    // 1M in @0.55 + 0.5M out @2.2 = 0.55 + 1.1 = 1.65 AED
    expect(
      estimateCostAed("openai/gpt-4o-mini", 1_000_000, 500_000),
    ).toBeCloseTo(1.65, 4);
  });

  it("matches by substring, then falls back to default", () => {
    expect(priceForModel("openai/gpt-4o-mini:free")).toEqual(
      priceForModel("openai/gpt-4o-mini"),
    );
    expect(priceForModel("some/unknown-model")).toEqual(
      priceForModel("default"),
    );
  });

  it("costs 0 when token counts are missing", () => {
    expect(estimateCostAed("openai/gpt-4o-mini")).toBe(0);
  });
});

describe("withMetering", () => {
  it("reports cost to the onCost hook", async () => {
    const events: CostEvent[] = [];
    const metered = withMetering(tokenProvider, {
      agent: "outreach-draft",
      onCost: (e) => void events.push(e),
    });
    await metered.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(events).toHaveLength(1);
    expect(events[0]!.agent).toBe("outreach-draft");
    expect(events[0]!.costAed).toBeGreaterThan(0);
  });

  it("keeps the mock working with zero cost", async () => {
    const events: CostEvent[] = [];
    const metered = withMetering(createMockProvider(), {
      onCost: (e) => void events.push(e),
    });
    const result = await metered.generate({
      task: "outreach_draft",
      messages: [{ role: "user", content: "firstName: Sara\ncompany: Acme" }],
    });
    expect(result.provider).toBe("mock");
    expect(events[0]!.costAed).toBe(0);
  });

  it("emits funnel_act tool fences for ReAct demos without OpenRouter", async () => {
    const mock = createMockProvider();
    const first = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- funnel_act: Run sandboxed funnel writes\n- now: time",
        },
        {
          role: "user",
          content:
            "Advance this client’s funnel drafts (brief, campaign, portal invite)",
        },
      ],
    });
    expect(first.text).toMatch(/```tool/);
    expect(first.text).toMatch(/"name"\s*:\s*"funnel_act"/);

    const second = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- funnel_act: Run sandboxed funnel writes",
        },
        {
          role: "user",
          content: "Advance this client’s funnel drafts",
        },
        {
          role: "user",
          content: 'Observation from funnel_act:\n{"tools":[]}',
        },
        {
          role: "user",
          content: "Tool result received. Continue.",
        },
      ],
    });
    expect(second.text).not.toMatch(/```tool/);
    expect(second.text).toMatch(/portal/i);
  });

  it("emits crm.closed_loop tool fences when catalog lists it", async () => {
    const mock = createMockProvider();
    const first = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- crm.closed_loop: Prospect → won → handover\n- now: time",
        },
        {
          role: "user",
          content: "Run demo closed loop",
        },
      ],
    });
    expect(first.text).toMatch(/```tool/);
    expect(first.text).toMatch(/"name"\s*:\s*"crm\.closed_loop"/);

    const second = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- crm.closed_loop: Prospect → won → handover",
        },
        {
          role: "user",
          content: "Run demo closed loop",
        },
        {
          role: "user",
          content: 'Observation from crm.closed_loop:\n{"ok":true}',
        },
        {
          role: "user",
          content: "Tool result received. Continue.",
        },
      ],
    });
    expect(second.text).not.toMatch(/```tool/);
    expect(second.text).toMatch(/handover|onboarding/i);
  });

  it("emits crm_closed_loop fence when chat catalog lists underscore name", async () => {
    const mock = createMockProvider();
    const first = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- crm_closed_loop: Org prospect → won → handover\n- now: time",
        },
        {
          role: "user",
          content: "Run demo closed loop",
        },
      ],
    });
    expect(first.text).toMatch(/```tool/);
    expect(first.text).toMatch(/"name"\s*:\s*"crm_closed_loop"/);
  });

  it("emits finance.os_approve / finance_os_issue fences when catalog lists them", async () => {
    const mock = createMockProvider();
    const approve = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- finance.os_approve: Approve OS invoice\n- now: time",
        },
        {
          role: "user",
          content:
            "Approve OS invoice invoiceId: a1000000-0000-4000-8000-000000000099",
        },
      ],
    });
    expect(approve.text).toMatch(/```tool/);
    expect(approve.text).toMatch(/"name"\s*:\s*"finance\.os_approve"/);

    const issue = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- finance_os_issue: Issue OS invoice\n- now: time",
        },
        {
          role: "user",
          content:
            "Issue OS invoice invoiceId: a1000000-0000-4000-8000-000000000099",
        },
      ],
    });
    expect(issue.text).toMatch(/```tool/);
    expect(issue.text).toMatch(/"name"\s*:\s*"finance_os_issue"/);
  });

  it("emits outreach.os_approve fence when catalog lists it", async () => {
    const mock = createMockProvider();
    const first = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- outreach.os_approve: Approve outreach HITL\n- now: time",
        },
        {
          role: "user",
          content:
            "Approve OS outreach outreachId: a1000000-0000-4000-8000-000000000077",
        },
      ],
    });
    expect(first.text).toMatch(/```tool/);
    expect(first.text).toMatch(/"name"\s*:\s*"outreach\.os_approve"/);
  });

  it("emits creative.os_qc fence when catalog lists it", async () => {
    const mock = createMockProvider();
    const first = await mock.generate({
      task: "generic",
      messages: [
        {
          role: "system",
          content:
            "Available tools:\n- creative.os_qc: Pass creative QC\n- now: time",
        },
        {
          role: "user",
          content:
            "Pass QC on creative taskId: a1000000-0000-4000-8000-000000000066",
        },
      ],
    });
    expect(first.text).toMatch(/```tool/);
    expect(first.text).toMatch(/"name"\s*:\s*"creative\.os_qc"/);
  });

  it("fails closed when month-to-date spend is at the cap", async () => {
    const onCost = vi.fn();
    const metered = withMetering(tokenProvider, {
      agent: "research",
      monthlyCapAed: 1500,
      getMonthlySpendAed: () => 1500,
      onCost,
    });
    await expect(
      metered.generate({ messages: [{ role: "user", content: "hi" }] }),
    ).rejects.toBeInstanceOf(MonthlyCapExceededError);
    expect(onCost).not.toHaveBeenCalled();
  });

  it("passes through under the cap", async () => {
    const metered = withMetering(tokenProvider, {
      monthlyCapAed: 1500,
      getMonthlySpendAed: () => 1499.9,
    });
    const result = await metered.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("ok");
  });

  it("skips the cap check when spend source is omitted", async () => {
    const metered = withMetering(tokenProvider, { monthlyCapAed: 1 });
    const result = await metered.generate({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result.text).toBe("ok");
  });
});

describe("openrouter free-model failover", () => {
  it("exposes an ordered free fallback chain", () => {
    expect(OPENROUTER_FREE_FALLBACK_MODELS[0]).toBe(
      OPENROUTER_FREE_DEFAULT_MODEL,
    );
    expect(OPENROUTER_FREE_FALLBACK_MODELS).toContain("stealth/ox-alpha");
    expect(OPENROUTER_FREE_FALLBACK_MODELS.length).toBeGreaterThanOrEqual(3);
  });

  it("allowlists only free OpenRouter routes", () => {
    expect(isOpenRouterFreeRoute("liquid/lfm-2.5-2.6b:free")).toBe(true);
    expect(isOpenRouterFreeRoute("stealth/ox-alpha")).toBe(true);
    expect(isOpenRouterFreeRoute("openrouter/free")).toBe(true);
    expect(isOpenRouterFreeRoute("openai/gpt-4o")).toBe(false);
    expect(() =>
      assertOpenRouterFreeRoute("anthropic/claude-3.5-sonnet"),
    ).toThrow(/free allowlist/i);
  });

  it("runtimeLlmSnapshot reflects env without secrets", () => {
    process.env.LLM_PROVIDER = "mock";
    delete process.env.LLM_DEFAULT_MODEL;
    delete process.env.OPENROUTER_API_KEY;
    expect(runtimeLlmSnapshot()).toEqual({
      provider: "mock",
      defaultModel: "mock",
      openRouterConfigured: false,
      freeOnly: false,
    });

    process.env.LLM_PROVIDER = "openrouter";
    process.env.OPENROUTER_API_KEY = "sk-test";
    delete process.env.LLM_DEFAULT_MODEL;
    expect(runtimeLlmSnapshot().provider).toBe("openrouter");
    expect(runtimeLlmSnapshot().defaultModel).toBe(
      OPENROUTER_FREE_DEFAULT_MODEL,
    );
    expect(runtimeLlmSnapshot().freeOnly).toBe(true);

    process.env.LLM_DEFAULT_MODEL = "stealth/ox-alpha";
    expect(resolveDefaultLlmModel("openrouter")).toBe("stealth/ox-alpha");
  });

  it("retries the next free model after a 429", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      if (body.model === OPENROUTER_FREE_DEFAULT_MODEL) {
        return new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          id: "gen-1",
          model: body.model,
          choices: [{ message: { role: "assistant", content: "failover ok" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    process.env.OPENROUTER_API_KEY = "sk-test";
    process.env.LLM_PROVIDER = "openrouter";

    const provider = createProvider({
      provider: "openrouter",
      defaultModel: OPENROUTER_FREE_DEFAULT_MODEL,
      openRouterApiKey: "sk-test",
    });
    const result = await provider.generate({
      messages: [{ role: "user", content: "hi" }],
      task: "generic",
    });
    expect(result.text).toBe("failover ok");
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    vi.unstubAllGlobals();
  });

  it("hard-caps OpenRouter web research and preserves source receipts", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            id: "research-1",
            model: OPENROUTER_FREE_DEFAULT_MODEL,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: "Grounded brief",
                  annotations: [
                    {
                      type: "url_citation",
                      url_citation: {
                        url: "https://company.example/news",
                        title: "Company news",
                      },
                    },
                  ],
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              server_tool_use: { web_search_requests: 2 },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const provider = createProvider({
      provider: "openrouter",
      defaultModel: OPENROUTER_FREE_DEFAULT_MODEL,
      openRouterApiKey: "sk-test",
    });

    const result = await provider.generate({
      messages: [{ role: "user", content: "Research this company" }],
      webSearch: true,
    });
    const request = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ) as Record<string, unknown>;

    expect(request).toMatchObject({
      max_tool_calls: 2,
      tools: [
        {
          type: "openrouter:web_search",
          parameters: { max_uses: 2, max_total_results: 8 },
        },
      ],
    });
    expect(result).toMatchObject({
      requestId: "research-1",
      webSearchRequests: 2,
      sourceCitations: [
        { url: "https://company.example/news", title: "Company news" },
      ],
    });
    vi.unstubAllGlobals();
  });
});

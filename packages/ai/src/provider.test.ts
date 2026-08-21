import { describe, expect, it, vi } from "vitest";
import {
  MonthlyCapExceededError,
  createMockProvider,
  estimateCostAed,
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
    expect(estimateCostAed("openai/gpt-4o-mini", 1_000_000, 500_000)).toBeCloseTo(1.65, 4);
  });

  it("matches by substring, then falls back to default", () => {
    expect(priceForModel("openai/gpt-4o-mini:free")).toEqual(
      priceForModel("openai/gpt-4o-mini"),
    );
    expect(priceForModel("some/unknown-model")).toEqual(priceForModel("default"));
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
          content: "Available tools:\n- funnel_act: Run sandboxed funnel writes",
        },
        {
          role: "user",
          content: "Advance this client’s funnel drafts",
        },
        {
          role: "user",
          content: "Observation from funnel_act:\n{\"tools\":[]}",
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

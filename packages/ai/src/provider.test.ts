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

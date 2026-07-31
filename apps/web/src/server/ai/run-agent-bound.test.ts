import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runAgent: vi.fn(),
  emitHealthSignal: vi.fn(),
}));

vi.mock("@hrmny/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hrmny/ai")>()),
  runAgent: mocks.runAgent,
}));
vi.mock("../m1-persistence", () => ({
  emitHealthSignal: mocks.emitHealthSignal,
}));
vi.mock("../db", () => ({ getDb: () => null }));

import { MonthlyCapExceededError } from "@hrmny/ai";
import { boundRunAgent } from "./run-agent-bound";

describe("boundRunAgent health source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emitHealthSignal.mockResolvedValue({});
  });

  it("persists spend_cap when the monthly breaker rejects the run", async () => {
    const alert = {
      type: "llm_monthly_cap_exceeded" as const,
      capAed: 1_500,
      spentAed: 1_501,
      attemptedModel: "gpt-test",
      agent: "research",
      at: "2026-07-31T00:00:00.000Z",
    };
    mocks.runAgent.mockRejectedValueOnce(new MonthlyCapExceededError(alert));

    await expect(
      boundRunAgent({ agent: "research", input: "enrich Acme" }),
    ).rejects.toBeInstanceOf(MonthlyCapExceededError);
    expect(mocks.emitHealthSignal).toHaveBeenCalledWith(
      "spend_cap",
      "critical",
      alert,
    );
  });
});

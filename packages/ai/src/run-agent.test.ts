import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAgentOverrides, setAgentEnabled } from "./agents/registry";
import type { AutonomyPolicy } from "./policy";
import type { CostEvent, LLMProvider } from "./provider";
import { runAgent } from "./run-agent";

afterEach(() => resetAgentOverrides());

describe("runAgent", () => {
  it("returns an AgentRunOutput and meters cost for a draft agent", async () => {
    const events: CostEvent[] = [];
    const out = await runAgent(
      {
        agent: "outreach-draft",
        input: "firstName: Sara\ncompany: Acme",
      },
      { onCost: (e) => void events.push(e) },
    );
    expect(out.agent).toBe("outreach-draft");
    expect(out.gateOutcome).toBe("pending"); // stops at HITL
    expect(out.output).toMatchObject({ channel: "email" });
    expect(events).toHaveLength(1); // metered even at zero cost
  });

  it("marks read-only agents not_applicable", async () => {
    const out = await runAgent({ agent: "research", input: "enrich Acme" });
    expect(out.gateOutcome).toBe("not_applicable");
  });

  it("returns a blocked refusal for a disabled agent without calling the model", async () => {
    setAgentEnabled("outreach-draft", false);
    const provider: LLMProvider = {
      name: "mock",
      generate: vi.fn(),
    };
    const out = await runAgent(
      { agent: "outreach-draft", input: "x" },
      { provider },
    );
    expect(out.gateOutcome).toBe("blocked");
    expect(out.costAed).toBe(0);
    expect(out.output).toMatchObject({ refused: true, reason: "agent_disabled" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("blocks a scheduled run with no policy (fail closed to manual)", async () => {
    const provider: LLMProvider = { name: "mock", generate: vi.fn() };
    const out = await runAgent(
      { agent: "research", input: "enrich Acme" },
      { provider, invocationContext: { trigger: "scheduled" } },
    );
    expect(out.gateOutcome).toBe("blocked");
    expect(out.costAed).toBe(0);
    expect(out.output).toMatchObject({
      refused: true,
      reason: "policy_violation",
      violation: "mode_not_scheduled",
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("runs a scheduled research agent when the policy allow-lists it", async () => {
    const policy: AutonomyPolicy = {
      mode: "scheduled_research",
      allowedScheduledAgents: ["research"],
      updatedBy: "emp-1",
      updatedAt: new Date().toISOString(),
    };
    const out = await runAgent(
      { agent: "research", input: "enrich Acme" },
      { invocationContext: { trigger: "scheduled" }, policy },
    );
    expect(out.gateOutcome).toBe("not_applicable");
    expect(out.agent).toBe("research");
  });

  it("blocks a scheduled agent absent from the allow-list", async () => {
    const provider: LLMProvider = { name: "mock", generate: vi.fn() };
    const policy: AutonomyPolicy = {
      mode: "scheduled_research",
      allowedScheduledAgents: ["research"],
      updatedBy: "emp-1",
      updatedAt: new Date().toISOString(),
    };
    const out = await runAgent(
      { agent: "outreach-draft", input: "x" },
      { provider, invocationContext: { trigger: "scheduled" }, policy },
    );
    expect(out.gateOutcome).toBe("blocked");
    expect(out.output).toMatchObject({
      refused: true,
      violation: "agent_not_allowlisted",
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });
});

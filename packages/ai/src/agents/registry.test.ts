import { afterEach, describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY,
  CreativeSubagentIdSchema,
  agentDisabledRefusal,
  agentEnabledStates,
  isAgentEnabled,
  listAgents,
  listCreativeSubagents,
  listParentAgents,
  ORCHESTRATION_HITL_NOTE,
  resetAgentOverrides,
  setAgentEnabled,
} from "./registry";

describe("agent registry", () => {
  it("lists parent + creative subagents; all require HITL before send", () => {
    const agents = listAgents();
    expect(agents.length).toBeGreaterThanOrEqual(13);
    for (const a of agents) {
      expect(a.requiresHitlBeforeSend).toBe(true);
    }
    expect(listParentAgents()).toHaveLength(10);
    expect(listCreativeSubagents()).toHaveLength(3);
    for (const id of CreativeSubagentIdSchema.options) {
      expect(AGENT_REGISTRY[id].parentId).toBe("creative");
    }
    expect(AGENT_REGISTRY["outreach-draft"].producesDrafts).toBe(true);
    expect(AGENT_REGISTRY.hr.allowedTools).toContain("bayzat.csv.import");
    expect(AGENT_REGISTRY["automation-orchestrator"].allowedTools).toContain(
      "n8n.trigger",
    );
    expect(AGENT_REGISTRY["ticket-assist"].producesDrafts).toBe(true);
    expect(ORCHESTRATION_HITL_NOTE).toMatch(/HITL/);
  });
});

describe("agent kill switch", () => {
  afterEach(() => {
    delete process.env.AGENT_DISABLED_LIST;
    resetAgentOverrides();
  });

  it("enables every agent by default", () => {
    expect(agentEnabledStates().every((a) => a.enabled)).toBe(true);
    expect(isAgentEnabled("research")).toBe(true);
  });

  it("disables agents listed in AGENT_DISABLED_LIST", () => {
    process.env.AGENT_DISABLED_LIST = "research, creative";
    expect(isAgentEnabled("research")).toBe(false);
    expect(isAgentEnabled("creative")).toBe(false);
    expect(isAgentEnabled("hr")).toBe(true);
  });

  it("runtime override wins over the env list", () => {
    process.env.AGENT_DISABLED_LIST = "research";
    setAgentEnabled("research", true);
    expect(isAgentEnabled("research")).toBe(true);
    setAgentEnabled("hr", false);
    expect(isAgentEnabled("hr")).toBe(false);
  });

  it("returns a typed refusal that never throws", () => {
    const refusal = agentDisabledRefusal("outreach-draft");
    expect(refusal).toMatchObject({
      ok: false,
      refused: true,
      agentId: "outreach-draft",
      reason: "agent_disabled",
    });
  });
});

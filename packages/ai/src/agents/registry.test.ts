import { describe, expect, it } from "vitest";
import {
  AGENT_REGISTRY,
  CreativeSubagentIdSchema,
  listAgents,
  listCreativeSubagents,
  listParentAgents,
  ORCHESTRATION_HITL_NOTE,
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

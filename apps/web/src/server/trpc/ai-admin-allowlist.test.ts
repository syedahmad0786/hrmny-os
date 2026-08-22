process.env.DATABASE_URL = "";
process.env.LLM_PROVIDER = "mock";

import { describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "./root";
import {
  DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS,
  DEFAULT_FUNNEL_AGENT_TOOLS,
} from "../ai/agent-tools";

function aiAdminCaller() {
  const user = resolveDevUser("partner");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("customAgents allowlist repair", () => {
  it("seeds Delivery coach in memory mode so Delivery run is available", async () => {
    const caller = aiAdminCaller();
    const listed = await caller.aiAdmin.customAgents.list();
    const coach = listed.find((a) => a.slug === "delivery-coach");
    expect(coach).toBeDefined();
    expect(coach?.enabled).toBe(true);
    expect(coach?.displayName).toMatch(/Delivery coach/i);
  });

  it("create persists funnel defaults and repair fills empty allowlists", async () => {
    const caller = aiAdminCaller();
    const slug = `funnel-repair-${Date.now().toString(36)}`;
    const created = await caller.aiAdmin.customAgents.create({
      slug,
      displayName: "Funnel repair agent",
    });
    expect(created.allowedTools).toEqual([...DEFAULT_FUNNEL_AGENT_TOOLS]);

    await caller.aiAdmin.customAgents.update({
      id: created.customAgentId,
      allowedTools: [],
    });

    // list auto-persists funnel defaults onto empty allowlists
    const listed = await caller.aiAdmin.customAgents.list();
    const afterList = listed.find(
      (a) => a.customAgentId === created.customAgentId,
    );
    expect(afterList?.toolsEmpty).toBe(false);
    expect(afterList?.effectiveAllowedTools).toEqual(
      DEFAULT_FUNNEL_AGENT_TOOLS.map((t) => t.toLowerCase()),
    );

    await caller.aiAdmin.customAgents.update({
      id: created.customAgentId,
      allowedTools: [],
    });

    const repaired = await caller.aiAdmin.customAgents.repairEmptyAllowlists();
    expect(repaired.ok).toBe(true);
    expect(repaired.repaired).toBeGreaterThanOrEqual(1);

    const after = (await caller.aiAdmin.customAgents.list()).find(
      (a) => a.customAgentId === created.customAgentId,
    );
    expect(after?.toolsEmpty).toBe(false);
    expect(after?.effectiveAllowedTools).toEqual(
      DEFAULT_FUNNEL_AGENT_TOOLS.map((t) => t.toLowerCase()),
    );
  });

  it("toolPreset demo_os_settle persists OS settle tools; funnel create excludes them", async () => {
    const caller = aiAdminCaller();
    const settleSlug = `os-settle-${Date.now().toString(36)}`;
    const settle = await caller.aiAdmin.customAgents.create({
      slug: settleSlug,
      displayName: "OS settle agent",
      toolPreset: "demo_os_settle",
    });
    expect(settle.allowedTools).toEqual([...DEFAULT_DEMO_OS_SETTLE_AGENT_TOOLS]);
    expect(settle.allowedTools).toContain("crm.closed_loop");
    expect(settle.allowedTools).toContain("portal.os_approve");
    expect(settle.allowedTools).not.toContain("crm.prospect");

    const funnelSlug = `funnel-only-${Date.now().toString(36)}`;
    const funnel = await caller.aiAdmin.customAgents.create({
      slug: funnelSlug,
      displayName: "Funnel only agent",
      toolPreset: "funnel",
    });
    expect(funnel.allowedTools).toEqual([...DEFAULT_FUNNEL_AGENT_TOOLS]);
    expect(funnel.allowedTools).not.toContain("crm.closed_loop");
    expect(funnel.allowedTools).not.toContain("finance.os_approve");

    const run = await caller.aiAdmin.customAgents.run({
      id: settle.customAgentId,
      prompt:
        "Run closed loop then settle OS: finance approve and issue invoice, approve outreach, creative QC pass then advance, approve portal, approve campaign and publish campaign.",
    });
    expect(run.slug).toBe(settleSlug);
    expect(Array.isArray(run.toolResults)).toBe(true);
    const byTool = (name: string) =>
      run.toolResults!.find((r) => r.tool === name);
    expect(byTool("crm.closed_loop")?.ok).toBe(true);
    expect(byTool("finance.os_approve")?.ok).toBe(true);
    expect(byTool("finance.os_issue")?.ok).toBe(true);
    expect(byTool("outreach.os_approve")?.ok).toBe(true);
    expect(byTool("creative.os_qc")?.ok).toBe(true);
    expect(byTool("portal.os_approve")?.ok).toBe(true);
    expect(byTool("campaigns.os_approve")?.ok).toBe(true);
    expect(byTool("campaigns.os_publish")?.ok).toBe(true);
  });
});

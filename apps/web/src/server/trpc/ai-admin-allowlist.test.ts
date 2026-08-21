process.env.DATABASE_URL = "";
process.env.LLM_PROVIDER = "mock";

import { describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "./root";
import { DEFAULT_FUNNEL_AGENT_TOOLS } from "../ai/agent-tools";

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
});

process.env.DATABASE_URL = "";
process.env.LLM_PROVIDER = "mock";

import { describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "./root";
import { DEFAULT_FUNNEL_AGENT_TOOLS } from "../ai/agent-tools";

function partnerCaller() {
  const user = resolveDevUser("partner");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("chat agent binding (QM-style)", () => {
  it("lists memory-mode agents so the dropdown is not empty", async () => {
    const caller = partnerCaller();
    const agents = await caller.chat.listRunnableAgents();
    expect(agents.length).toBeGreaterThan(0);
    const coach = agents.find((a) => a.slug === "delivery-coach");
    expect(coach).toBeDefined();
    expect(coach?.toolCount).toBeGreaterThan(0);
  });

  it("selecting an agent runs allowlisted tools on send (direct harness)", async () => {
    const caller = partnerCaller();
    const slug = `chat-bind-${Date.now().toString(36)}`;
    const created = await caller.aiAdmin.customAgents.create({
      slug,
      displayName: "Chat Bind Coach",
      systemPrompt: "You are a chat-bound delivery coach.",
      allowedTools: [...DEFAULT_FUNNEL_AGENT_TOOLS],
    });
    expect(created.slug).toBe(slug);

    const thread = await caller.chat.createThread({
      title: "Agent bind test",
      agentSlug: slug,
      clientId: "c1000000-0000-4000-8000-0000000000a4",
    });
    expect(thread.agentSlug).toBe(slug);

    const sent = await caller.chat.send({
      threadId: thread.chatThreadId,
      content:
        "Advance this client’s funnel drafts (brief, campaign, portal invite)",
      harness: "direct",
      effort: "low",
    });
    expect(sent.assistant.content.length).toBeGreaterThan(10);
    const steps = (sent.assistant.metadata as { steps?: unknown[] })?.steps;
    expect(Array.isArray(steps)).toBe(true);
    expect(
      (steps as Array<{ toolName?: string }>).some(
        (s) => s.toolName === "agent_act",
      ),
    ).toBe(true);
  });
});

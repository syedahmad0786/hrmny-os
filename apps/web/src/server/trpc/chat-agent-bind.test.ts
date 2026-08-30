process.env.DATABASE_URL = "";
process.env.LLM_PROVIDER = "mock";

import { describe, expect, it, vi } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { createCaller } from "./root";
import { getDemoStore } from "../demo-store";

function partnerCaller() {
  const user = resolveDevUser("partner");
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("chat agent binding", () => {
  it("lists memory-mode agents so the dropdown is not empty", async () => {
    const caller = partnerCaller();
    const agents = await caller.chat.listRunnableAgents();
    expect(agents.length).toBeGreaterThan(0);
    const coach = agents.find((a) => a.slug === "delivery-coach");
    expect(coach).toBeDefined();
    expect(coach?.toolCount).toBeGreaterThan(0);
    const settle = agents.find((a) => a.slug === "os-settle");
    expect(settle).toBeDefined();
    expect(settle?.toolCount).toBeGreaterThan(5);
  });

  it("keeps the real client Chat custom-agent path effect-free", async () => {
    const caller = partnerCaller();
    const slug = `chat-bind-${Date.now().toString(36)}`;
    const created = await caller.aiAdmin.customAgents.create({
      slug,
      displayName: "Chat Bind Coach",
      systemPrompt: "You are a chat-bound delivery coach.",
      allowedTools: ["*"],
    });
    expect(created.slug).toBe(slug);

    const thread = await caller.chat.createThread({
      title: "Agent bind test",
      agentSlug: slug,
      clientId: "c1000000-0000-4000-8000-0000000000a4",
    });
    expect(thread.agentSlug).toBe(slug);

    const store = getDemoStore();
    store.resetM4Demo();
    const snapshot = () => ({
      tasks: [...store.tasks.entries()],
      briefs: [...store.briefs.entries()],
      approvals: [...store.portalApprovals.entries()],
      assets: [...store.assets.entries()],
      audits: [...store.audits],
      seams: [...store.seamOutbox],
      magicTokens: [...store.portalMagicTokens.entries()],
    });
    const before = snapshot();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const sent = await caller.chat.send({
        threadId: thread.chatThreadId,
        content: "Mark the client-review deliverable approved",
        harness: "direct",
        effort: "low",
      });
      expect(sent.assistant.content.length).toBeGreaterThan(10);
      const steps = (sent.assistant.metadata as { steps?: unknown[] })?.steps;
      expect(Array.isArray(steps)).toBe(true);
      expect(
        (steps as Array<{ toolName?: string }>).some(
          (step) => step.toolName === "agent_act",
        ),
      ).toBe(false);
      expect(snapshot()).toEqual(before);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

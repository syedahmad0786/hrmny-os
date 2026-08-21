process.env.LLM_PROVIDER = "mock";
process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { resetCrmMemory } from "./crm/memory";
import { DEMO_CLIENT_ID, getDemoStore } from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

function callerFor(role: "partner" | "director" = "partner") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("demo OS closed loop", () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = "mock";
    process.env.DATABASE_URL = "";
    resetCrmMemory();
    getDemoStore().resetM4Demo();
  });

  it("creates and runs a custom agent on command with mock LLM", async () => {
    const caller = callerFor("partner");
    const agent = await caller.aiAdmin.customAgents.create({
      slug: `brand-voice-${Date.now()}`,
      displayName: "Brand Voice",
      systemPrompt: "Speak in short editorial lines about Creative Harmony.",
    });
    expect(agent.customAgentId).toBeTruthy();
    const run = await caller.aiAdmin.customAgents.run({
      id: agent.customAgentId,
      prompt: "Give one next creative action.",
      clientId: DEMO_CLIENT_ID,
    });
    expect(run.slug).toBe(agent.slug);
    expect(run.output).toBeTruthy();
    expect(run.sandbox.clientId).toBe(DEMO_CLIENT_ID);
  });

  it("sends creative generation to portal as client_review asset", async () => {
    const caller = callerFor("partner");
    const gen = await caller.creativeGen.generate({
      prompt: "Sand and ochre product still life for portal demo",
      clientId: DEMO_CLIENT_ID,
    });
    expect(gen.status).toBe("ready");
    expect(gen.imageUrl || gen.imageB64).toBeTruthy();

    const sent = await caller.creativeGen.sendToPortal({
      creativeGenerationId: gen.creativeGenerationId,
      clientId: DEMO_CLIENT_ID,
    });
    expect(sent.ok).toBe(true);
    const asset = getDemoStore().assets.get(sent.assetId);
    expect(asset?.status).toBe("client_review");
    expect(asset?.clientId).toBe(DEMO_CLIENT_ID);
  });

  it("runDemoClosedLoop advances CRM path (handover needs DATABASE_URL)", async () => {
    const caller = callerFor("partner");
    const result = await caller.crm.runDemoClosedLoop({
      companyName: `Unit Demo ${Date.now()}`,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("handover");
      expect(result.reason).toMatch(/DATABASE_URL/i);
    }
  });
});

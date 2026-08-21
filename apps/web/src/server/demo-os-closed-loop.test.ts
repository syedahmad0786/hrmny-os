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

  it("apollo import writes durable CRM deals visible to crm.deals", async () => {
    const caller = callerFor("partner");
    const imported = await caller.crm.prospect.apolloImport({
      query: "Unit Retail Prospect",
    });
    expect(imported.deals.length).toBeGreaterThan(0);
    expect(imported.mode).toBe("mock");
    expect(imported.verifyMode).toBe("mock");
    expect(imported.deals[0]!.emailVerified).toBe(true);
    const deal = await caller.crm.deals.get({ id: imported.deals[0]!.dealId });
    expect(deal?.dealId).toBe(imported.deals[0]!.dealId);
    expect(deal?.leadSourceLane).toBe("apollo_intent");
    expect(deal?.emailVerified).toBe(true);
  });

  it("runDemoClosedLoop viaApollo seeds apollo_intent then fails handover without DB", async () => {
    const caller = callerFor("partner");
    const result = await caller.crm.runDemoClosedLoop({
      companyName: `Apollo Unit ${Date.now()}`,
      viaApollo: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.step).toBe("handover");
    }
  });
});

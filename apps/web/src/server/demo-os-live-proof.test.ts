/**
 * Live Postgres proof for demo closed loop (requires DATABASE_URL).
 * Usage: cd apps/web && pnpm exec vitest run src/server/demo-os-live-proof.test.ts
 */
import { describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

describe.runIf(hasDb)("demo OS live Postgres proof", () => {
  it(
    "closed loop + creative portal + custom agent + apollo mock search",
    async () => {
      process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });

      const loop = await caller.crm.runDemoClosedLoop({
        companyName: `Live Proof ${Date.now()}`,
      });
      expect(loop.ok).toBe(true);
      if (!loop.ok) return;

      expect(loop.clientId).toBeTruthy();
      expect(loop.onboardingPhases).toBeGreaterThanOrEqual(1);

      const gen = await caller.creativeGen.generate({
        prompt: "Ochre editorial still life for demo portal delivery",
        clientId: loop.clientId,
      });
      expect(gen.status).toBe("ready");

      const sent = await caller.creativeGen.sendToPortal({
        creativeGenerationId: gen.creativeGenerationId,
        clientId: loop.clientId,
      });
      expect(sent.ok).toBe(true);
      expect(sent.assetId).toBeTruthy();

      const agent = await caller.aiAdmin.customAgents.create({
        slug: `proof-agent-${Date.now()}`,
        displayName: "Proof Agent",
        systemPrompt: "You are a concise onboarding coach for Creative Harmony.",
      });
      const run = await caller.aiAdmin.customAgents.run({
        id: agent.customAgentId,
        prompt: "List 2 next onboarding actions for this client.",
        clientId: loop.clientId,
      });
      expect(run.slug).toBe(agent.slug);
      expect(run.output).toBeTruthy();

      const imported = await caller.leads.apollo.import({
        query: "Demo Retail UAE",
      });
      expect(imported).toBeTruthy();
      expect(Array.isArray(imported) ? imported.length : 1).toBeGreaterThan(0);
    },
    60_000,
  );
});

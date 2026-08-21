/**
 * Live Postgres proof for demo closed loop (requires DATABASE_URL).
 * Usage: cd apps/web && pnpm exec vitest run src/server/demo-os-live-proof.test.ts
 */
import { describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { getDeal } from "./crm/repository";

const hasDb = Boolean(process.env.DATABASE_URL?.trim());

describe.runIf(hasDb)("demo OS live Postgres proof", () => {
  it(
    "closed loop + apollo durable CRM + creative portal + custom agent + portal onboarding",
    async () => {
      process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || "mock";
      const user = resolveDevUser("partner");
      const caller = createCaller({
        user,
        employeeId: user.employeeId,
        roles: user.roles,
        canViewMargin: sessionCanViewMargin(user),
      });

      const imported = await caller.crm.prospect.apolloImport({
        query: `Demo Retail UAE ${Date.now()}`,
      });
      expect(imported.deals.length).toBeGreaterThan(0);
      expect(imported.mode === "mock" || imported.mode === "live").toBe(true);
      const apolloDeal = imported.deals[0]!;
      const durable = await getDeal(apolloDeal.dealId);
      expect(durable?.dealId).toBe(apolloDeal.dealId);
      expect(durable?.leadSourceLane).toBe("apollo_intent");
      expect(durable?.stage).toBe("discover");

      const loop = await caller.crm.runDemoClosedLoop({
        companyName: `Live Proof ${Date.now()}`,
        viaApollo: true,
      });
      expect(loop.ok).toBe(true);
      if (!loop.ok) return;

      expect(loop.clientId).toBeTruthy();
      expect(loop.viaApollo).toBe(true);
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
        taskId: loop.taskId ?? undefined,
      });
      expect(run.slug).toBe(agent.slug);
      expect(run.output).toBeTruthy();

      const portalUser = {
        ...resolveDevUser("portal_a"),
        clientId: loop.clientId,
      };
      const portalCaller = createCaller({
        user: portalUser,
        employeeId: portalUser.employeeId,
        roles: portalUser.roles,
        canViewMargin: false,
        clientId: loop.clientId,
      });
      const onboarding = await portalCaller.portal.onboarding.get();
      expect(onboarding.phases.length).toBeGreaterThanOrEqual(1);
      const deliveries = await portalCaller.portal.deliveries.list();
      expect(deliveries[0]?.deliverables.some((d) => d.kind === "asset")).toBe(
        true,
      );
    },
    90_000,
  );
});

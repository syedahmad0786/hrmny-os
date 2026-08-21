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
      expect(
        imported.verifyMode === "mock" || imported.verifyMode === "live",
      ).toBe(true);
      const apolloDeal = imported.deals[0]!;
      const durable = await getDeal(apolloDeal.dealId);
      expect(durable?.dealId).toBe(apolloDeal.dealId);
      expect(durable?.leadSourceLane).toBe("apollo_intent");
      expect(durable?.stage).toBe("discover");
      expect(durable?.emailVerified).toBe(apolloDeal.emailVerified);

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

      const deliveryTask = await caller.tasks.create({
        clientId: loop.clientId,
        taskType: "social_cutdowns",
        title: `Durable board ${Date.now()}`,
      });
      expect(deliveryTask.taskId).toBeTruthy();
      const listed = await caller.tasks.list({ clientId: loop.clientId });
      expect(listed.some((t) => t.taskId === deliveryTask.taskId)).toBe(true);

      const brief = await caller.briefs.createForTask({
        taskId: deliveryTask.taskId,
        body: {
          title: "Demo brief",
          objective: "Launch",
          audience: "UAE retail",
          deliverables: "3 reels",
          deadline: "2026-12-31",
          brandAssets: { logo: true },
        },
      });
      expect(brief.taskId).toBe(deliveryTask.taskId);
      const briefGet = await caller.briefs.get({ id: brief.briefId });
      expect(briefGet?.briefId).toBe(brief.briefId);

      const locked = await caller.briefs.lock({ id: brief.briefId });
      expect(locked.ok).toBe(true);
      if (locked.ok) {
        expect(locked.taskStatus).toBe("brief_ready");
        expect(locked.brief.lockedAt).toBeTruthy();
        expect(locked.spawnedTaskId).toBeTruthy();
        expect(locked.seam?.event?.result?.durable).toBe(true);
      }
      const lockedAgain = await caller.briefs.lock({ id: brief.briefId });
      expect(lockedAgain.ok).toBe(true);
      if (locked.ok && lockedAgain.ok) {
        expect(lockedAgain.spawnedTaskId).toBe(locked.spawnedTaskId);
      }

      const agent = await caller.aiAdmin.customAgents.create({
        slug: `proof-agent-${Date.now()}`,
        displayName: "Proof Agent",
        systemPrompt: "You are a concise onboarding coach for Creative Harmony.",
      });
      const run = await caller.aiAdmin.customAgents.run({
        id: agent.customAgentId,
        prompt: "List 2 next onboarding actions for this client.",
        clientId: loop.clientId,
        taskId: deliveryTask.taskId,
      });
      expect(run.slug).toBe(agent.slug);
      expect(run.output).toBeTruthy();
      expect(run.sandbox?.clientId).toBe(loop.clientId);
      expect(run.sandbox?.taskId).toBe(deliveryTask.taskId);

      const userScoped = await caller.aiAdmin.customAgents.run({
        id: agent.customAgentId,
        prompt: `User-only note ${Date.now()} for partner sandbox isolation.`,
      });
      expect(userScoped.sandbox?.employeeId).toBe(user.employeeId);
      expect(userScoped.sandbox?.clientId).toBeUndefined();

      const smoke = await caller.automation.smoke();
      expect(smoke.health).toBeTruthy();
      expect(
        smoke.health.apiKeyConfigured === true ||
          smoke.health.apiKeyConfigured === false,
      ).toBe(true);

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

      const creativeTask = await caller.tasks.create({
        clientId: loop.clientId,
        taskType: "social_cutdowns",
        title: `Portal approve ${Date.now()}`,
        status: "client_review",
      });
      const approvals = await portalCaller.portal.approvals.list();
      expect(
        approvals.some((a) => a.approvalId === creativeTask.taskId),
      ).toBe(true);
      const approved = await portalCaller.portal.approvals.act({
        id: creativeTask.taskId,
        action: "approve",
      });
      expect(approved.ok).toBe(true);
      expect(approved.status).toBe("approved");

      const inbound = await caller.leads.inbound.create({
        companyName: `Inbound Proof ${Date.now()}`,
        contactEmail: `inbound-${Date.now()}@example.com`,
        sector: "Retail",
        message: "Website form — need creative retainer",
      });
      expect(inbound.leadSourceLane).toBe("inbound");
      expect(
        "durable" in inbound ? inbound.durable : true,
      ).toBeTruthy();
      const inboundDeal = await getDeal(inbound.dealId);
      expect(inboundDeal?.dealId).toBe(inbound.dealId);
      expect(inboundDeal?.leadSourceLane).toBe("inbound");

      const month = new Date().toISOString().slice(0, 7);
      const calendar = await caller.calendars.create({
        clientId: loop.clientId,
        month,
        focusPoints: ["Launch reel", "Product stills"],
      });
      expect(calendar.calendarId).toBeTruthy();
      const slot = await caller.calendars.addSlot({
        calendarId: calendar.calendarId,
        slotDate: `${month}-15`,
        slotLabel: "Studio shoot",
        taskId: deliveryTask.taskId,
        position: 1,
      });
      expect(slot.calendarId).toBe(calendar.calendarId);
      const approvedCal = await caller.calendars.refApprove({
        id: calendar.calendarId,
      });
      expect(approvedCal.refApprovalState).toBe("approved");
      const listedCals = await caller.calendars.listByClient({
        clientId: loop.clientId,
        month,
      });
      expect(
        listedCals.some((c) => c.calendarId === calendar.calendarId),
      ).toBe(true);
    },
    90_000,
  );
});

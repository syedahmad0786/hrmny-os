import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { DEMO_DEAL_ID, getDemoStore } from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

function callerFor(role: "partner" | "am" | "finance" | "director") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

async function advanceTo(
  api: ReturnType<typeof callerFor>,
  stages: string[],
  opts?: { overrideReason?: string },
) {
  for (const to of stages) {
    const deal = await api.deals.get({ id: DEMO_DEAL_ID });
    const result = await api.deals.transition({
      id: DEMO_DEAL_ID,
      to,
      from: String(deal?.stage),
      overrideReason: opts?.overrideReason,
    });
    expect(result.ok, `advance to ${to}`).toBe(true);
  }
}

describe("M3 sales platform demo", () => {
  beforeEach(() => {
    getDemoStore().resetM3Demo();
  });

  it("BUAF fail Fit blocks qualify → engage", async () => {
    const am = callerFor("am");
    await am.deals.transition({
      id: DEMO_DEAL_ID,
      to: "qualify",
      from: "discover",
    });
    await am.deals.buaf({
      id: DEMO_DEAL_ID,
      budget: true,
      urgency: true,
      access: true,
      fit: false,
      noGoFlags: [],
    });
    const blocked = await am.deals.transition({
      id: DEMO_DEAL_ID,
      to: "engage",
      from: "qualify",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockedBy?.[0]?.gate).toBe("deal.buaf");
    }
  });

  it("Hot BUAF + Apollo→Hunter verify unlocks engage → scope", async () => {
    const am = callerFor("am");
    await am.deals.transition({
      id: DEMO_DEAL_ID,
      to: "qualify",
      from: "discover",
    });
    const buaf = await am.deals.buaf({
      id: DEMO_DEAL_ID,
      budget: true,
      urgency: true,
      access: true,
      fit: true,
      noGoFlags: [],
    });
    expect(buaf.hot).toBe(true);

    await am.deals.transition({
      id: DEMO_DEAL_ID,
      to: "engage",
      from: "qualify",
    });

    const verify = await am.deals.verifyEmail({
      id: DEMO_DEAL_ID,
      email: "alex@democo.example",
    });
    expect(verify.emailVerified).toBe(true);

    await am.deals.voiceCheck({
      id: DEMO_DEAL_ID,
      copy: "Region-aware intro for your Dubai retail launch this quarter.",
      register: "cold-intro",
    });

    const toScope = await am.deals.transition({
      id: DEMO_DEAL_ID,
      to: "scope",
      from: "engage",
    });
    expect(toScope.ok).toBe(true);
  });

  it("margin below floor OVERRIDE_REQUIRED until partner override", async () => {
    const partner = callerFor("partner");
    await partner.deals.buaf({
      id: DEMO_DEAL_ID,
      budget: true,
      urgency: true,
      access: true,
      fit: true,
      noGoFlags: [],
    });
    await partner.deals.verifyEmail({
      id: DEMO_DEAL_ID,
      email: "alex@democo.example",
    });
    await partner.deals.voiceCheck({
      id: DEMO_DEAL_ID,
      copy: "Warm note on your Q2 brand push in the UAE market.",
    });
    await advanceTo(partner, [
      "qualify",
      "engage",
      "scope",
      "propose",
      "price_cost",
    ]);

    await partner.deals.quote({
      id: DEMO_DEAL_ID,
      lines: [
        {
          label: "Thin margin package",
          unitSell: 10000,
          unitCost: 9000,
          qty: 1,
          isVendor: false,
        },
      ],
    });

    const blocked = await partner.deals.transition({
      id: DEMO_DEAL_ID,
      to: "close",
      from: "price_cost",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("OVERRIDE_REQUIRED");
      expect(blocked.blockedBy?.[0]?.gate).toBe("deal.margin_floor");
    }

    const ok = await partner.deals.transition({
      id: DEMO_DEAL_ID,
      to: "close",
      from: "price_cost",
      overrideReason: "Strategic logo — partner approved",
    });
    expect(ok.ok).toBe(true);
  });

  it("Won → Handover Pack creates client + onboarding board", async () => {
    const partner = callerFor("partner");
    await partner.deals.buaf({
      id: DEMO_DEAL_ID,
      budget: true,
      urgency: true,
      access: true,
      fit: true,
      noGoFlags: [],
    });
    await partner.deals.verifyEmail({
      id: DEMO_DEAL_ID,
      email: "alex@democo.example",
    });
    await partner.deals.voiceCheck({
      id: DEMO_DEAL_ID,
      copy: "Discovery note aligned to your wellness brand goals this season.",
    });
    await advanceTo(partner, [
      "qualify",
      "engage",
      "scope",
      "propose",
      "price_cost",
    ]);
    await partner.deals.quote({
      id: DEMO_DEAL_ID,
      lines: [
        {
          label: "Retainer",
          unitSell: 50000,
          unitCost: 30000,
          qty: 1,
          isVendor: false,
        },
        {
          label: "Vendor shoot",
          unitSell: 0,
          unitCost: 5000,
          qty: 1,
          isVendor: true,
        },
      ],
      commercialMode: "retainer",
    });

    const closed = await partner.deals.close({
      id: DEMO_DEAL_ID,
      outcome: "won",
    });
    expect(closed.ok).toBe(true);

    const pack = await partner.deals.handoverPack({ id: DEMO_DEAL_ID });
    expect(pack.ok).toBe(true);
    if (!pack.ok) return;
    expect(pack.client.name).toBe("Demo Co LLC");
    expect(pack.onboarding).toHaveLength(7);
    expect(pack.fired).toContain("client.create");
    expect(pack.fired).toContain("onboarding.seed");

    const deal = await partner.deals.get({ id: DEMO_DEAL_ID });
    expect(deal?.stage).toBe("handover_pack");

    const immersion = await partner.clients.immersion.upsert({
      clientId: pack.client.clientId,
      usp: "Creative growth for MENA retail",
      audience: "CMOs",
      complete: true,
    });
    expect(immersion.completedAt).toBeTruthy();
  });

  it("outreach draft stays pending until HITL approve (stub send)", async () => {
    const am = callerFor("am");
    await am.deals.buaf({
      id: DEMO_DEAL_ID,
      budget: true,
      urgency: true,
      access: true,
      fit: true,
      noGoFlags: [],
    });
    const draft = await am.outreach.queue.draft({
      dealId: DEMO_DEAL_ID,
      channel: "gmail",
      toEmail: "alex@democo.example",
      subject: "Intro",
      body: "Draft only — not sent yet.",
    });
    expect(draft.status).toBe("pending");

    const pending = await am.outreach.queue.list({ status: "pending" });
    expect(pending.some((p) => p.approvalId === draft.approvalId)).toBe(true);

    const partner = callerFor("partner");
    const sent = await partner.outreach.queue.approve({
      id: draft.approvalId,
      idempotencyKey: "m3-demo-send-1",
    });
    expect(sent.externalId).toMatch(/^stub-gmail-/);
    expect(sent.auditId).toBeTruthy();

    const again = await partner.outreach.queue.approve({
      id: draft.approvalId,
      idempotencyKey: "m3-demo-send-1",
    });
    expect(again.auditId).toBe("idempotent");
  });
});

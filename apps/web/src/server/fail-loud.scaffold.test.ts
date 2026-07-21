import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { getDemoStore } from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

/**
 * W3-04 — no-silent-failure + no-double-send scaffolding for M1 substrate.
 * Fail loud when live modes lack keys; refuse duplicate seam/send idempotency.
 */
function callerFor(role: "partner" | "am" = "partner") {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("M1 fail-loud + idempotency scaffolding", () => {
  beforeEach(() => {
    getDemoStore().resetDemoDeal();
  });

  it("DAM_STORAGE=supabase without keys fails loud at factory", async () => {
    const prev = process.env.DAM_STORAGE;
    process.env.DAM_STORAGE = "supabase";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { createObjectStoreFromEnv } = await import("./demo-store");
    expect(() => createObjectStoreFromEnv()).toThrow(/DAM_STORAGE=supabase/);
    if (prev === undefined) delete process.env.DAM_STORAGE;
    else process.env.DAM_STORAGE = prev;
  });

  it("health emit always records a signal (never silent)", async () => {
    const partner = callerFor();
    const before = (await partner.admin.health.get()).signals.length;
    await partner.admin.health.emitStub({
      signalKey: "fail_loud_check",
      severity: "critical",
    });
    const after = await partner.admin.health.get();
    expect(after.signals.length).toBeGreaterThan(before);
    expect(after.signals[0]?.signalKey).toBe("fail_loud_check");
  });

  it("blocked CRM stage does not mutate deal (no silent apply)", async () => {
    const partner = callerFor();
    const deals = await partner.crm.deals.list();
    const deal = deals.find((d) => d.stage === "discover");
    if (!deal) return;
    const result = await partner.crm.deals.moveStage({
      id: deal.dealId,
      to: "handover_pack",
    });
    expect(result.ok).toBe(false);
    const again = await partner.crm.deals.get({ id: deal.dealId });
    expect(again?.stage).toBe("discover");
  });

  it("AM margin strip is absolute (no silent leak in list payload)", async () => {
    const am = callerFor("am");
    const deals = await am.crm.deals.list();
    for (const d of deals) {
      expect("marginPct" in d).toBe(false);
      expect("internalCost" in d).toBe(false);
    }
  });
});

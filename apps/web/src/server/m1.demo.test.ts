import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { getDemoStore } from "./demo-store";
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

describe("M1 tRPC RBAC + gate", () => {
  beforeEach(() => {
    getDemoStore().resetDemoDeal();
  });

  it("strips margin from deals.get for AM", async () => {
    const am = callerFor("am");
    const deal = await am.deals.get({
      id: "e0000000-0000-4000-8000-000000000001",
    });
    expect(deal).toBeTruthy();
    expect(deal && "marginPct" in deal).toBe(false);
    expect(deal && "internalCost" in deal).toBe(false);
    expect(deal?.companyName).toBe("Demo Co LLC");
  });

  it("allows margin for partner and denies AM on deals.margin", async () => {
    const partner = callerFor("partner");
    const margin = await partner.deals.margin();
    expect(margin.marginPct).toBe("40.00");

    const am = callerFor("am");
    await expect(am.deals.margin()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("blocks illegal transition with audit, then audits legal one", async () => {
    const partner = callerFor("partner");
    const blocked = await partner.deals.transition({
      id: "e0000000-0000-4000-8000-000000000001",
      to: "close",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.auditId).toBeTruthy();
    }
    const auditsAfterBlock = await partner.admin.audit.list({ limit: 10 });
    expect(
      auditsAfterBlock.some((a) => a.action === "deal.transition.blocked"),
    ).toBe(true);

    const ok = await partner.deals.transition({
      id: "e0000000-0000-4000-8000-000000000001",
      to: "qualify",
      from: "discover",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.auditId).toBeTruthy();
    }
    const audits = await partner.admin.audit.list({ limit: 10 });
    expect(audits.some((a) => a.action === "deal.transition")).toBe(true);
  });

  it("uploads asset version and returns signed URL", async () => {
    const creative = callerFor("partner");
    const asset = await creative.assets.create({ title: "test" });
    const version = await creative.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "a.txt",
      contentType: "text/plain",
      contentBase64: Buffer.from("hello").toString("base64"),
    });
    expect(version.versionNumber).toBe(1);
    const signed = await creative.assets.signedUrl({
      assetId: asset.assetId,
      versionId: version.assetVersionId,
    });
    expect(signed?.url).toContain("memory://dam/");
  });

  it("trips health signal stub and starts Gmail OAuth without crash", async () => {
    const partner = callerFor("partner");
    const health = await partner.admin.health.emitStub({
      signalKey: "m1_demo_trip",
      severity: "warn",
    });
    expect(health.signalKey).toBe("m1_demo_trip");
    expect(health.chat).toBe("stubbed");

    const oauth = await partner.connections.startOAuth({ toolkit: "gmail" });
    expect(oauth.redirectUrl).toBeTruthy();
  });

  it("CRM moveStage is gated — illegal jump blocked with audit", async () => {
    const partner = callerFor("partner");
    const deals = await partner.crm.deals.list();
    const deal = deals.find((d) => d.stage === "discover") ?? deals[0];
    expect(deal).toBeTruthy();
    const blocked = await partner.crm.deals.moveStage({
      id: deal!.dealId,
      to: "close",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("GATE_BLOCKED");
      expect(blocked.auditId).toBeTruthy();
    }
    const still = await partner.crm.deals.get({ id: deal!.dealId });
    expect(still?.stage).toBe(deal!.stage);
  });

  it("Director can upsert conventions", async () => {
    const director = callerFor("director");
    const updated = await director.conventions.upsert({
      ruleKey: "margin.floor",
      payload: { floorPct: 25, targetPct: 42 },
    });
    expect(updated.version).toBeGreaterThanOrEqual(2);
    expect(updated.payload.targetPct).toBe(42);
  });
});

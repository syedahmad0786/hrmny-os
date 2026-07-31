import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { getDemoStore } from "./demo-store";
import {
  DEV_USERS,
  resolveDevUser,
  sessionCanViewMargin,
} from "./auth/session";

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
    const store = getDemoStore();
    store.resetDemoDeal();
    store.audits = [];
    store.healthSignals = [];
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
    const projects = await creative.work.projects.list();
    const project = await creative.work.projects.get({
      projectId: projects[0]!.projectId,
    });
    const workItemId = project.items[0]!.itemId;
    const asset = await creative.assets.create({ title: "test", workItemId });
    const version = await creative.assets.uploadVersion({
      assetId: asset.assetId,
      fileName: "a.png",
      contentType: "image/png",
      contentBase64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    });
    expect(version.versionNumber).toBe(1);
    const signed = await creative.assets.signedUrl({
      assetId: asset.assetId,
      versionId: version.assetVersionId,
    });
    expect(signed?.url).toContain("memory://dam/");
  });

  it("rejects mismatched asset bytes and QC fail without notes", async () => {
    const partner = callerFor("partner");
    const projects = await partner.work.projects.list();
    const project = await partner.work.projects.get({
      projectId: projects[0]!.projectId,
    });
    const asset = await partner.assets.create({
      title: "invalid upload",
      workItemId: project.items[0]!.itemId,
    });
    await expect(
      partner.assets.uploadVersion({
        assetId: asset.assetId,
        fileName: "fake.png",
        contentType: "image/png",
        contentBase64: Buffer.from("not a png").toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      partner.assets.qc({ id: asset.assetId, decision: "fail" }),
    ).rejects.toBeTruthy();
  });

  it("records a test health signal and starts Gmail OAuth without crash", async () => {
    const partner = callerFor("partner");
    const health = await partner.admin.health.sendTest({
      signalKey: "m1_test",
      severity: "warn",
    });
    expect(health.signalKey).toBe("m1_test");
    expect(["not_configured", "pending"]).toContain(health.chat);
    expect(
      (
        await partner.admin.audit.list({
          limit: 10,
          action: "admin.health.sendTest",
        })
      )[0],
    ).toMatchObject({
      entityType: "health_signal",
      entityId: health.healthSignalId,
      reason: "Manual operational signal test",
    });

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
    expect(
      (await partner.admin.health.get()).signals.some(
        (signal) => signal.signalKey === "gate_blocked",
      ),
    ).toBe(true);
  });

  it("emits auth_denied from a real protected API rejection", async () => {
    const anonymous = createCaller({
      user: null,
      employeeId: null,
      roles: [],
      canViewMargin: false,
    });
    await expect(anonymous.admin.health.get()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const partner = callerFor("partner");
    expect(
      (await partner.admin.health.get()).signals.some(
        (signal) =>
          signal.signalKey === "auth_denied" &&
          signal.payload?.reason === "unauthenticated",
      ),
    ).toBe(true);
  });

  it("Director can upsert conventions", async () => {
    const director = callerFor("director");
    const updated = await director.conventions.upsert({
      ruleKey: "margin.floor",
      payload: { floorPct: 25, targetPct: 42 },
    });
    expect(updated.version).toBeGreaterThanOrEqual(2);
    expect(updated.payload).toMatchObject({ floorPct: 25, targetPct: 42 });
  });

  it("rejects invalid convention payload without replacing the active version", async () => {
    const director = callerFor("director");
    const [before] = await director.conventions.list({
      ruleKey: "margin.floor",
    });
    await expect(
      director.conventions.upsert({
        ruleKey: "margin.floor",
        payload: { floorPct: 60, targetPct: 40 },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const [after] = await director.conventions.list({
      ruleKey: "margin.floor",
    });
    expect(after).toEqual(before);
  });

  it("rejects unknown convention rule keys", async () => {
    const director = callerFor("director");
    await expect(
      director.conventions.upsert({
        // @ts-expect-error Deliberately exercise the runtime API boundary.
        ruleKey: "unknown.rule",
        payload: { enabled: true },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(
      (await director.conventions.list()).some(
        (row) => row.ruleKey === "unknown.rule",
      ),
    ).toBe(false);
  });

  it("audits role changes, denies AM escalation and protects the final Partner", async () => {
    const partner = callerFor("partner");
    const director = callerFor("director");
    const am = callerFor("am");
    const originalRoles = [...DEV_USERS.am!.roles];
    const roles = await partner.admin.roles.list();
    const directorRole = roles.find((item) => item.key === "director")!;
    const partnerRole = roles.find((item) => item.key === "partner")!;
    try {
      await expect(
        am.admin.roles.assignEmployee({
          employeeId: DEV_USERS.am!.employeeId,
          roleId: directorRole.roleId!,
          reason: "Attempted self escalation",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const before = (await partner.admin.audit.list({ limit: 100 })).filter(
        (row) => row.action === "admin.roles.assignEmployee",
      ).length;
      await partner.admin.roles.assignEmployee({
        employeeId: DEV_USERS.am!.employeeId,
        roleId: directorRole.roleId!,
        reason: "M1 role assignment proof",
      });
      await partner.admin.roles.assignEmployee({
        employeeId: DEV_USERS.am!.employeeId,
        roleId: directorRole.roleId!,
        reason: "Repeated click proof",
      });
      const after = (await partner.admin.audit.list({ limit: 100 })).filter(
        (row) => row.action === "admin.roles.assignEmployee",
      ).length;
      expect(after - before).toBe(1);

      await director.admin.roles.revokeEmployee({
        employeeId: DEV_USERS.am!.employeeId,
        roleId: directorRole.roleId!,
        reason: "Director revoke acceptance proof",
      });
      await director.admin.roles.assignEmployee({
        employeeId: DEV_USERS.am!.employeeId,
        roleId: directorRole.roleId!,
        reason: "Director assign acceptance proof",
      });
      expect(
        (await director.admin.audit.list({ limit: 100 })).filter(
          (row) =>
            row.actorEmployeeId === DEV_USERS.director!.employeeId &&
            row.entityId === DEV_USERS.am!.employeeId,
        ),
      ).toHaveLength(2);

      await expect(
        partner.admin.roles.revokeEmployee({
          employeeId: DEV_USERS.partner!.employeeId,
          roleId: partnerRole.roleId!,
          reason: "M1 final partner protection proof",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      DEV_USERS.am!.roles = originalRoles;
    }
  });
});

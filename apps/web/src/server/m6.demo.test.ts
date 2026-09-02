import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import {
  DEMO_BRIEF_ID,
  DEMO_CLIENT_B_ID,
  DEMO_CLIENT_ID,
  DEMO_CREATIVE_APPROVE_TASK_ID,
  DEMO_CREATIVE_TASK_ID,
  DEMO_PORTAL_APPROVE_ID,
  DEMO_STAFF_LEAD_ID,
  getDemoStore,
} from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { driveSeam } from "./seams";
import { assertPortalSafe } from "./portal-data";
import { listNotifications } from "./notifications/store";

function callerFor(role: string) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
    clientId: user.clientId,
  });
}

describe("M6 portal + seams", () => {
  beforeEach(() => {
    getDemoStore().resetM6Demo();
  });

  it("portal_a sees only own client briefs/tasks/assets/status", async () => {
    const portal = callerFor("portal_a");
    const session = await portal.portal.auth.session();
    expect(session.clientId).toBe(DEMO_CLIENT_ID);
    expect(session.canViewMargin).toBe(false);

    const tasks = await portal.portal.tasks.list();
    expect(tasks.every((t) => !t.title.includes("Other Co"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("Launch reel"))).toBe(true);

    const assets = await portal.portal.assets.list();
    expect(assets.every((a) => !a.title.includes("Other Co"))).toBe(true);

    const deliveries = await portal.portal.deliveries.list();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.clientId).toBe(DEMO_CLIENT_ID);
    expect(() => assertPortalSafe(deliveries)).not.toThrow();
  });

  it("portal cannot call staff finance/margin/payroll", async () => {
    const portal = callerFor("portal_a");
    await expect(portal.clients.list()).rejects.toThrow(/FORBIDDEN/);
    await expect(portal.dashboards.margin.list()).rejects.toThrow(/FORBIDDEN/);
    await expect(portal.invoices.list()).rejects.toThrow(/FORBIDDEN/);
    await expect(portal.payroll.runs.list()).rejects.toThrow(/FORBIDDEN/);
    await expect(portal.portal.financeProbe()).rejects.toThrow(/finance/i);
  });

  it("portal_b cannot see Demo Co data", async () => {
    const portalB = callerFor("portal_b");
    const store = getDemoStore();
    const tasks = await portalB.portal.tasks.list();
    expect(tasks.every((t) => t.title.includes("Other Co"))).toBe(true);
    const assets = await portalB.portal.assets.list();
    expect(assets.every((a) => a.title.includes("Other Co"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("Launch reel"))).toBe(false);
    const before = {
      approval: store.portalApprovals.get(DEMO_PORTAL_APPROVE_ID)?.status,
      audits: store.audits.length,
      seams: store.seamOutbox.length,
    };
    await expect(
      portalB.portal.approvals.act({
        id: DEMO_PORTAL_APPROVE_ID,
        action: "approve",
      }),
    ).rejects.toThrow(/NOT_FOUND/);
    expect({
      approval: store.portalApprovals.get(DEMO_PORTAL_APPROVE_ID)?.status,
      audits: store.audits.length,
      seams: store.seamOutbox.length,
    }).toEqual(before);
  });

  it("portal approval permission is checked again at action time", async () => {
    const user = {
      ...resolveDevUser("portal_a"),
      permissions: ["allow:portal:read"],
    };
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: false,
      clientId: user.clientId,
    });
    const before = getDemoStore().portalApprovals.get(
      DEMO_PORTAL_APPROVE_ID,
    )?.status;
    await expect(
      caller.portal.approvals.act({
        id: DEMO_PORTAL_APPROVE_ID,
        action: "approve",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    expect(
      getDemoStore().portalApprovals.get(DEMO_PORTAL_APPROVE_ID)?.status,
    ).toBe(before);
  });

  it("partner preview is read-only and cannot record a client decision", async () => {
    const partner = callerFor("partner");
    const preview = await partner.clientPreview.workspace();
    const approval = preview.approvals.find(
      (item) =>
        item.status === "pending" &&
        /Approve launch reel cut/i.test(item.title),
    );
    expect(preview.clientName).toContain("Demo Co");
    expect(approval).toBeDefined();
    const store = getDemoStore();
    const assetId = store.portalApprovals.get(approval!.approvalId)!.entityId;
    const asset = store.assets.get(assetId)!;
    const before = {
      approval: store.portalApprovals.get(approval!.approvalId)?.status,
      asset: asset.status,
      task: asset.taskId ? store.tasks.get(asset.taskId)?.status : null,
      audits: store.audits.filter(
        (event) => event.action === "portal.approvals.act",
      ).length,
      seams: store.seamOutbox.length,
      notifications: (await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 200 }))
        .length,
    };
    await expect(
      partner.clientPreview.act({
        id: approval!.approvalId,
        action: "approve",
      }),
    ).rejects.toThrow("CLIENT_PORTAL_ACTOR_REQUIRED");
    expect({
      approval: store.portalApprovals.get(approval!.approvalId)?.status,
      asset: store.assets.get(assetId)?.status,
      task: asset.taskId ? store.tasks.get(asset.taskId)?.status : null,
      audits: store.audits.filter(
        (event) => event.action === "portal.approvals.act",
      ).length,
      seams: store.seamOutbox.length,
      notifications: (await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 200 }))
        .length,
    }).toEqual(before);
    const directorPreview = await callerFor("director").clientPreview.workspace();
    expect(directorPreview.clientId).toBe(preview.clientId);
    await expect(callerFor("am").clientPreview.workspace()).rejects.toThrow(
      /Partner or director/,
    );
  });

  it("portal reject moves task to revisions, bumps count, and notifies staff", async () => {
    const portal = callerFor("portal_a");
    const store = getDemoStore();
    const pending = [...store.portalApprovals.values()].find(
      (a) =>
        a.clientId === DEMO_CLIENT_ID &&
        a.status === "pending" &&
        /Approve launch reel cut/i.test(a.title),
    );
    expect(pending).toBeDefined();
    const asset = store.assets.get(pending!.entityId);
    expect(asset?.taskId).toBe(DEMO_CREATIVE_TASK_ID);
    const beforeCount =
      store.tasks.get(DEMO_CREATIVE_TASK_ID)?.clientRevisionCount ?? 0;

    const result = await portal.portal.approvals.act({
      id: pending!.approvalId,
      action: "reject",
      feedback: "Tighten the hook and crop",
    });
    expect(result.status).toBe("revisions");
    expect(store.portalApprovals.get(pending!.approvalId)?.status).toBe(
      "rejected",
    );
    const task = store.tasks.get(DEMO_CREATIVE_TASK_ID)!;
    expect(task.status).toBe("revisions");
    expect(task.clientRevisionCount).toBe(beforeCount + 1);

    const decisionAudit = store.audits.find(
      (event) =>
        event.action === "portal.approvals.act" &&
        event.entityId === pending!.entityId,
    );
    expect(decisionAudit?.actorEmployeeId).toBeNull();
    expect(decisionAudit?.actorPortalUserId).toBe(
      resolveDevUser("portal_a").employeeId,
    );

    const { listNotifications } = await import("./notifications/store");
    const inbox = await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "creative" &&
          /revisions/i.test(n.title) &&
          /Approve launch reel cut/i.test(n.title) &&
          /Tighten the hook/i.test(n.body ?? "") &&
          (n.href ?? "").includes(`taskId=${DEMO_CREATIVE_TASK_ID}`),
      ),
    ).toBe(true);
  });

  it("portal approve moves task to approved and notifies staff with Creative deep-link", async () => {
    const portal = callerFor("portal_a");
    const store = getDemoStore();
    const pending = store.portalApprovals.get(DEMO_PORTAL_APPROVE_ID);
    expect(pending?.status).toBe("pending");
    expect(pending?.title).toMatch(/Approve product stills pack/i);
    const asset = store.assets.get(pending!.entityId);
    expect(asset?.taskId).toBe(DEMO_CREATIVE_APPROVE_TASK_ID);

    const result = await portal.portal.approvals.act({
      id: pending!.approvalId,
      action: "approve",
      feedback: "Looks good — ship it",
    });
    expect(result.status).toBe("approved");
    expect(store.portalApprovals.get(pending!.approvalId)?.status).toBe(
      "approved",
    );
    const task = store.tasks.get(DEMO_CREATIVE_APPROVE_TASK_ID)!;
    expect(task.status).toBe("approved");

    const decisionAudit = store.audits.find(
      (event) =>
        event.action === "portal.approvals.act" &&
        event.entityId === pending!.entityId,
    );
    expect(decisionAudit?.actorEmployeeId).toBeNull();
    expect(decisionAudit?.actorPortalUserId).toBe(
      resolveDevUser("portal_a").employeeId,
    );

    const { listNotifications } = await import("./notifications/store");
    const inbox = await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "creative" &&
          /Client approved/i.test(n.title) &&
          /Approve product stills pack/i.test(n.title) &&
          /Looks good/i.test(n.body ?? "") &&
          (n.href ?? "").includes(`taskId=${DEMO_CREATIVE_APPROVE_TASK_ID}`),
      ),
    ).toBe(true);

    const beforeReplay = {
      audits: store.audits.filter(
        (event) => event.action === "portal.approvals.act",
      ).length,
      seams: store.seamOutbox.length,
      notifications: inbox.length,
    };
    const replay = await portal.portal.approvals.act({
      id: pending!.approvalId,
      action: "approve",
      feedback: "Looks good — ship it",
    });
    expect(replay.changed).toBe(false);
    expect({
      audits: store.audits.filter(
        (event) => event.action === "portal.approvals.act",
      ).length,
      seams: store.seamOutbox.length,
      notifications: (await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 20 }))
        .length,
    }).toEqual(beforeReplay);
  });

  it("portal onboarding acknowledge notifies staff inbox", async () => {
    const portal = callerFor("portal_a");
    const board = await portal.portal.onboarding.get();
    const active = board.phases.find((p) => p.status === "active");
    expect(active).toBeDefined();
    const result = await portal.portal.onboarding.acknowledge({
      phaseIndex: active!.phaseIndex,
    });
    expect(result.advanced).toBe(true);
    const { listNotifications } = await import("./notifications/store");
    const inbox = await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "onboarding" &&
          /signed off/i.test(n.title) &&
          /Kickoff/i.test(n.title) &&
          (n.href ?? "").includes(`/clients/${DEMO_CLIENT_ID}?phase=`),
      ),
    ).toBe(true);
  });

  it("rejects nested finance fields from portal payloads", () => {
    expect(() =>
      assertPortalSafe({ delivery: { internal_cost: 100 } }),
    ).toThrow(/PORTAL_FINANCE_LEAK/);
  });

  it("brief.lock seam spawns creative task; re-drive is idempotent", async () => {
    const traffic = callerFor("traffic");
    const store = getDemoStore();
    const brief = store.briefs.get(DEMO_BRIEF_ID)!;
    brief.body = {
      objective: "Grow retail awareness",
      audience: "UAE retail shoppers",
      deliverables: "1 reel",
      deadline: new Date().toISOString(),
      brandAssets: "logo pack",
      channels: "IG",
      successMetric: "CTR",
      // leave one optional missing so DoR can lock (≤2 missing)
    };
    const locked = await traffic.briefs.lock({ id: DEMO_BRIEF_ID });
    expect(locked.ok).toBe(true);
    if (!locked.ok) return;
    expect(locked.seam.duplicate).toBe(false);
    expect(locked.seam.event.name).toBe("brief.lock");

    const spawned = [...store.tasks.values()].filter(
      (t) => t.taskType === "creative_spawn" && t.clientId === DEMO_CLIENT_ID,
    );
    expect(spawned.length).toBe(1);
    expect(store.clientDeliveryStatus.get(DEMO_CLIENT_ID)?.status).toBe(
      "brief_locked",
    );

    const again = driveSeam("brief.lock", `brief.lock:${DEMO_BRIEF_ID}`, {
      briefId: DEMO_BRIEF_ID,
      taskId: brief.taskId,
      clientId: DEMO_CLIENT_ID,
    });
    expect(again.duplicate).toBe(true);
    expect(
      [...store.tasks.values()].filter((t) => t.taskType === "creative_spawn"),
    ).toHaveLength(1);
  });

  it("keeps QC review and client approval as distinct receipts", async () => {
    const cd = callerFor("creative_director");
    const store = getDemoStore();
    const task = store.tasks.get(DEMO_CREATIVE_TASK_ID)!;
    task.status = "qc";
    task.qcPassed = false;

    const qc = await cd.tasks.qc({
      id: DEMO_CREATIVE_TASK_ID,
      decision: "pass",
    });
    expect(qc.ok).toBe(true);
    if (!qc.ok) return;
    expect(qc.seam?.event.name).toBe("creative.qc_passed");
    expect(store.clientDeliveryStatus.get(DEMO_CLIENT_ID)?.status).toBe(
      "awaiting_client",
    );
    // Task stays in qc until gate transition; seam only updates delivery status.
    expect(store.tasks.get(DEMO_CREATIVE_TASK_ID)?.status).toBe("qc");

    const moved = await cd.tasks.transition({
      id: DEMO_CREATIVE_TASK_ID,
      to: "client_review",
      from: "qc",
      payload: { qcPassed: true },
    });
    expect(moved.ok).toBe(true);

    const portal = callerFor("portal_a");
    let deliveries = await portal.portal.deliveries.list();
    expect(deliveries[0]!.deliveryStatus).toBe("awaiting_client");
    expect(deliveries[0]!.lastSeam).toBe("creative.qc_passed");

    const approval = [...store.portalApprovals.values()].find((candidate) => {
      const asset = store.assets.get(candidate.entityId);
      return asset?.taskId === DEMO_CREATIVE_TASK_ID;
    });
    expect(approval).toBeDefined();
    const decided = await portal.portal.approvals.act({
      id: approval!.approvalId,
      action: "approve",
    });
    expect(decided).toMatchObject({ ok: true, changed: true });
    deliveries = await portal.portal.deliveries.list();
    expect(deliveries[0]!.deliveryStatus).toBe("in_delivery");
    expect(deliveries[0]!.lastSeam).toBe("creative.approved");
    expect(
      store.seamOutbox.map((event) => event.idempotencyKey),
    ).toEqual(
      expect.arrayContaining([
        `creative.qc_passed:${DEMO_CREATIVE_TASK_ID}`,
        `creative.approved:${DEMO_CREATIVE_TASK_ID}`,
      ]),
    );
  });

  it("dashboards hub lists five system views for staff", async () => {
    const partner = callerFor("partner");
    const hub = await partner.dashboards.hub();
    expect(hub.systems).toHaveLength(5);
    expect(hub.systems.map((s) => s.key).sort()).toEqual(
      ["commercial", "delivery", "money", "people", "traffic"].sort(),
    );
    expect(hub.portalClients.some((c) => c.clientId === DEMO_CLIENT_B_ID)).toBe(
      true,
    );
  });
});

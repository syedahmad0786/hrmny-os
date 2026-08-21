import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import {
  DEMO_BRIEF_ID,
  DEMO_CLIENT_B_ID,
  DEMO_CLIENT_ID,
  DEMO_CREATIVE_TASK_ID,
  DEMO_EMPLOYEE_ID,
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
    expect(JSON.stringify(deliveries)).not.toMatch(/margin|payroll|fee|gross/i);
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
    const tasks = await portalB.portal.tasks.list();
    expect(tasks.every((t) => t.title.includes("Other Co"))).toBe(true);
    const assets = await portalB.portal.assets.list();
    expect(assets.every((a) => a.title.includes("Other Co"))).toBe(true);
    expect(tasks.some((t) => t.title.includes("Launch reel"))).toBe(false);
  });

  it("partner preview persists an approval and audits the actor", async () => {
    const partner = callerFor("partner");
    const preview = await partner.clientPreview.workspace();
    const approval = preview.approvals.find(
      (item) => item.status === "pending",
    );
    expect(preview.clientName).toContain("Demo Co");
    expect(approval).toBeDefined();

    await partner.clientPreview.act({
      id: approval!.approvalId,
      action: "approve",
    });

    expect(
      getDemoStore().portalApprovals.get(approval!.approvalId)?.status,
    ).toBe("approved");
    expect(
      getDemoStore().audits.some(
        (a) =>
          a.action === "portal.approvals.act" &&
          a.actorEmployeeId === resolveDevUser("partner").employeeId,
      ),
    ).toBe(true);
    const inbox = await listNotifications(DEMO_EMPLOYEE_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "creative" &&
          /approved/i.test(n.title) &&
          n.entityId === approval!.approvalId,
      ),
    ).toBe(true);
    await expect(callerFor("am").clientPreview.workspace()).rejects.toThrow(
      /Partner or director/,
    );
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
    const { DEMO_EMPLOYEE_ID } = await import("./demo-store");
    const inbox = await listNotifications(DEMO_EMPLOYEE_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "onboarding" &&
          /signed off/i.test(n.title) &&
          (n.href ?? "").includes("/clients/"),
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

  it("creative.approved seam sets delivery status", async () => {
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
    expect(qc.seam?.event.name).toBe("creative.approved");
    expect(store.clientDeliveryStatus.get(DEMO_CLIENT_ID)?.status).toBe(
      "in_delivery",
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
    const deliveries = await portal.portal.deliveries.list();
    expect(deliveries[0]!.deliveryStatus).toBe("in_delivery");
    expect(deliveries[0]!.lastSeam).toBe("creative.approved");
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

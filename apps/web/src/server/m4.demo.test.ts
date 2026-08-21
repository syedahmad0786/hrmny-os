process.env.COMPOSIO_API_KEY = "";

import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import {
  DEMO_BRIEF_ID,
  DEMO_CALENDAR_ID,
  DEMO_CREATIVE_TASK_ID,
  getDemoStore,
} from "./demo-store";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";

function callerFor(
  role: "partner" | "am" | "traffic" | "creative_director" | "director",
) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

describe("M4 delivery demo", () => {
  beforeEach(() => {
    getDemoStore().resetM4Demo();
  });

  it("DoR blocks lock when >2 required missing", async () => {
    const traffic = callerFor("traffic");
    const dor = await traffic.briefs.validateDor({ id: DEMO_BRIEF_ID });
    expect(dor.missingRequiredCount).toBeGreaterThan(2);
    expect(dor.canLock).toBe(false);

    const locked = await traffic.briefs.lock({ id: DEMO_BRIEF_ID });
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.status).toBe(423);
      expect(locked.reason).toMatch(/DoR lock blocked/);
    }
  });

  it("DoR allows lock when ≤2 missing → brief_ready", async () => {
    const traffic = callerFor("traffic");
    await traffic.briefs.updateBody({
      id: DEMO_BRIEF_ID,
      body: {
        objective: "Grow",
        audience: "UAE retail",
        deliverables: "3 reels",
        deadline: "2026-09-30",
        brandAssets: { logo: true },
      },
    });
    const dor = await traffic.briefs.validateDor({ id: DEMO_BRIEF_ID });
    expect(dor.missingRequiredCount).toBe(2);
    expect(dor.canLock).toBe(true);

    const locked = await traffic.briefs.lock({ id: DEMO_BRIEF_ID });
    expect(locked.ok).toBe(true);
    if (locked.ok) {
      expect(locked.taskStatus).toBe("brief_ready");
    }
  });

  it("QC gate blocks client_review until CD approve", async () => {
    const am = callerFor("am");
    const blocked = await am.tasks.transition({
      id: DEMO_CREATIVE_TASK_ID,
      to: "client_review",
      from: "qc",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockedBy?.some((b) => b.gate === "task.creative_qc")).toBe(
        true,
      );
    }

    const cd = callerFor("creative_director");
    const qc = await cd.tasks.qc({
      id: DEMO_CREATIVE_TASK_ID,
      decision: "pass",
    });
    expect(qc.ok).toBe(true);

    const ok = await cd.tasks.transition({
      id: DEMO_CREATIVE_TASK_ID,
      to: "client_review",
      from: "qc",
      payload: { qcPassed: true },
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.newState).toBe("client_review");
  });

  it("T-48h shoot lock blocks late date change; reschedule edge works", async () => {
    const am = callerFor("am");
    const lock = await am.calendars.evaluateLock({ id: DEMO_CALENDAR_ID });
    expect(lock?.locked).toBe(true);

    const next = new Date(Date.now() + 96 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const blocked = await am.calendars.shoot({
      id: DEMO_CALENDAR_ID,
      shootDate: next,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.blockedBy?.[0]?.gate).toBe("calendar.t48_shoot_lock");
    }

    const rescheduled = await am.calendars.shoot({
      id: DEMO_CALENDAR_ID,
      shootDate: next,
      rescheduleEdge: true,
    });
    expect(rescheduled.ok).toBe(true);
  });

  it("T-24h escalate when ref not approved", async () => {
    const store = getDemoStore();
    const cal = store.calendars.get(DEMO_CALENDAR_ID)!;
    cal.shootDate = new Date(Date.now() + 12 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    cal.refApprovalState = "pending";

    const am = callerFor("am");
    const result = await am.calendars.shoot({
      id: DEMO_CALENDAR_ID,
      shootDate: cal.shootDate,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.shootLock.escalateT24).toBe(true);
      expect(result.escalations.length).toBeGreaterThan(0);
    }
  });

  it("task board + Canva connect stub (memory mode)", async () => {
    const traffic = callerFor("traffic");
    const board = await traffic.dashboards.delivery();
    expect(board.board.some((c) => c.tasks.length > 0)).toBe(true);

    const partner = callerFor("partner");
    await partner.connections.startOAuth({ toolkit: "canva" });
    const conn = await partner.connections.completeOAuth({ toolkit: "canva" });
    expect(conn.status).toBe("connected");
    const designs = await partner.connections.canvaListDesigns();
    expect(designs.ok).toBe(true);
    if (designs.ok) {
      expect(designs.mode).toBe("stub");
      expect(designs.designs.length).toBeGreaterThan(0);
      expect(designs.designs[0]?.id).toMatch(/^stub-design-/);
    }

    const clientId =
      (await partner.clients.list())[0]?.clientId ??
      "aa000000-0000-4000-8000-0000000000aa";
    const attached = await partner.connections.canvaAttachToPortal({
      designId: designs.ok ? designs.designs[0]!.id : "stub-design-1",
      clientId,
      title: "Canva stub → portal",
    });
    expect(attached.ok).toBe(true);
    expect(attached.mode).toBe("stub");
    expect(attached.portalHref).toMatch(/\/portal\/login\/verify\?token=/);
    expect(attached.assetId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});

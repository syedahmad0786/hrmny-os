import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_CLIENT_ID,
  DEMO_PORTAL_APPROVE_ID,
  DEMO_STAFF_LEAD_ID,
  getDemoStore,
} from "../demo-store";
import { resolveDevUser } from "../auth/session";
import { listNotifications } from "../notifications/store";
import { actOnPortalApproval } from "../portal-data";
import {
  CLIENT_PORTAL_ACTOR_REQUIRED,
  PORTAL_IDENTITY_NOT_BOUND,
  portalApprovalPrincipalMatches,
  portalApprovalSyntheticRuntimeEnabled,
  requirePortalApprovalActor,
} from "./approval-boundary";
import {
  ensureSyntheticPortalApprovalRequest,
  runOsPortalApprove,
} from "./os-portal-approve";
import * as seams from "../seams";

async function businessSnapshot() {
  const store = getDemoStore();
  const approval = store.portalApprovals.get(DEMO_PORTAL_APPROVE_ID);
  const asset = approval ? store.assets.get(approval.entityId) : undefined;
  const task = asset?.taskId ? store.tasks.get(asset.taskId) : undefined;
  const notifications = await listNotifications(DEMO_STAFF_LEAD_ID, {
    limit: 200,
  });
  return {
    approvalStatus: approval?.status,
    taskStatus: task?.status,
    revisionCount: task?.clientRevisionCount,
    assetStatus: asset?.status,
    approvalCount: store.portalApprovals.size,
    assetCount: store.assets.size,
    portalDecisionAuditIds: store.audits
      .filter((audit) => audit.action === "portal.approvals.act")
      .map((audit) => audit.auditEventId),
    seamIds: store.seamOutbox.map((row) => row.eventId),
    notificationIds: notifications.map((row) => row.osNotificationId),
  };
}

describe("portal approval boundary", () => {
  beforeEach(() => {
    getDemoStore().resetM6Demo();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("enables synthetic fixtures only for exact dev + memory + sandbox", () => {
    expect(portalApprovalSyntheticRuntimeEnabled()).toBe(true);
    for (const [key, value] of [
      ["AUTH_MODE", "supabase"],
      ["ALLOW_DEV_AUTH", "false"],
      ["DATABASE_MODE", "auto"],
      ["WORK_ENVIRONMENT_KIND", "production"],
    ] as const) {
      vi.stubEnv(key, value);
      expect(portalApprovalSyntheticRuntimeEnabled()).toBe(false);
      vi.stubEnv(key, {
        AUTH_MODE: "dev",
        ALLOW_DEV_AUTH: "true",
        DATABASE_MODE: "memory",
        WORK_ENVIRONMENT_KIND: "sandbox",
      }[key]);
    }
  });

  it("requires a portal actor with same-client approval permission", () => {
    const portal = resolveDevUser("portal_a");
    expect(
      requirePortalApprovalActor({ actor: portal, clientId: DEMO_CLIENT_ID }),
    ).toBe(portal);
    for (const actor of [
      resolveDevUser("partner"),
      resolveDevUser("portal_b"),
      { ...portal, permissions: ["allow:portal:read"] },
      null,
    ]) {
      expect(() =>
        requirePortalApprovalActor({ actor, clientId: DEMO_CLIENT_ID }),
      ).toThrow(CLIENT_PORTAL_ACTOR_REQUIRED);
    }
  });

  it("matches only an active canonical same-client portal identity", () => {
    const expected = { portalUserId: "portal-a", clientId: "client-a" };
    expect(
      portalApprovalPrincipalMatches(expected, {
        ...expected,
        isActive: true,
      }),
    ).toBe(true);
    expect(
      portalApprovalPrincipalMatches(expected, {
        ...expected,
        isActive: false,
      }),
    ).toBe(false);
    expect(
      portalApprovalPrincipalMatches(expected, {
        portalUserId: "portal-b",
        clientId: "client-a",
        isActive: true,
      }),
    ).toBe(false);
    expect(
      portalApprovalPrincipalMatches(expected, {
        portalUserId: "portal-a",
        clientId: "client-b",
        isActive: true,
      }),
    ).toBe(false);
    expect(portalApprovalPrincipalMatches(expected, null)).toBe(false);
  });

  it("refuses employee, wrong-client, missing, and pseudo principals before effects", async () => {
    const before = await businessSnapshot();
    const portal = resolveDevUser("portal_a");
    const attempts = [
      resolveDevUser("partner"),
      resolveDevUser("portal_b"),
      null,
      {
        ...portal,
        employeeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      },
    ];
    for (const actor of attempts) {
      await expect(
        actOnPortalApproval({
          clientId: DEMO_CLIENT_ID,
          approvalId: DEMO_PORTAL_APPROVE_ID,
          action: "approve",
          actor: actor as typeof portal,
        }),
      ).rejects.toThrow(
        actor && actor.actorType === "portal" && actor.clientId === DEMO_CLIENT_ID
          ? PORTAL_IDENTITY_NOT_BOUND
          : CLIENT_PORTAL_ACTOR_REQUIRED,
      );
      expect(await businessSnapshot()).toEqual(before);
    }
  });

  it("rechecks active canonical status before every decision", async () => {
    const store = getDemoStore();
    const portal = resolveDevUser("portal_a");
    store.portalUsers.get(portal.employeeId)!.isActive = false;
    const before = await businessSnapshot();
    await expect(
      actOnPortalApproval({
        clientId: DEMO_CLIENT_ID,
        approvalId: DEMO_PORTAL_APPROVE_ID,
        action: "approve",
        actor: portal,
      }),
    ).rejects.toThrow(PORTAL_IDENTITY_NOT_BOUND);
    expect(await businessSnapshot()).toEqual(before);
  });

  it("reconciles one portal-attributed receipt after a post-decision seam failure", async () => {
    const portal = resolveDevUser("portal_a");
    const store = getDemoStore();
    const seamSpy = vi
      .spyOn(seams, "driveSeamAsync")
      .mockRejectedValueOnce(new Error("injected_seam_failure"));

    const first = await actOnPortalApproval({
      clientId: DEMO_CLIENT_ID,
      approvalId: DEMO_PORTAL_APPROVE_ID,
      action: "approve",
      actor: portal,
    });
    expect(first.changed).toBe(true);
    expect(
      store.seamOutbox.filter((event) =>
        event.idempotencyKey.startsWith("creative.approved:"),
      ),
    ).toHaveLength(0);

    const retry = await actOnPortalApproval({
      clientId: DEMO_CLIENT_ID,
      approvalId: DEMO_PORTAL_APPROVE_ID,
      action: "approve",
      actor: portal,
    });
    expect(retry.changed).toBe(false);
    expect(seamSpy).toHaveBeenCalledTimes(2);
    expect(
      store.audits.filter(
        (event) => event.action === "portal.approvals.act",
      ),
    ).toHaveLength(1);
    expect(
      store.seamOutbox.filter((event) =>
        event.idempotencyKey.startsWith("creative.approved:"),
      ),
    ).toHaveLength(1);
    expect(
      store.audits.find(
        (event) => event.action === "seams.creative.approved",
      ),
    ).toMatchObject({
      actorEmployeeId: null,
      actorPortalUserId: portal.employeeId,
    });
  });

  it("keeps the retired employee/agent executor inert", async () => {
    const before = await businessSnapshot();
    const result = await runOsPortalApprove({
      approvalId: DEMO_PORTAL_APPROVE_ID,
      prompt: "Approve OS portal",
      actorEmployeeId: resolveDevUser("partner").employeeId,
    });
    expect(result).toEqual({
      ok: false,
      reason: CLIENT_PORTAL_ACTOR_REQUIRED,
      approvalId: DEMO_PORTAL_APPROVE_ID,
    });
    expect(await businessSnapshot()).toEqual(before);
  });

  it("cannot seed a pending synthetic request outside the exact gate", () => {
    const before = getDemoStore().portalApprovals.size;
    vi.stubEnv("WORK_ENVIRONMENT_KIND", "production");
    expect(() =>
      ensureSyntheticPortalApprovalRequest({
        taskId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        clientId: DEMO_CLIENT_ID,
        title: "Blocked fixture",
      }),
    ).toThrow("PORTAL_SYNTHETIC_FIXTURE_DISABLED");
    expect(getDemoStore().portalApprovals.size).toBe(before);
  });
});

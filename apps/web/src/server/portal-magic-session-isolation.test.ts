process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import {
  DEMO_CLIENT_B_ID,
  DEMO_CLIENT_ID,
  DEMO_PORTAL_USER_ID,
  getDemoStore,
} from "./demo-store";
import {
  issuePortalMagicToken,
  resolvePortalSessionGrant,
  upsertPortalAllowlistContact,
  verifyPortalMagicToken,
} from "./auth/portal-magic-link";
import { sessionCanViewMargin } from "./auth/session";

describe("portal magic-link session grant isolation", () => {
  beforeEach(async () => {
    getDemoStore().resetM6Demo();
    getDemoStore().portalMagicTokens.clear();
    getDemoStore().portalSessionGrants.clear();
    await upsertPortalAllowlistContact({
      email: "alex@democo.example",
      clientId: DEMO_CLIENT_ID,
    });
    await upsertPortalAllowlistContact({
      email: "ops@otherco.example",
      clientId: DEMO_CLIENT_B_ID,
    });
  });

  async function callerFromGrant(email: string, clientId: string) {
    const token = await issuePortalMagicToken({ clientId, email });
    const verified = await verifyPortalMagicToken(token);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error("verify failed");
    expect(verified.sessionGrant.startsWith("ps_")).toBe(true);
    const session = await resolvePortalSessionGrant(verified.sessionGrant);
    expect(session?.clientId).toBe(clientId);
    expect(session?.actorType).toBe("portal");
    return {
      caller: createCaller({
        user: session,
        employeeId: session!.employeeId,
        roles: session!.roles,
        canViewMargin: sessionCanViewMargin(session!),
        clientId: session!.clientId,
        portalGrant: verified.sessionGrant,
      }),
      sessionGrant: verified.sessionGrant,
    };
  }

  it("ps_ grants keep Demo Co and Other Co portal lists isolated", async () => {
    const portalAGrant = await callerFromGrant(
      "alex@democo.example",
      DEMO_CLIENT_ID,
    );
    const portalBGrant = await callerFromGrant(
      "ops@otherco.example",
      DEMO_CLIENT_B_ID,
    );
    const portalA = portalAGrant.caller;
    const portalB = portalBGrant.caller;

    const aTasks = await portalA.portal.tasks.list();
    const aAssets = await portalA.portal.assets.list();
    const aApprovals = await portalA.portal.approvals.list();
    const bTasks = await portalB.portal.tasks.list();
    const bAssets = await portalB.portal.assets.list();
    const bApprovals = await portalB.portal.approvals.list();

    const aBlob = JSON.stringify({ aTasks, aAssets, aApprovals });
    const bBlob = JSON.stringify({ bTasks, bAssets, bApprovals });

    expect(aBlob).toMatch(/Launch reel|Demo Co|Approve launch/i);
    expect(aBlob).not.toMatch(/Other Co/i);
    expect(bBlob).toMatch(/Other Co/i);
    expect(bBlob).not.toMatch(/Launch reel|Approve launch reel cut|Demo Co/i);

    const pending = aApprovals.find(
      (approval) => approval.status === "pending",
    );
    expect(pending).toBeDefined();
    const store = getDemoStore();
    const approved = await portalA.portal.approvals.act({
      id: pending!.approvalId,
      action: "approve",
    });
    expect(approved).toMatchObject({ ok: true, changed: true });
    expect(store.portalApprovals.get(pending!.approvalId)?.status).toBe(
      "approved",
    );
    expect(
      store.audits.some(
        (event) =>
          event.action === "portal.approvals.act" &&
          event.actorPortalUserId === DEMO_PORTAL_USER_ID &&
          event.actorEmployeeId === null,
      ),
    ).toBe(true);

    const otherPending = aApprovals.find(
      (approval) =>
        approval.status === "pending" &&
        approval.approvalId !== pending!.approvalId,
    );
    expect(otherPending).toBeDefined();
    const beforeCrossClient = {
      status: store.portalApprovals.get(otherPending!.approvalId)?.status,
      audits: store.audits.length,
      seams: store.seamOutbox.length,
    };
    await expect(
      portalB.portal.approvals.act({
        id: otherPending!.approvalId,
        action: "approve",
      }),
    ).rejects.toThrow(/NOT_FOUND/);
    expect({
      status: store.portalApprovals.get(otherPending!.approvalId)?.status,
      audits: store.audits.length,
      seams: store.seamOutbox.length,
    }).toEqual(beforeCrossClient);

    const portalUser = store.portalUsers.get(DEMO_PORTAL_USER_ID)!;
    portalUser.isActive = false;
    expect(
      await resolvePortalSessionGrant(portalAGrant.sessionGrant),
    ).toBeNull();
    await expect(
      portalA.portal.approvals.act({
        id: otherPending!.approvalId,
        action: "approve",
      }),
    ).rejects.toThrow("PORTAL_IDENTITY_NOT_BOUND");
    expect({
      status: store.portalApprovals.get(otherPending!.approvalId)?.status,
      audits: store.audits.length,
      seams: store.seamOutbox.length,
    }).toEqual(beforeCrossClient);
  });

  it("revokes only the presented portal session grant", async () => {
    const first = await callerFromGrant("alex@democo.example", DEMO_CLIENT_ID);
    const second = await callerFromGrant("alex@democo.example", DEMO_CLIENT_ID);

    await expect(first.caller.portal.auth.logout()).resolves.toEqual({
      revoked: true,
    });
    await expect(
      resolvePortalSessionGrant(first.sessionGrant),
    ).resolves.toBeNull();
    await expect(
      resolvePortalSessionGrant(second.sessionGrant),
    ).resolves.toMatchObject({
      clientId: DEMO_CLIENT_ID,
    });
  });
});

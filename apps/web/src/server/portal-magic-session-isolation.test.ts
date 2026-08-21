process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { createCaller } from "./trpc/root";
import { DEMO_CLIENT_B_ID, DEMO_CLIENT_ID, getDemoStore } from "./demo-store";
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
    return createCaller({
      user: session,
      employeeId: session!.employeeId,
      roles: session!.roles,
      canViewMargin: sessionCanViewMargin(session!),
      clientId: session!.clientId,
    });
  }

  it("ps_ grants keep Demo Co and Other Co portal lists isolated", async () => {
    const portalA = await callerFromGrant(
      "alex@democo.example",
      DEMO_CLIENT_ID,
    );
    const portalB = await callerFromGrant(
      "ops@otherco.example",
      DEMO_CLIENT_B_ID,
    );

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
  });
});

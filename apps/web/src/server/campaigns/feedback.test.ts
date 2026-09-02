import { beforeEach, describe, expect, it } from "vitest";
import type { PortalApprovalActor } from "../portal/approval-boundary";
import { createCaller } from "../trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { resetCampaignMemory } from "./memory";
import {
  addFeedback,
  listFeedbackByItem,
  resetFeedbackMemory,
  resolveFeedback,
} from "./feedback";
import {
  createCampaignDraft,
  decidePortalItem,
  getCampaign,
} from "./repository";
import { getDemoStore } from "../demo-store";

const CLIENT_A = "c1000000-0000-4000-8000-0000000000a4"; // portal_a
const ITEM_A = "c9000000-0000-4000-8000-000000000001"; // seed: CLIENT_A, pending
const ITEM_B = "c9000000-0000-4000-8000-000000000003"; // seed: CLIENT_B, approved

const portalActor: PortalApprovalActor = {
  employeeId: "c0000000-0000-4000-8000-0000000000a1",
  roles: ["portal_client"],
  permissions: ["allow:portal:approve"],
  actorType: "portal",
  clientId: CLIENT_A,
};

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

describe("portal feedback repository (memory mode)", () => {
  beforeEach(() => {
    getDemoStore().resetM6Demo();
    resetCampaignMemory();
    resetFeedbackMemory();
  });

  it("orders the consolidated thread oldest-first by insertion", async () => {
    for (const body of ["first", "second", "third"]) {
      await addFeedback({
        campaignItemId: ITEM_A,
        authorKind: "staff",
        authorId: null,
        clientId: CLIENT_A,
        body,
      });
    }
    const thread = await listFeedbackByItem(ITEM_A);
    expect(thread.map((c) => c.body)).toEqual(["first", "second", "third"]);
  });

  it("resolves a comment (resolved flips true)", async () => {
    const c = await addFeedback({
      campaignItemId: ITEM_A,
      authorKind: "client",
      authorId: "x",
      clientId: CLIENT_A,
      body: "please fix",
    });
    expect(c.resolved).toBe(false);
    const resolved = await resolveFeedback(c.id);
    expect(resolved?.resolved).toBe(true);
    expect((await listFeedbackByItem(ITEM_A))[0]?.resolved).toBe(true);
  });

  it("rejects a reject with no feedback body, leaving the item untouched", async () => {
    const draft = await createCampaignDraft({
      title: "Needs a reason",
      channel: "linkedin",
      scheduledFor: "2026-09-09",
      clientId: CLIENT_A,
    });
    const result = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT_A,
      id: draft.campaignItemId,
      to: "rejected",
      feedback: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(result.code).toBe("FEEDBACK_REQUIRED");
    expect(await listFeedbackByItem(draft.campaignItemId)).toHaveLength(0);
  });

  it("records the rejection feedback as the first client thread comment", async () => {
    const draft = await createCampaignDraft({
      title: "Tighten the hook please",
      channel: "instagram",
      scheduledFor: "2026-09-10",
      clientId: CLIENT_A,
    });
    const result = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT_A,
      id: draft.campaignItemId,
      to: "rejected",
      feedback: "Tighten the hook",
    });
    expect(result.ok).toBe(true);
    const thread = await listFeedbackByItem(draft.campaignItemId);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({
      authorKind: "client",
      clientId: CLIENT_A,
      body: "Tighten the hook",
    });
  });
});

describe("portal feedback client scoping (tRPC boundary)", () => {
  beforeEach(() => {
    getDemoStore().resetM6Demo();
    resetCampaignMemory();
    resetFeedbackMemory();
  });

  it("rejects a fabricated portal principal before a campaign decision", async () => {
    const fake = {
      ...resolveDevUser("portal_a"),
      employeeId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    };
    const caller = createCaller({
      user: fake,
      employeeId: fake.employeeId,
      roles: fake.roles,
      canViewMargin: false,
      clientId: fake.clientId,
    });
    const before = await getCampaign(ITEM_A);
    const auditCount = getDemoStore().audits.length;
    await expect(
      caller.portal.campaignApprovals.approve({ id: ITEM_A }),
    ).rejects.toThrow("PORTAL_IDENTITY_NOT_BOUND");
    expect(await getCampaign(ITEM_A)).toEqual(before);
    expect(getDemoStore().audits).toHaveLength(auditCount);
  });

  it("shows a staff comment to the item's client and hides it from other clients", async () => {
    const staff = callerFor("partner");
    await staff.campaigns.feedback.add({
      campaignItemId: ITEM_A,
      body: "Draft looks close — one tweak.",
    });

    const a = callerFor("portal_a");
    const thread = await a.portal.campaignApprovals.feedback.list({
      campaignItemId: ITEM_A,
    });
    expect(thread.map((c) => c.authorKind)).toContain("staff");

    // portal_a can add to its own item; the thread grows in order.
    await a.portal.campaignApprovals.feedback.add({
      campaignItemId: ITEM_A,
      body: "Thanks, go ahead.",
    });
    const after = await a.portal.campaignApprovals.feedback.list({
      campaignItemId: ITEM_A,
    });
    expect(after.map((c) => c.body)).toEqual([
      "Draft looks close — one tweak.",
      "Thanks, go ahead.",
    ]);
  });

  it("forbids a client from reading or writing another client's thread", async () => {
    const b = callerFor("portal_b"); // CLIENT_B — ITEM_A belongs to CLIENT_A
    await expect(
      b.portal.campaignApprovals.feedback.list({ campaignItemId: ITEM_A }),
    ).rejects.toThrow(/FORBIDDEN/);
    await expect(
      b.portal.campaignApprovals.feedback.add({
        campaignItemId: ITEM_A,
        body: "sneaking in",
      }),
    ).rejects.toThrow(/FORBIDDEN/);
    // And symmetrically, portal_a cannot touch CLIENT_B's item.
    const a = callerFor("portal_a");
    await expect(
      a.portal.campaignApprovals.feedback.list({ campaignItemId: ITEM_B }),
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it("keeps resolve staff-only (portal cannot reach the staff API)", async () => {
    const a = callerFor("portal_a");
    // Portal actors are blocked from staff campaigns.* at the boundary (runtime).
    await expect(a.campaigns.feedback.resolve({ id: ITEM_A })).rejects.toThrow(
      /FORBIDDEN/,
    );

    const staff = callerFor("partner");
    const comment = await staff.campaigns.feedback.add({
      campaignItemId: ITEM_A,
      body: "internal note",
    });
    const resolved = await staff.campaigns.feedback.resolve({ id: comment.id });
    expect(resolved.resolved).toBe(true);
  });

  it("requires a feedback body when a client requests changes", async () => {
    const a = callerFor("portal_a");
    await expect(
      // @ts-expect-error — feedback is required on reject.
      a.portal.campaignApprovals.reject({ id: ITEM_A }),
    ).rejects.toThrow();
    const ok = await a.portal.campaignApprovals.reject({
      id: ITEM_A,
      feedback: "Please revise the copy.",
    });
    expect(ok.ok).toBe(true);
    expect(
      getDemoStore().audits.find(
        (event) =>
          event.entityId === ITEM_A &&
          event.actorPortalUserId === resolveDevUser("portal_a").employeeId,
      ),
    ).toMatchObject({ actorEmployeeId: null });
    const thread = await a.portal.campaignApprovals.feedback.list({
      campaignItemId: ITEM_A,
    });
    expect(thread.at(-1)?.body).toBe("Please revise the copy.");
  });

  it("makes approve and reject router retries idempotent", async () => {
    const a = callerFor("portal_a");
    const firstApprove = await a.portal.campaignApprovals.approve({ id: ITEM_A });
    const replayApprove = await a.portal.campaignApprovals.approve({ id: ITEM_A });
    expect(firstApprove).toMatchObject({ ok: true, changed: true });
    expect(replayApprove).toMatchObject({ ok: true, changed: false });

    resetCampaignMemory();
    resetFeedbackMemory();
    getDemoStore().resetM6Demo();
    const firstReject = await a.portal.campaignApprovals.reject({
      id: ITEM_A,
      feedback: "Tighten the opening line",
    });
    const replayReject = await a.portal.campaignApprovals.reject({
      id: ITEM_A,
      feedback: "  Tighten the opening line  ",
    });
    expect(firstReject).toMatchObject({ ok: true, changed: true });
    expect(replayReject).toMatchObject({ ok: true, changed: false });
    expect(await listFeedbackByItem(ITEM_A)).toHaveLength(1);
    if (!firstReject.ok) throw new Error("expected rejection success");
    expect(
      getDemoStore().audits.filter(
        (event) => event.auditEventId === firstReject.auditId,
      ),
    ).toHaveLength(1);
  });

  it("conflicts on a changed rejection replay and preserves the first feedback", async () => {
    const a = callerFor("portal_a");
    await a.portal.campaignApprovals.reject({
      id: ITEM_A,
      feedback: "Use the shorter headline",
    });
    await expect(
      a.portal.campaignApprovals.reject({
        id: ITEM_A,
        feedback: "Replace the entire concept",
      }),
    ).rejects.toThrow(/CONFLICT/);
    const thread = await listFeedbackByItem(ITEM_A);
    expect(thread.map((row) => row.body)).toEqual(["Use the shorter headline"]);
    expect((await getCampaign(ITEM_A))?.body.clientFeedback).toBe(
      "Use the shorter headline",
    );
  });

  it("reconciles a post-commit projector failure on exact replay", async () => {
    const first = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT_A,
      id: ITEM_A,
      to: "rejected",
      feedback: "Move the logo left",
      emit: async () => {
        throw new Error("INJECTED_PROJECTION_FAILURE");
      },
    });
    expect(first).toMatchObject({ ok: true, changed: true, reconciled: false });
    expect(await listFeedbackByItem(ITEM_A)).toHaveLength(0);
    const pending = getDemoStore().seamOutbox.find(
      (event) =>
        event.idempotencyKey === `portal.campaign.decision:${ITEM_A}`,
    );
    expect(pending).toMatchObject({ applied: false });

    const replay = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT_A,
      id: ITEM_A,
      to: "rejected",
      feedback: "Move the logo left",
    });
    expect(replay).toMatchObject({ ok: true, changed: false, reconciled: true });
    expect(await listFeedbackByItem(ITEM_A)).toHaveLength(1);
    expect(pending).toMatchObject({ applied: true });
    if (!first.ok) throw new Error("expected rejection success");
    expect(
      getDemoStore().audits.filter(
        (event) => event.auditEventId === first.auditId,
      ),
    ).toHaveLength(1);
  });
});

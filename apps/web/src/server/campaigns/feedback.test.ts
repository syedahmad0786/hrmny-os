import { beforeEach, describe, expect, it } from "vitest";
import type { ActorContext } from "@hrmny/gate";
import { createCaller } from "../trpc/root";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { resetCampaignMemory } from "./memory";
import {
  addFeedback,
  listFeedbackByItem,
  resetFeedbackMemory,
  resolveFeedback,
} from "./feedback";
import { createCampaignDraft, decidePortalItem } from "./repository";

const CLIENT_A = "c1000000-0000-4000-8000-0000000000a4"; // portal_a
const ITEM_A = "c9000000-0000-4000-8000-000000000001"; // seed: CLIENT_A, pending
const ITEM_B = "c9000000-0000-4000-8000-000000000003"; // seed: CLIENT_B, approved

const portalActor: ActorContext = {
  employeeId: "d0000000-0000-4000-8000-0000000000a1",
  roles: ["portal_client"],
  permissions: [],
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
    resetCampaignMemory();
    resetFeedbackMemory();
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
    const thread = await a.portal.campaignApprovals.feedback.list({
      campaignItemId: ITEM_A,
    });
    expect(thread.at(-1)?.body).toBe("Please revise the copy.");
  });
});

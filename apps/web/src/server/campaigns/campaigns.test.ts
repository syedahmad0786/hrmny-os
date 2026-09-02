import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@hrmny/gate";
import type { PortalApprovalActor } from "../portal/approval-boundary";
import type {
  SocialChannel,
  SocialPublishAdapter,
  SocialPublishInput,
  SocialPublishResult,
} from "@hrmny/integrations";
import { resetCampaignMemory } from "./memory";
import {
  createCampaignDraft,
  decidePortalItem,
  getCampaign,
  listApprovalViews,
  listCampaigns,
  portalStateOf,
  transitionCampaign,
} from "./repository";
import {
  DEMO_CLIENT_ID,
  DEMO_PORTAL_USER_ID,
  getDemoStore,
} from "../demo-store";

const CLIENT = DEMO_CLIENT_ID;

const staffActor: ActorContext = {
  employeeId: "c0000000-0000-4000-8000-000000000001",
  roles: ["partner"],
  permissions: [],
};

const portalActor: PortalApprovalActor = {
  employeeId: DEMO_PORTAL_USER_ID,
  roles: ["portal_client"],
  permissions: ["allow:portal:approve"],
  actorType: "portal",
  clientId: CLIENT,
};

// Staff actor wearing a non-client role — must be denied the client approval.
const staffAsClient: PortalApprovalActor = {
  employeeId: "c0000000-0000-4000-8000-000000000002",
  roles: ["account_manager"],
  permissions: [],
  actorType: "staff",
  clientId: null,
};

function spyPublisher(): {
  adapter: SocialPublishAdapter;
  calls: () => number;
} {
  const publish = vi.fn(
    async (input: SocialPublishInput): Promise<SocialPublishResult> => ({
      published: true,
      mode: "live",
      externalId: `live-${input.channel}-1`,
      channel: input.channel,
      url: `https://example.test/${input.channel}/1`,
    }),
  );
  return {
    adapter: {
      mode: "live",
      listChannels: async (): Promise<SocialChannel[]> => [
        "linkedin",
        "instagram",
        "facebook",
        "x",
      ],
      publishAfterApproval: publish,
    },
    calls: () => publish.mock.calls.length,
  };
}

describe("campaigns durable layer (memory mode)", () => {
  beforeEach(() => {
    getDemoStore().resetM6Demo();
    resetCampaignMemory();
  });

  it("creates a draft and lists it scoped by client", async () => {
    const draft = await createCampaignDraft({
      title: "New brand teaser",
      channel: "linkedin",
      scheduledFor: "2026-09-01",
      clientId: CLIENT,
    });
    expect(draft.status).toBe("draft");

    const forClient = await listCampaigns({ clientId: CLIENT });
    expect(forClient.map((c) => c.campaignItemId)).toContain(
      draft.campaignItemId,
    );

    const fetched = await getCampaign(draft.campaignItemId);
    expect(fetched?.title).toBe("New brand teaser");
  });

  it("blocks an illegal campaign transition (draft → published) at the gate", async () => {
    const draft = await createCampaignDraft({
      title: "Skip-approval attempt",
      channel: "linkedin",
      scheduledFor: "2026-09-02",
      clientId: CLIENT,
    });

    const result = await transitionCampaign({
      actor: staffActor,
      id: draft.campaignItemId,
      to: "published",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(result.code).toBe("GATE_BLOCKED");
    expect(result.blockedBy?.some((b) => b.gate === "campaign.legal_transition")).toBe(
      true,
    );
    // Nothing published; still a draft.
    expect((await getCampaign(draft.campaignItemId))?.status).toBe("draft");
  });

  it("publishes only after approve, firing the adapter inside the gate", async () => {
    const draft = await createCampaignDraft({
      title: "Case study",
      channel: "linkedin",
      scheduledFor: "2026-09-03",
      clientId: CLIENT,
    });
    const publisher = spyPublisher();

    const approved = await transitionCampaign({
      actor: staffActor,
      id: draft.campaignItemId,
      to: "approved",
      publisher: publisher.adapter,
    });
    expect(approved.ok).toBe(true);
    expect(publisher.calls()).toBe(0); // approve does not publish

    const published = await transitionCampaign({
      actor: staffActor,
      id: draft.campaignItemId,
      to: "published",
      publisher: publisher.adapter,
    });
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error("expected publish");
    expect(published.item.status).toBe("published");
    expect(publisher.calls()).toBe(1);
    expect(published.item.body.publish).toMatchObject({ published: true });
  });

  it("stub publisher marks OS published with mode=stub (no LinkedIn OAuth)", async () => {
    const draft = await createCampaignDraft({
      title: "Stub publish demo",
      channel: "linkedin",
      scheduledFor: "2026-09-10",
      clientId: CLIENT,
    });
    const approved = await transitionCampaign({
      actor: staffActor,
      id: draft.campaignItemId,
      to: "approved",
    });
    expect(approved.ok).toBe(true);

    const published = await transitionCampaign({
      actor: staffActor,
      id: draft.campaignItemId,
      to: "published",
      // default createSocialPublishStub
    });
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error("expected stub publish");
    expect(published.item.status).toBe("published");
    expect(published.item.body.publish).toMatchObject({
      published: true,
      mode: "stub",
      channel: "linkedin",
    });
  });

  it("lets the client approve a pending item, unlocking staff publish", async () => {
    const draft = await createCampaignDraft({
      title: "Client sign-off flow",
      channel: "linkedin",
      scheduledFor: "2026-09-04",
      clientId: CLIENT,
    });
    expect(portalStateOf(draft)).toBe("pending_client");

    const decided = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "approved",
    });
    expect(decided.ok).toBe(true);
    if (!decided.ok) throw new Error("expected approve");
    expect(decided.state).toBe("approved");
    expect(decided.item.status).toBe("approved");

    // Client approval unlocked the approved→published gate.
    const publisher = spyPublisher();
    const published = await transitionCampaign({
      actor: staffActor,
      id: draft.campaignItemId,
      to: "published",
      publisher: publisher.adapter,
    });
    expect(published.ok).toBe(true);
  });

  it("returns an exact approval replay as no-change with one portal receipt", async () => {
    const draft = await createCampaignDraft({
      title: "Replay-safe approval",
      channel: "linkedin",
      clientId: CLIENT,
    });
    const first = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "approved",
    });
    const replay = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "approved",
    });

    expect(first).toMatchObject({ ok: true, changed: true, reconciled: true });
    expect(replay).toMatchObject({ ok: true, changed: false, reconciled: true });
    if (!first.ok || !replay.ok) throw new Error("expected replay success");
    expect(replay.auditId).toBe(first.auditId);
    const store = getDemoStore();
    const audits = store.audits.filter(
      (event) =>
        event.entityId === draft.campaignItemId &&
        event.action === "portal_item.transition",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorEmployeeId: null,
      actorPortalUserId: portalActor.employeeId,
    });
    const intents = store.seamOutbox.filter(
      (event) =>
        event.idempotencyKey ===
        `portal.campaign.decision:${draft.campaignItemId}`,
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ applied: true });
    expect(intents[0]?.payload).toMatchObject({
      action: "approved",
      portalUserId: portalActor.employeeId,
      auditId: first.auditId,
    });
  });

  it("rolls back state and intent when the decision audit fails", async () => {
    const draft = await createCampaignDraft({
      title: "Atomic audit failure",
      channel: "instagram",
      clientId: CLIENT,
    });
    const beforeAudits = getDemoStore().audits.length;
    await expect(
      decidePortalItem({
        actor: portalActor,
        clientId: CLIENT,
        id: draft.campaignItemId,
        to: "approved",
        audit: async () => {
          throw new Error("INJECTED_AUDIT_FAILURE");
        },
      }),
    ).rejects.toThrow("INJECTED_AUDIT_FAILURE");
    expect(portalStateOf((await getCampaign(draft.campaignItemId))!)).toBe(
      "pending_client",
    );
    expect(getDemoStore().audits).toHaveLength(beforeAudits);
    expect(
      getDemoStore().seamOutbox.some(
        (event) =>
          event.idempotencyKey ===
          `portal.campaign.decision:${draft.campaignItemId}`,
      ),
    ).toBe(false);
  });

  it("keeps another item's evidence when a delayed decision audit fails", async () => {
    const failingDraft = await createCampaignDraft({
      title: "Delayed audit failure",
      channel: "instagram",
      clientId: CLIENT,
    });
    const successfulDraft = await createCampaignDraft({
      title: "Concurrent successful approval",
      channel: "linkedin",
      clientId: CLIENT,
    });
    let markAuditStarted!: () => void;
    let releaseAudit!: () => void;
    const auditStarted = new Promise<void>((resolve) => {
      markAuditStarted = resolve;
    });
    const auditRelease = new Promise<void>((resolve) => {
      releaseAudit = resolve;
    });

    const failingDecision = decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: failingDraft.campaignItemId,
      to: "approved",
      audit: async () => {
        markAuditStarted();
        await auditRelease;
        throw new Error("INJECTED_DELAYED_AUDIT_FAILURE");
      },
    });
    await auditStarted;

    const successfulDecision = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: successfulDraft.campaignItemId,
      to: "approved",
    });
    expect(successfulDecision).toMatchObject({
      ok: true,
      changed: true,
      reconciled: true,
    });

    releaseAudit();
    await expect(failingDecision).rejects.toThrow(
      "INJECTED_DELAYED_AUDIT_FAILURE",
    );

    expect(
      portalStateOf((await getCampaign(failingDraft.campaignItemId))!),
    ).toBe("pending_client");
    expect(
      portalStateOf((await getCampaign(successfulDraft.campaignItemId))!),
    ).toBe("approved");
    const store = getDemoStore();
    const successfulAudits = store.audits.filter(
      (event) =>
        event.entityId === successfulDraft.campaignItemId &&
        event.action === "portal_item.transition",
    );
    expect(successfulAudits).toHaveLength(1);
    const successfulIntents = store.seamOutbox.filter(
      (event) =>
        event.idempotencyKey ===
        `portal.campaign.decision:${successfulDraft.campaignItemId}`,
    );
    expect(successfulIntents).toHaveLength(1);
    expect(successfulIntents[0]).toMatchObject({
      applied: true,
      payload: { auditId: successfulAudits[0]!.auditEventId },
    });
    expect(
      store.audits.some(
        (event) => event.entityId === failingDraft.campaignItemId,
      ),
    ).toBe(false);
    expect(
      store.seamOutbox.some(
        (event) =>
          event.idempotencyKey ===
          `portal.campaign.decision:${failingDraft.campaignItemId}`,
      ),
    ).toBe(false);
  });

  it("serializes concurrent opposite decisions into one receipt and one conflict", async () => {
    const draft = await createCampaignDraft({
      title: "Concurrent decision",
      channel: "linkedin",
      clientId: CLIENT,
    });
    const [approve, reject] = await Promise.all([
      decidePortalItem({
        actor: portalActor,
        clientId: CLIENT,
        id: draft.campaignItemId,
        to: "approved",
      }),
      decidePortalItem({
        actor: portalActor,
        clientId: CLIENT,
        id: draft.campaignItemId,
        to: "rejected",
        feedback: "Use the shorter caption",
      }),
    ]);
    expect([approve, reject].filter((result) => result.ok)).toHaveLength(1);
    expect(
      [approve, reject].filter(
        (result) => !result.ok && result.code === "CONFLICT",
      ),
    ).toHaveLength(1);
    const item = (await getCampaign(draft.campaignItemId))!;
    const decision = item.body.clientDecision;
    expect(decision === "approved" || decision === "rejected").toBe(true);
    expect(
      item.status === "approved" && decision === "rejected",
    ).toBe(false);
    expect(
      getDemoStore().audits.filter(
        (event) =>
          event.entityId === draft.campaignItemId &&
          event.action === "portal_item.transition",
      ),
    ).toHaveLength(1);
    expect(
      getDemoStore().seamOutbox.filter(
        (event) =>
          event.idempotencyKey ===
          `portal.campaign.decision:${draft.campaignItemId}`,
      ),
    ).toHaveLength(1);
  });

  it("denies a staff (non-client) actor from approving in the portal", async () => {
    const draft = await createCampaignDraft({
      title: "Self-approval attempt",
      channel: "linkedin",
      scheduledFor: "2026-09-05",
      clientId: CLIENT,
    });

    await expect(
      decidePortalItem({
        actor: staffAsClient,
        clientId: CLIENT,
        id: draft.campaignItemId,
        to: "approved",
      }),
    ).rejects.toThrow("CLIENT_PORTAL_ACTOR_REQUIRED");
    // Item untouched — still pending.
    expect(portalStateOf((await getCampaign(draft.campaignItemId))!)).toBe(
      "pending_client",
    );
  });

  it("records a client rejection as a decision marker + feedback", async () => {
    const draft = await createCampaignDraft({
      title: "Needs revision",
      channel: "instagram",
      scheduledFor: "2026-09-06",
      clientId: CLIENT,
    });

    const rejected = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "rejected",
      feedback: "Tighten the hook",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) throw new Error("expected reject");
    expect(rejected.state).toBe("rejected");
    expect(rejected.item.status).toBe("draft"); // stays a draft

    const pending = await listApprovalViews({
      clientId: CLIENT,
      state: "pending_client",
    });
    expect(pending.some((v) => v.campaignItemId === draft.campaignItemId)).toBe(
      false,
    );
    const view = (await listApprovalViews({ clientId: CLIENT })).find(
      (v) => v.campaignItemId === draft.campaignItemId,
    );
    expect(view?.feedback).toBe("Tighten the hook");
  });

  it("notifies staff inbox when the client approves a campaign", async () => {
    const draft = await createCampaignDraft({
      title: "Staff inbox ping",
      channel: "linkedin",
      scheduledFor: "2026-09-07",
      clientId: CLIENT,
    });
    const decided = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "approved",
    });
    expect(decided.ok).toBe(true);
    const { listNotifications } = await import("../notifications/store");
    const { DEMO_STAFF_LEAD_ID } = await import("../demo-store");
    const inbox = await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "campaign" &&
          /approved campaign/i.test(n.title) &&
          (n.href ?? "").includes("/approvals?id="),
      ),
    ).toBe(true);
  });


  it("notifies staff inbox when the client rejects a campaign with focusable href", async () => {
    const draft = await createCampaignDraft({
      title: "Needs a sharper hook",
      channel: "linkedin",
      scheduledFor: "2026-09-08",
      clientId: CLIENT,
    });
    const rejected = await decidePortalItem({
      actor: portalActor,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "rejected",
      feedback: "Lead with the offer",
    });
    expect(rejected.ok).toBe(true);
    const views = await listApprovalViews({ clientId: CLIENT });
    const view = views.find((v) => v.campaignItemId === draft.campaignItemId);
    expect(view?.state).toBe("rejected");
    expect(view?.feedback).toBe("Lead with the offer");

    const { listNotifications } = await import("../notifications/store");
    const { DEMO_STAFF_LEAD_ID } = await import("../demo-store");
    const inbox = await listNotifications(DEMO_STAFF_LEAD_ID, { limit: 20 });
    expect(
      inbox.some(
        (n) =>
          n.kind === "campaign" &&
          /campaign revisions/i.test(n.title) &&
          (n.href ?? "") === `/approvals?id=${draft.campaignItemId}`,
      ),
    ).toBe(true);
  });

});

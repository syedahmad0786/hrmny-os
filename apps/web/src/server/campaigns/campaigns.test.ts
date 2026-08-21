import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorContext } from "@hrmny/gate";
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

const CLIENT = "aa000000-0000-4000-8000-0000000000aa";

const staffActor: ActorContext = {
  employeeId: "c0000000-0000-4000-8000-000000000001",
  roles: ["partner"],
  permissions: [],
};

const portalActor: ActorContext = {
  employeeId: "d0000000-0000-4000-8000-0000000000a1",
  roles: ["portal_client"],
  permissions: [],
};

// Staff actor wearing a non-client role — must be denied the client approval.
const staffAsClient: ActorContext = {
  employeeId: "c0000000-0000-4000-8000-000000000002",
  roles: ["account_manager"],
  permissions: [],
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

  it("denies a staff (non-client) actor from approving in the portal", async () => {
    const draft = await createCampaignDraft({
      title: "Self-approval attempt",
      channel: "linkedin",
      scheduledFor: "2026-09-05",
      clientId: CLIENT,
    });

    const result = await decidePortalItem({
      actor: staffAsClient,
      clientId: CLIENT,
      id: draft.campaignItemId,
      to: "approved",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected block");
    expect(
      result.blockedBy?.some((b) => b.gate === "portal_item.client_approver"),
    ).toBe(true);
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

});

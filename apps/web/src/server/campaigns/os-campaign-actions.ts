/**
 * Shared OS campaign approve / stub-publish for agent tools.
 * Approve: draft → approved. Publish: approved → published via stub
 * (no LinkedIn OAuth required).
 */
import type { ActorContext } from "@hrmny/gate";
import {
  createSocialPublishStub,
  getCampaign,
  transitionCampaign,
} from "../campaigns/repository";

export type OsCampaignActor = {
  employeeId: string;
  roles?: string[];
};

export type OsCampaignActionResult = {
  ok: boolean;
  reason?: string;
  campaign: {
    campaignItemId: string;
    status: string;
    title: string;
    channel: string;
    publishMode?: string | null;
  } | null;
};

function actorFrom(input: OsCampaignActor): ActorContext {
  return {
    employeeId: input.employeeId,
    roles: input.roles?.length
      ? input.roles
      : ["partner", "am", "creative_director"],
    permissions: [],
  };
}

export function parseCampaignIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /(?:campaign(?:Item)?Id|campaign)\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  const bare = prompt.match(
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  );
  return bare?.[1]?.toLowerCase() ?? null;
}

export async function approveOsCampaign(input: {
  campaignItemId: string;
  actor: OsCampaignActor;
}): Promise<OsCampaignActionResult> {
  const existing = await getCampaign(input.campaignItemId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND", campaign: null };
  }
  const result = await transitionCampaign({
    actor: actorFrom(input.actor),
    id: input.campaignItemId,
    to: "approved",
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason ?? result.blockedBy?.[0]?.reason ?? "GATE_BLOCKED",
      campaign: {
        campaignItemId: existing.campaignItemId,
        status: existing.status,
        title: existing.title,
        channel: existing.channel,
      },
    };
  }
  return {
    ok: true,
    campaign: {
      campaignItemId: result.item.campaignItemId,
      status: result.item.status,
      title: result.item.title,
      channel: result.item.channel,
    },
  };
}

export async function publishOsCampaign(input: {
  campaignItemId: string;
  actor: OsCampaignActor;
}): Promise<OsCampaignActionResult> {
  const existing = await getCampaign(input.campaignItemId);
  if (!existing) {
    return { ok: false, reason: "NOT_FOUND", campaign: null };
  }
  const result = await transitionCampaign({
    actor: actorFrom(input.actor),
    id: input.campaignItemId,
    to: "published",
    publisher: createSocialPublishStub(),
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason ?? result.blockedBy?.[0]?.reason ?? "GATE_BLOCKED",
      campaign: {
        campaignItemId: existing.campaignItemId,
        status: existing.status,
        title: existing.title,
        channel: existing.channel,
      },
    };
  }
  const publish = result.item.body?.publish as
    | { mode?: string }
    | undefined;
  return {
    ok: true,
    campaign: {
      campaignItemId: result.item.campaignItemId,
      status: result.item.status,
      title: result.item.title,
      channel: result.item.channel,
      publishMode: publish?.mode ?? "stub",
    },
  };
}

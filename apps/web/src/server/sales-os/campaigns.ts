import { randomUUID } from "node:crypto";
import { getContact, getDeal, listDeals } from "../crm/repository";
import type { RunAgent } from "../leadgen/agent-run";
import { draftOutreach, listEmailFollowups } from "../trpc/leadgen-router";
import { listOutreach } from "../leadgen/store";
import {
  completeIntegrationReceipt,
  recordIntegrationReceipt,
} from "../integrations/inbox";
import { runDueFollowupDrafts } from "../leadgen/followup-scheduler";
import {
  getSalesOsSettings,
  isSuppressed,
  listEmailEvents,
  mutateSalesOsSettings,
} from "./store";
import type { SalesCampaignDefinition } from "./sops";

const EMAIL_CHANNELS = new Set(["email", "gmail"]);
const TERMINAL_EVENT_KINDS = new Set([
  "replied",
  "unsubscribed",
  "complained",
  "bounced",
]);

export type SalesCampaignView = SalesCampaignDefinition & {
  progress: {
    total: number;
    ready: number;
    drafted: number;
    approved: number;
    sent: number;
    replied: number;
    stopped: number;
    blocked: number;
    followupsDue: number;
    followupsQueued: number;
  };
  members: Array<{
    dealId: string;
    companyName: string;
    recipient: string | null;
    state:
      | "ready"
      | "draft"
      | "approved"
      | "sent"
      | "replied"
      | "stopped"
      | "blocked";
    reason: string;
  }>;
};

function renderTemplate(
  template: string,
  values: { firstName: string; company: string },
) {
  return template
    .replaceAll("{{firstName}}", values.firstName)
    .replaceAll("{{company}}", values.company);
}

async function appendCampaignReceipt(input: {
  campaignId: string;
  receipt: SalesCampaignDefinition["receipts"][number];
  startIfDraft?: boolean;
}) {
  return mutateSalesOsSettings((settings) => {
    const campaign = settings.campaigns.find(
      (item) => item.id === input.campaignId,
    );
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    const next: SalesCampaignDefinition = {
      ...campaign,
      status:
        input.startIfDraft && campaign.status === "draft"
          ? "running"
          : campaign.status,
      updatedAt: input.receipt.createdAt,
      receipts: [
        input.receipt,
        ...campaign.receipts.filter(
          (item) => item.receiptId !== input.receipt.receiptId,
        ),
      ].slice(0, 50),
    };
    return {
      settings: {
        ...settings,
        campaigns: settings.campaigns.map((item) =>
          item.id === next.id ? next : item,
        ),
      },
      result: next,
    };
  });
}

export async function createSalesCampaign(input: {
  name: string;
  dealIds: string[];
  subjectTemplate: string;
  bodyTemplate: string;
  actorEmployeeId?: string | null;
}): Promise<SalesCampaignDefinition> {
  const dealIds = [...new Set(input.dealIds)];
  if (!dealIds.length) throw new Error("CAMPAIGN_DEALS_REQUIRED");
  const deals = await Promise.all(dealIds.map((id) => getDeal(id)));
  if (deals.some((deal) => !deal)) throw new Error("CAMPAIGN_DEAL_NOT_FOUND");
  const now = new Date().toISOString();
  const campaign: SalesCampaignDefinition = {
    id: randomUUID(),
    name: input.name.trim(),
    status: "draft",
    dealIds,
    subjectTemplate: input.subjectTemplate.trim(),
    bodyTemplate: input.bodyTemplate.trim(),
    createdAt: now,
    updatedAt: now,
    createdBy: input.actorEmployeeId ?? null,
    receipts: [],
  };
  return mutateSalesOsSettings((settings) => {
    if (settings.campaigns.length >= 100)
      throw new Error("CAMPAIGN_LIMIT_REACHED");
    return {
      settings: {
        ...settings,
        campaigns: [campaign, ...settings.campaigns],
      },
      result: campaign,
    };
  }, input.actorEmployeeId);
}

export async function setSalesCampaignStatus(input: {
  campaignId: string;
  status: "running" | "paused" | "completed";
}): Promise<SalesCampaignDefinition> {
  return mutateSalesOsSettings((settings) => {
    const campaign = settings.campaigns.find(
      (item) => item.id === input.campaignId,
    );
    if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
    const next = {
      ...campaign,
      status: input.status,
      updatedAt: new Date().toISOString(),
    };
    return {
      settings: {
        ...settings,
        campaigns: settings.campaigns.map((item) =>
          item.id === next.id ? next : item,
        ),
      },
      result: next,
    };
  });
}

export async function listSalesCampaigns(): Promise<SalesCampaignView[]> {
  const [settings, deals, outreach, emailEvents, followups] = await Promise.all(
    [
      getSalesOsSettings(),
      listDeals(),
      listOutreach(),
      listEmailEvents(),
      listEmailFollowups(),
    ],
  );
  const dealById = new Map(deals.map((deal) => [deal.dealId, deal]));

  return Promise.all(
    settings.campaigns.map(async (campaign) => {
      const members: SalesCampaignView["members"] = [];
      for (const dealId of campaign.dealIds) {
        const deal = dealById.get(dealId);
        if (!deal) {
          members.push({
            dealId,
            companyName: "Lead unavailable",
            recipient: null,
            state: "blocked",
            reason: "Deal no longer exists",
          });
          continue;
        }
        const contact = deal.primaryContactId
          ? await getContact(deal.primaryContactId)
          : null;
        const sequence = outreach
          .filter(
            (item) =>
              item.dealId === dealId &&
              EMAIL_CHANNELS.has(item.channel.toLowerCase()),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const sequenceIds = new Set(sequence.map((item) => item.id));
        const terminal = emailEvents.find(
          (event) =>
            Boolean(
              event.outreachItemId && sequenceIds.has(event.outreachItemId),
            ) && TERMINAL_EVENT_KINDS.has(event.kind),
        );
        if (terminal?.kind === "replied") {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: contact?.email ?? null,
            state: "replied",
            reason: "Reply received — follow-ups stopped",
          });
          continue;
        }
        if (terminal) {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: contact?.email ?? null,
            state: "stopped",
            reason: `${terminal.kind} recorded — follow-ups stopped`,
          });
          continue;
        }
        const suppression = await isSuppressed({ email: contact?.email });
        if (suppression) {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: contact?.email ?? null,
            state: "stopped",
            reason: `Suppressed (${suppression.reason})`,
          });
          continue;
        }
        if (deal.closeOutcome) {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: contact?.email ?? null,
            state: "blocked",
            reason: "Deal is already closed",
          });
          continue;
        }
        const latest = sequence[0];
        if (latest?.state === "sent") {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: latest.recipient,
            state: "sent",
            reason: `Touch ${latest.cadenceTouch} sent`,
          });
        } else if (latest?.state === "approved") {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: latest.recipient,
            state: "approved",
            reason: `Touch ${latest.cadenceTouch} approved — send is still a separate action`,
          });
        } else if (latest?.state === "draft") {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: latest.recipient,
            state: "draft",
            reason: `Touch ${latest.cadenceTouch} awaits human review`,
          });
        } else if (!contact?.email || !contact.emailVerified) {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: contact?.email ?? null,
            state: "blocked",
            reason: "Verified work email required",
          });
        } else {
          members.push({
            dealId,
            companyName: deal.companyName,
            recipient: contact.email,
            state: "ready",
            reason: "Ready to prepare a first-touch draft",
          });
        }
      }
      const campaignFollowups = followups.filter((item) =>
        campaign.dealIds.includes(item.dealId),
      );
      const count = (state: SalesCampaignView["members"][number]["state"]) =>
        members.filter((member) => member.state === state).length;
      return {
        ...campaign,
        members,
        progress: {
          total: members.length,
          ready: count("ready"),
          drafted: count("draft"),
          approved: count("approved"),
          sent: count("sent"),
          replied: count("replied"),
          stopped: count("stopped"),
          blocked: count("blocked"),
          followupsDue: campaignFollowups.filter((item) => item.state === "due")
            .length,
          followupsQueued: campaignFollowups.filter(
            (item) => item.state === "queued",
          ).length,
        },
      };
    }),
  );
}

export async function runSalesCampaignFirstTouch(input: {
  campaignId: string;
  runId: string;
  actorEmployeeId?: string | null;
  runAgent?: RunAgent;
}) {
  const settings = await getSalesOsSettings();
  const campaign = settings.campaigns.find(
    (item) => item.id === input.campaignId,
  );
  if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
  if (campaign.status === "paused" || campaign.status === "completed") {
    throw new Error(`CAMPAIGN_${campaign.status.toUpperCase()}`);
  }
  const payload = {
    campaignId: campaign.id,
    runId: input.runId,
    dealIds: campaign.dealIds,
  };
  const receipt = await recordIntegrationReceipt({
    provider: "hrmny",
    externalEventId: `campaign-first-touch:${campaign.id}:${input.runId}`,
    operation: "sales.campaign.first_touch.prepare",
    rawBody: JSON.stringify(payload),
    payload,
    status: "processing",
    result: { bridgeStatus: "preparing_drafts" },
    ownerEmployeeId: input.actorEmployeeId ?? null,
  });
  if (receipt.duplicate && receipt.status === "completed") {
    return {
      duplicate: true as const,
      receiptId: receipt.receiptId,
      ...(receipt.result ?? {}),
    };
  }
  if (receipt.duplicate) throw new Error("CAMPAIGN_RUN_ALREADY_PROCESSING");

  let drafted = 0;
  let existing = 0;
  const blocked: Array<{ dealId: string; reason: string }> = [];
  const [allOutreach, emailEvents] = await Promise.all([
    listOutreach(),
    listEmailEvents(),
  ]);
  for (const dealId of campaign.dealIds) {
    const deal = await getDeal(dealId);
    if (!deal) {
      blocked.push({ dealId, reason: "Deal not found" });
      continue;
    }
    const sequence = allOutreach.filter(
      (item) =>
        item.dealId === dealId &&
        EMAIL_CHANNELS.has(item.channel.toLowerCase()),
    );
    const sequenceIds = new Set(sequence.map((item) => item.id));
    const terminal = emailEvents.find(
      (event) =>
        Boolean(
          event.outreachItemId && sequenceIds.has(event.outreachItemId),
        ) && TERMINAL_EVENT_KINDS.has(event.kind),
    );
    if (terminal) {
      blocked.push({
        dealId,
        reason: `${terminal.kind} recorded — cadence stopped`,
      });
      continue;
    }
    const contact = deal.primaryContactId
      ? await getContact(deal.primaryContactId)
      : null;
    if (!contact?.email || !contact.emailVerified) {
      blocked.push({ dealId, reason: "Verified work email required" });
      continue;
    }
    const suppression = await isSuppressed({ email: contact.email });
    if (suppression) {
      blocked.push({ dealId, reason: `Suppressed (${suppression.reason})` });
      continue;
    }
    if (deal.closeOutcome) {
      blocked.push({ dealId, reason: "Deal is closed" });
      continue;
    }
    const first = sequence.find(
      (item) => item.cadenceTouch === 1 && item.state !== "discarded",
    );
    if (first) {
      existing += 1;
      continue;
    }
    const values = {
      firstName: contact.firstName || "there",
      company: deal.companyName,
    };
    const subject = renderTemplate(campaign.subjectTemplate, values);
    const body = renderTemplate(campaign.bodyTemplate, values);
    if (!body.toLowerCase().includes(deal.companyName.toLowerCase())) {
      blocked.push({
        dealId,
        reason: "Message template must include {{company}}",
      });
      continue;
    }
    try {
      await draftOutreach({
        dealId,
        channel: "gmail",
        subject,
        body,
        runAgent: input.runAgent,
        cadenceTouch: 1,
      });
      drafted += 1;
    } catch (error) {
      blocked.push({
        dealId,
        reason: error instanceof Error ? error.message : "Draft failed",
      });
    }
  }
  const result = {
    bridgeStatus: "drafts_ready_for_human_review",
    drafted,
    existing,
    blocked,
    providerSends: 0,
  };
  await completeIntegrationReceipt(receipt.receiptId, result);
  const now = new Date().toISOString();
  await appendCampaignReceipt({
    campaignId: campaign.id,
    startIfDraft: drafted + existing > 0,
    receipt: {
      receiptId: receipt.receiptId,
      kind: "first_touch",
      createdAt: now,
      summary: `${drafted} draft${drafted === 1 ? "" : "s"} prepared · ${blocked.length} blocked · 0 sent`,
    },
  });
  return { duplicate: false as const, receiptId: receipt.receiptId, ...result };
}

export async function runSalesCampaignFollowups(input: {
  campaignId: string;
  runId: string;
  actorEmployeeId?: string | null;
  now?: Date;
  runAgent?: RunAgent;
}) {
  const settings = await getSalesOsSettings();
  const campaign = settings.campaigns.find(
    (item) => item.id === input.campaignId,
  );
  if (!campaign) throw new Error("CAMPAIGN_NOT_FOUND");
  if (campaign.status !== "running") throw new Error("CAMPAIGN_NOT_RUNNING");
  const payload = {
    campaignId: campaign.id,
    runId: input.runId,
    dealIds: campaign.dealIds,
  };
  const receipt = await recordIntegrationReceipt({
    provider: "hrmny",
    externalEventId: `campaign-followups:${campaign.id}:${input.runId}`,
    operation: "sales.campaign.followups.prepare",
    rawBody: JSON.stringify(payload),
    payload,
    status: "processing",
    result: { bridgeStatus: "preparing_followup_drafts" },
    ownerEmployeeId: input.actorEmployeeId ?? null,
  });
  if (receipt.duplicate && receipt.status === "completed") {
    return {
      duplicate: true as const,
      receiptId: receipt.receiptId,
      ...(receipt.result ?? {}),
    };
  }
  if (receipt.duplicate) throw new Error("CAMPAIGN_RUN_ALREADY_PROCESSING");
  const prepared = await runDueFollowupDrafts({
    now: input.now,
    runAgent: input.runAgent,
    dealIds: campaign.dealIds,
  });
  const result = {
    bridgeStatus: "followup_drafts_ready_for_human_review",
    ...prepared,
    providerSends: 0,
  };
  await completeIntegrationReceipt(receipt.receiptId, result);
  const now = new Date().toISOString();
  await appendCampaignReceipt({
    campaignId: campaign.id,
    receipt: {
      receiptId: receipt.receiptId,
      kind: "followup",
      createdAt: now,
      summary: `${prepared.drafted} follow-up draft${prepared.drafted === 1 ? "" : "s"} prepared · ${prepared.failed} failed · 0 sent`,
    },
  });
  return { duplicate: false as const, receiptId: receipt.receiptId, ...result };
}

process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it } from "vitest";
import { resetCrmMemory } from "../crm/memory";
import {
  insertOutreach,
  listOutreach,
  patchOutreach,
  resetLeadgenStore,
} from "../leadgen/store";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import {
  getSalesOsSettings,
  mutateSalesOsSettings,
  recordEmailEvent,
  resetSalesOsStore,
} from "./store";
import {
  ingestGmailDeliveryEvent,
  ingestGmailReply,
  honorUnsubscribe,
} from "./replies";
import {
  createSalesCampaign,
  listSalesCampaigns,
  runSalesCampaignFirstTouch,
  runSalesCampaignFollowups,
  setSalesCampaignStatus,
} from "./campaigns";
import type { RunAgent } from "../leadgen/agent-run";

const DEAL_ID = "e0000000-0000-4000-8000-000000000001";
const CONTACT_ID = "12000000-0000-4000-8000-000000000001";
const RECIPIENT = "layla.hassan@example-jwmm.ae";

const campaignInput = {
  name: "Synthetic hospitality launch",
  dealIds: [DEAL_ID],
  subjectTemplate: "A focused idea for {{company}}",
  bodyTemplate:
    "Hi {{firstName}}, I noticed the regional work at {{company}}. hrmny has a focused creative angle that could support the next campaign without adding review overhead. Would a short 15-minute conversation next week be useful?",
};

const followupAgent: RunAgent = async (input) => ({
  agent: input.agent,
  model: "test",
  output: {
    channel: "email",
    subject: "ignored",
    body: "Hi Layla — one useful follow-up for JW Marriott Marquis Dubai: hrmny mapped a compact creative direction that can become market-ready assets without adding review overhead. May I share the one-page outline?",
    cta: "May I share the outline?",
  },
  inputTokens: 0,
  outputTokens: 0,
  costAed: 0,
  gateOutcome: "pending",
});

beforeEach(() => {
  resetCrmMemory();
  resetLeadgenStore();
  resetSalesOsStore();
  resetIntegrationReceiptMemory();
});

describe("Sales campaign execution", () => {
  it("serializes concurrent campaign, status, receipt, and cap mutations", async () => {
    const [first, second] = await Promise.all([
      createSalesCampaign({ ...campaignInput, name: "Concurrent one" }),
      createSalesCampaign({ ...campaignInput, name: "Concurrent two" }),
      mutateSalesOsSettings((settings) => {
        const next = {
          ...settings,
          caps: { ...settings.caps, emailPerDay: 31 },
        };
        return { settings: next, result: next };
      }),
    ]);
    await Promise.all([
      setSalesCampaignStatus({ campaignId: first.id, status: "paused" }),
      mutateSalesOsSettings((settings) => {
        const next = {
          ...settings,
          caps: { ...settings.caps, companiesPerResearchRun: 4 },
        };
        return { settings: next, result: next };
      }),
    ]);
    await setSalesCampaignStatus({ campaignId: second.id, status: "running" });
    await Promise.all([
      runSalesCampaignFollowups({
        campaignId: second.id,
        runId: "71000000-0000-4000-8000-000000000011",
      }),
      runSalesCampaignFollowups({
        campaignId: second.id,
        runId: "71000000-0000-4000-8000-000000000012",
      }),
    ]);

    const settings = await getSalesOsSettings();
    expect(settings.campaigns).toHaveLength(2);
    expect(
      settings.campaigns.find((item) => item.id === first.id)?.status,
    ).toBe("paused");
    expect(
      settings.campaigns.find((item) => item.id === second.id)?.receipts,
    ).toHaveLength(2);
    expect(settings.caps).toMatchObject({
      emailPerDay: 31,
      companiesPerResearchRun: 4,
    });
  });

  it("creates one replay-safe first-touch draft and records zero sends", async () => {
    const campaign = await createSalesCampaign(campaignInput);
    const runId = "71000000-0000-4000-8000-000000000001";
    const first = await runSalesCampaignFirstTouch({
      campaignId: campaign.id,
      runId,
    });
    expect(first).toMatchObject({
      drafted: 1,
      existing: 0,
      providerSends: 0,
      duplicate: false,
    });
    const replay = await runSalesCampaignFirstTouch({
      campaignId: campaign.id,
      runId,
    });
    expect(replay).toMatchObject({
      drafted: 1,
      providerSends: 0,
      duplicate: true,
      receiptId: first.receiptId,
    });

    const items = await listOutreach({ dealId: DEAL_ID });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      state: "draft",
      cadenceTouch: 1,
      recipient: RECIPIENT,
    });
    expect(items[0]?.body).toContain("JW Marriott Marquis Dubai");
    const view = (await listSalesCampaigns())[0]!;
    expect(view.progress).toMatchObject({ total: 1, drafted: 1, sent: 0 });
    expect(view.receipts[0]).toMatchObject({
      receiptId: first.receiptId,
      kind: "first_touch",
    });
  });

  it("prepares due follow-ups as drafts and never approves or sends", async () => {
    const campaign = await createSalesCampaign(campaignInput);
    await setSalesCampaignStatus({
      campaignId: campaign.id,
      status: "running",
    });
    const first = await insertOutreach({
      dealId: DEAL_ID,
      channel: "gmail",
      recipient: RECIPIENT,
      contactId: CONTACT_ID,
      subject: "A focused idea",
      body: campaignInput.bodyTemplate
        .replace("{{firstName}}", "Layla")
        .replace("{{company}}", "JW Marriott Marquis Dubai"),
      cadenceTouch: 1,
    });
    await patchOutreach(first.id, {
      state: "sent",
      sentAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
      externalId: "synthetic-provider-message",
    });
    const run = await runSalesCampaignFollowups({
      campaignId: campaign.id,
      runId: "71000000-0000-4000-8000-000000000002",
      runAgent: followupAgent,
    });
    expect(run).toMatchObject({
      considered: 1,
      drafted: 1,
      failed: 0,
      providerSends: 0,
    });
    const items = await listOutreach({ dealId: DEAL_ID });
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id !== first.id)).toMatchObject({
      state: "draft",
      cadenceTouch: 2,
    });
  });

  it.each(["reply", "bounce", "unsubscribe"] as const)(
    "observes %s stop state and does not prepare another follow-up",
    async (stopKind) => {
      const campaign = await createSalesCampaign(campaignInput);
      await setSalesCampaignStatus({
        campaignId: campaign.id,
        status: "running",
      });
      const first = await insertOutreach({
        dealId: DEAL_ID,
        channel: "gmail",
        recipient: RECIPIENT,
        contactId: CONTACT_ID,
        subject: "A focused idea",
        body: "A specific creative campaign idea for JW Marriott Marquis Dubai from hrmny.",
        cadenceTouch: 1,
      });
      await patchOutreach(first.id, {
        state: "sent",
        sentAt: new Date(Date.now() - 6 * 86_400_000).toISOString(),
        externalId: `synthetic-${stopKind}`,
      });
      await recordEmailEvent({
        outreachItemId: first.id,
        contactId: CONTACT_ID,
        kind: "sent",
        externalId: `synthetic-${stopKind}`,
      });
      if (stopKind === "reply") {
        await ingestGmailReply({
          outreachItemId: first.id,
          dealId: DEAL_ID,
          fromEmail: RECIPIENT,
          body: "Thanks, received.",
          externalId: "synthetic-reply",
        });
      } else if (stopKind === "bounce") {
        await ingestGmailDeliveryEvent({
          kind: "bounced",
          recipientEmail: RECIPIENT,
          fromEmail: "mailer-daemon@example.com",
          body: "Delivery failed",
          externalId: "synthetic-bounce",
        });
      } else {
        await honorUnsubscribe({
          dealId: DEAL_ID,
          email: RECIPIENT,
          source: "campaign-test",
        });
      }

      const view = (await listSalesCampaigns())[0]!;
      expect(view.members[0]?.state).toBe(
        stopKind === "reply" ? "replied" : "stopped",
      );
      const followups = await runSalesCampaignFollowups({
        campaignId: campaign.id,
        runId: crypto.randomUUID(),
        runAgent: followupAgent,
      });
      expect(followups).toMatchObject({
        considered: 0,
        drafted: 0,
        providerSends: 0,
      });
      expect(await listOutreach({ dealId: DEAL_ID })).toHaveLength(1);
    },
  );
});

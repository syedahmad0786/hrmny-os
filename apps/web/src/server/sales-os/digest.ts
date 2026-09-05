import { listDeals } from "../crm/repository";
import { listOutreach } from "../leadgen/store";
import {
  hasSyntheticMarker,
  isSyntheticRecordName,
} from "../../lib/synthetic-records";
import {
  getSalesOsSettings,
  listCompanyResearch,
  listContactResearch,
  listEmailEvents,
} from "./store";
import { buildEmailFollowupStatuses } from "./followups";
import { sectorForDate } from "./sops";

export type SalesAttentionItem = {
  id: string;
  kind: "review" | "send" | "followup" | "closing";
  title: string;
  detail: string;
  href: string;
  action: string;
};

export type StallDeal = {
  dealId: string;
  companyName: string;
  stage: string;
  daysInStage: number;
  maxDays: number;
};

export type SalesOsDigest = {
  date: string;
  sectorHint: string;
  attention: SalesAttentionItem[];
  researchedWaiting: number;
  contactsWaiting: number;
  outreachDrafts: number;
  outreachApproved: number;
  stalled: StallDeal[];
  coverage: {
    openValueAed: number;
    targetMonthlyAed: number;
    coverageX: number;
    targetX: number;
    healthy: boolean;
  };
  replyRate: {
    sent: number;
    replied: number;
    rate: number;
  };
  followUps: {
    due: number;
    scheduled: number;
    awaitingReview: number;
  };
};

export async function buildSalesOsDigest(
  now = new Date(),
): Promise<SalesOsDigest> {
  const settings = await getSalesOsSettings();
  const [companies, contacts, outreach, deals, emailEvents] = await Promise.all(
    [
      listCompanyResearch({ state: "researched" }),
      listContactResearch({ state: "found" }),
      listOutreach(),
      listDeals(),
      listEmailEvents(),
    ],
  );
  const companyByDeal = new Map(
    deals.map((deal) => [deal.dealId, deal.companyName]),
  );
  const businessOutreach = outreach.filter(
    (item) =>
      !hasSyntheticMarker(
        companyByDeal.get(item.dealId),
        item.recipient,
        item.subject,
      ),
  );
  const businessOutreachIds = new Set(businessOutreach.map((item) => item.id));
  const businessEmailEvents = emailEvents.filter(
    (event) =>
      !event.outreachItemId || businessOutreachIds.has(event.outreachItemId),
  );
  const drafts = businessOutreach.filter((o) => o.state === "draft");
  const approved = businessOutreach.filter((o) => o.state === "approved");
  const sentEmailIds = new Set(
    businessEmailEvents
      .filter((event) => event.kind === "sent" && event.outreachItemId)
      .map((event) => event.outreachItemId!),
  );
  const repliedEmailIds = new Set(
    businessEmailEvents
      .filter(
        (event) =>
          event.kind === "replied" &&
          event.outreachItemId &&
          sentEmailIds.has(event.outreachItemId),
      )
      .map((event) => event.outreachItemId!),
  );
  const followUps = buildEmailFollowupStatuses({
    outreach: businessOutreach,
    emailEvents: businessEmailEvents,
    cadenceTouches: settings.outreach.cadenceTouches,
    cadenceDays: settings.outreach.cadenceDays,
    now,
  });
  const open = deals.filter(
    (d) => !d.closeOutcome && !isSyntheticRecordName(d.companyName),
  );
  const openValue = open.reduce((sum, d) => sum + Number(d.quoteValue ?? 0), 0);
  const monthlyTarget = settings.targets.h1BookedAed / 6;
  const coverageX = monthlyTarget > 0 ? openValue / monthlyTarget : 0;
  const stalled: StallDeal[] = [];
  for (const d of open) {
    const maxDays = settings.stallDays[d.stage] ?? 14;
    const days = Math.floor(
      (now.getTime() - new Date(d.updatedAt).getTime()) / 86_400_000,
    );
    if (days > maxDays) {
      stalled.push({
        dealId: d.dealId,
        companyName: d.companyName,
        stage: String(d.stage),
        daysInStage: days,
        maxDays,
      });
    }
  }
  const attention: SalesAttentionItem[] = [
    ...followUps
      .filter((item) => item.state === "due")
      .map((item) => ({
        id: `followup-${item.sourceId}`,
        kind: "followup" as const,
        title: companyByDeal.get(item.dealId) ?? item.recipient,
        detail: `${item.recipient} · ${item.reason}`,
        href: `/crm/outreach?view=followups#followup-${item.sourceId}`,
        action: "Prepare follow-up",
      })),
    ...drafts.map((item) => ({
      id: item.id,
      kind: "review" as const,
      title: companyByDeal.get(item.dealId) ?? item.recipient,
      detail: `${item.channel} · ${item.subject ?? item.body.slice(0, 120)}`,
      href: `/crm/outreach?id=${item.id}`,
      action: "Review draft",
    })),
    ...approved.map((item) => ({
      id: item.id,
      kind: "send" as const,
      title: companyByDeal.get(item.dealId) ?? item.recipient,
      detail: `${item.channel} · ${item.subject ?? item.body.slice(0, 120)}`,
      href: `/crm/outreach?id=${item.id}`,
      action: "Review and send",
    })),
    ...companies.map((item) => ({
      id: item.id,
      kind: "review" as const,
      title: item.name,
      detail: `${item.temperature} · ${item.whyThis}`,
      href: `/crm/research#company-${item.id}`,
      action: "Review company",
    })),
    ...contacts.map((item) => ({
      id: item.id,
      kind: "review" as const,
      title: item.fullName,
      detail: `${item.title ?? "Decision-maker"} · ${item.email ?? "Email not verified"}`,
      href: `/crm/research#contact-${item.id}`,
      action: "Qualify contact",
    })),
    ...open
      .filter((item) =>
        ["price_cost", "propose", "close"].includes(String(item.stage)),
      )
      .map((item) => ({
        id: item.dealId,
        kind: "closing" as const,
        title: item.companyName,
        detail: `${String(item.stage).replaceAll("_", " ")} · ${new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED", maximumFractionDigits: 0 }).format(Number(item.quoteValue ?? 0))}`,
        href: `/crm/deals/${item.dealId}`,
        action: "Move deal forward",
      })),
  ];
  return {
    date: now.toISOString().slice(0, 10),
    sectorHint: sectorForDate(settings, now),
    attention,
    researchedWaiting: companies.length,
    contactsWaiting: contacts.length,
    outreachDrafts: drafts.length,
    outreachApproved: approved.length,
    stalled: stalled.sort((a, b) => b.daysInStage - a.daysInStage),
    coverage: {
      openValueAed: openValue,
      targetMonthlyAed: monthlyTarget,
      coverageX,
      targetX: settings.targets.pipelineCoverageX,
      healthy: coverageX >= settings.targets.pipelineCoverageX,
    },
    replyRate: {
      sent: sentEmailIds.size,
      replied: repliedEmailIds.size,
      rate: sentEmailIds.size ? repliedEmailIds.size / sentEmailIds.size : 0,
    },
    followUps: {
      due: followUps.filter((item) => item.state === "due").length,
      scheduled: followUps.filter((item) => item.state === "waiting").length,
      awaitingReview: followUps.filter((item) => item.state === "queued")
        .length,
    },
  };
}

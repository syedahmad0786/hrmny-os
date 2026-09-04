import { listDeals } from "../crm/repository";
import { listOutreach } from "../leadgen/store";
import {
  getSalesOsSettings,
  listCompanyResearch,
  listContactResearch,
  listEmailEvents,
} from "./store";

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
  const drafts = outreach.filter((o) => o.state === "draft");
  const approved = outreach.filter((o) => o.state === "approved");
  const sentEmailIds = new Set(
    emailEvents
      .filter((event) => event.kind === "sent" && event.outreachItemId)
      .map((event) => event.outreachItemId!),
  );
  const repliedEmailIds = new Set(
    emailEvents
      .filter(
        (event) =>
          event.kind === "replied" &&
          event.outreachItemId &&
          sentEmailIds.has(event.outreachItemId),
      )
      .map((event) => event.outreachItemId!),
  );
  const open = deals.filter((d) => !d.closeOutcome);
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
  return {
    date: now.toISOString().slice(0, 10),
    sectorHint:
      settings.sectorRotation[
        (
          [
            "sunday",
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
          ] as const
        )[now.getUTCDay()]!
      ],
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
  };
}

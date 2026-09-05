import { employee } from "@hrmny/db";
import { listCompanies, listDeals, listNotes } from "../crm/repository";
import { getDb } from "../db";
import { listOutreach, type OutreachItem } from "../leadgen/store";
import { listCompanyResearch, listEmailEvents } from "./store";
import type { CompanyResearchRow, EmailEventRow } from "./types";
import type { CompanyRow, CrmNoteRow, DealRow } from "../crm/types";
import {
  hasSyntheticMarker,
  isSyntheticDeal,
} from "../../lib/synthetic-records";

export type SalesFunnelFilters = {
  market?: string;
  owner?: string;
  channel?: string;
  campaign?: string;
  dateFrom?: string;
  dateTo?: string;
};

export function buildSalesFunnel(input: {
  deals: DealRow[];
  companies: CompanyRow[];
  notes: CrmNoteRow[];
  research: CompanyResearchRow[];
  outreach: OutreachItem[];
  emailEvents: EmailEventRow[];
  ownerNames?: Map<string, string>;
  filters?: SalesFunnelFilters;
}) {
  const companyById = new Map(
    input.companies.map((row) => [row.companyId, row]),
  );
  const businessDeals = input.deals.filter((deal) => !isSyntheticDeal(deal));
  const businessDealById = new Map(
    businessDeals.map((deal) => [deal.dealId, deal]),
  );
  const businessOutreach = input.outreach.filter(
    (item) =>
      businessDealById.has(item.dealId) &&
      !hasSyntheticMarker(
        businessDealById.get(item.dealId)?.companyName,
        item.recipient,
        item.subject,
      ),
  );
  const outreachByDeal = new Map<string, OutreachItem[]>();
  for (const item of businessOutreach) {
    outreachByDeal.set(item.dealId, [
      ...(outreachByDeal.get(item.dealId) ?? []),
      item,
    ]);
  }
  const filters = input.filters ?? {};
  const from = filters.dateFrom
    ? Date.parse(`${filters.dateFrom}T00:00:00Z`)
    : null;
  const to = filters.dateTo
    ? Date.parse(`${filters.dateTo}T23:59:59.999Z`)
    : null;
  const deals = businessDeals.filter((deal) => {
    const created = Date.parse(deal.createdAt);
    const channels = (outreachByDeal.get(deal.dealId) ?? []).map((item) =>
      item.channel === "email" ? "gmail" : item.channel,
    );
    return (
      (!filters.market ||
        companyById.get(deal.companyId ?? "")?.market === filters.market) &&
      (!filters.owner ||
        (deal.ownerEmployeeId ?? "unassigned") === filters.owner) &&
      (!filters.channel || channels.includes(filters.channel)) &&
      (!filters.campaign || deal.leadSourceLane === filters.campaign) &&
      (from === null || created >= from) &&
      (to === null || created <= to)
    );
  });
  const dealIds = new Set(deals.map((deal) => deal.dealId));
  const filteredOutreach = businessOutreach.filter((item) =>
    dealIds.has(item.dealId),
  );
  const outreachById = new Map(filteredOutreach.map((item) => [item.id, item]));
  const events = input.emailEvents.filter(
    (event) => event.outreachItemId && outreachById.has(event.outreachItemId),
  );
  const researchedCompanies = new Set(
    input.research.map((row) => row.companyId).filter(Boolean),
  );
  const briefDeals = new Set(
    input.notes
      .filter((note) => note.body.startsWith("SALES KNOWLEDGE BRIEF —"))
      .map((note) => note.dealId)
      .filter(Boolean),
  );
  const withResearch = new Set(
    deals
      .filter(
        (deal) =>
          briefDeals.has(deal.dealId) ||
          (deal.companyId && researchedCompanies.has(deal.companyId)),
      )
      .map((deal) => deal.dealId),
  );
  const withDraft = new Set(
    filteredOutreach
      .filter((item) => withResearch.has(item.dealId))
      .map((item) => item.dealId),
  );
  const withApproval = new Set(
    filteredOutreach
      .filter(
        (item) =>
          withDraft.has(item.dealId) &&
          ["approved", "sent"].includes(item.state),
      )
      .map((item) => item.dealId),
  );
  const acceptedOutreachIds = new Set(
    events
      .filter(
        (event) =>
          event.kind === "sent" && event.payload.providerAccepted === true,
      )
      .map((event) => event.outreachItemId),
  );
  const withProviderAcceptance = new Set(
    filteredOutreach
      .filter(
        (item) =>
          withApproval.has(item.dealId) &&
          (acceptedOutreachIds.has(item.id) ||
            (item.channel.startsWith("linkedin") && item.state === "sent")),
      )
      .map((item) => item.dealId),
  );
  const repliedOutreachIds = new Set(
    events
      .filter((event) => event.kind === "replied")
      .map((event) => event.outreachItemId),
  );
  const withReply = new Set(
    filteredOutreach
      .filter(
        (item) =>
          withProviderAcceptance.has(item.dealId) &&
          repliedOutreachIds.has(item.id),
      )
      .map((item) => item.dealId),
  );
  const won = new Set(
    deals
      .filter(
        (deal) => withReply.has(deal.dealId) && deal.closeOutcome === "won",
      )
      .map((deal) => deal.dealId),
  );
  const total = deals.length;
  const step = (key: string, label: string, count: number) => ({
    key,
    label,
    count,
    percentOfLeads: total ? Math.round((count / total) * 100) : 0,
  });

  const allChannels = new Set(
    businessOutreach.map((item) =>
      item.channel === "email" ? "gmail" : item.channel,
    ),
  );
  const owners = new Map<string, string>();
  for (const deal of businessDeals) {
    const id = deal.ownerEmployeeId ?? "unassigned";
    owners.set(
      id,
      id === "unassigned"
        ? "Unassigned"
        : (input.ownerNames?.get(id) ?? `Owner ${id.slice(0, 8)}`),
    );
  }
  return {
    total,
    steps: [
      step("leads", "Leads", total),
      step("researched", "Research ready", withResearch.size),
      step("drafted", "Draft created", withDraft.size),
      step("approved", "Human approved", withApproval.size),
      step(
        "provider_accepted",
        "Sent / provider accepted",
        withProviderAcceptance.size,
      ),
      step("replied", "Reply received", withReply.size),
      step("won", "Won", won.size),
    ],
    evidence: {
      providerAccepted: acceptedOutreachIds.size,
      bounced: events.filter((event) => event.kind === "bounced").length,
      complained: events.filter((event) => event.kind === "complained").length,
      replied: events.filter((event) => event.kind === "replied").length,
    },
    options: {
      markets: [
        ...new Set(
          businessDeals
            .map((deal) => companyById.get(deal.companyId ?? "")?.market)
            .filter((value): value is NonNullable<typeof value> =>
              Boolean(value),
            ),
        ),
      ].sort(),
      owners: [...owners]
        .map(([value, label]) => ({ value, label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      channels: [...allChannels].sort(),
      campaigns: [
        ...new Set(businessDeals.map((deal) => deal.leadSourceLane)),
      ].sort(),
    },
    filters,
  };
}

export async function getSalesFunnel(filters?: SalesFunnelFilters) {
  const [deals, companies, notes, research, outreach, emailEvents] =
    await Promise.all([
      listDeals(),
      listCompanies(),
      listNotes(),
      listCompanyResearch(),
      listOutreach(),
      listEmailEvents(),
    ]);
  const db = getDb();
  const ownerNames = new Map<string, string>();
  if (db) {
    for (const row of await db
      .select({ id: employee.employeeId, name: employee.displayName })
      .from(employee)) {
      ownerNames.set(row.id, row.name);
    }
  }
  return buildSalesFunnel({
    deals,
    companies,
    notes,
    research,
    outreach,
    emailEvents,
    ownerNames,
    filters,
  });
}

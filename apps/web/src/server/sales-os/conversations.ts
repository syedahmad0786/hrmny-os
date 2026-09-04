import { listCompanies, listContacts, listDeals } from "../crm/repository";
import { listOutreach, type OutreachItem } from "../leadgen/store";
import { listEmailEvents } from "./store";
import type { EmailEventRow } from "./types";

export type SalesConversationMessage = {
  id: string;
  direction: "inbound" | "outbound";
  status: EmailEventRow["kind"];
  from: string | null;
  to: string | null;
  subject: string | null;
  body: string;
  occurredAt: string;
};

export type SalesConversation = {
  id: string;
  threadId: string | null;
  dealId: string | null;
  contactId: string | null;
  outreachItemId: string | null;
  companyName: string;
  contactName: string;
  contactEmail: string | null;
  subject: string | null;
  lastMessageAt: string;
  latestInboundBody: string;
  latestInboundAt: string;
  replyDraftId: string | null;
  messages: SalesConversationMessage[];
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

function eventThreadId(event: EmailEventRow): string | null {
  return text(event.payload.threadId);
}

function messageBody(event: EmailEventRow, outreach?: OutreachItem): string {
  return text(event.payload.body) ?? outreach?.body ?? "";
}

/**
 * Read model for the Sales inbox. Gmail remains the source of delivery/reply
 * evidence; this function joins those immutable events to CRM records without
 * introducing a second conversation store that can drift from the provider.
 */
export async function listSalesConversations(): Promise<SalesConversation[]> {
  const [events, outreach, deals, contacts, companies] = await Promise.all([
    listEmailEvents(),
    listOutreach(),
    listDeals(),
    listContacts(),
    listCompanies(),
  ]);
  const gmailEvents = events.filter((event) => event.provider === "gmail");
  const outreachById = new Map(outreach.map((item) => [item.id, item]));
  const dealById = new Map(deals.map((deal) => [deal.dealId, deal]));
  const contactById = new Map(
    contacts.map((contact) => [contact.contactId, contact]),
  );
  const companyById = new Map(
    companies.map((company) => [company.companyId, company]),
  );

  const threadByOutreach = new Map<string, string>();
  for (const event of gmailEvents) {
    const threadId = eventThreadId(event);
    if (event.outreachItemId && threadId) {
      threadByOutreach.set(event.outreachItemId, threadId);
    }
  }

  const grouped = new Map<string, EmailEventRow[]>();
  for (const event of gmailEvents) {
    const threadId =
      eventThreadId(event) ??
      (event.outreachItemId
        ? threadByOutreach.get(event.outreachItemId)
        : null);
    const key = threadId
      ? `thread:${threadId}`
      : event.outreachItemId
        ? `outreach:${event.outreachItemId}`
        : `event:${event.id}`;
    const bucket = grouped.get(key) ?? [];
    bucket.push(event);
    grouped.set(key, bucket);
  }

  const conversations: SalesConversation[] = [];
  for (const [id, bucket] of grouped) {
    const ordered = [...bucket].sort((a, b) =>
      a.occurredAt.localeCompare(b.occurredAt),
    );
    const inbound = ordered.filter((event) => event.kind === "replied");
    if (!inbound.length) continue;

    const lastInbound = inbound[inbound.length - 1]!;
    const linkedOutreach =
      [...ordered]
        .reverse()
        .map((event) =>
          event.outreachItemId
            ? outreachById.get(event.outreachItemId)
            : undefined,
        )
        .find(Boolean) ?? undefined;
    const dealId =
      text(lastInbound.payload.dealId) ?? linkedOutreach?.dealId ?? null;
    const deal = dealId ? dealById.get(dealId) : undefined;
    const contactId =
      lastInbound.contactId ??
      linkedOutreach?.contactId ??
      deal?.primaryContactId ??
      null;
    const contact = contactId ? contactById.get(contactId) : undefined;
    const company = deal?.companyId
      ? companyById.get(deal.companyId)
      : undefined;
    const inboundFrom = text(lastInbound.payload.from);
    const subject =
      text(lastInbound.payload.subject) ?? linkedOutreach?.subject ?? null;
    const latestInboundBody = messageBody(lastInbound, linkedOutreach);
    const activeDraft = outreach.find(
      (item) =>
        item.dealId === dealId &&
        item.state === "draft" &&
        item.createdAt >= lastInbound.occurredAt &&
        (!subject ||
          !item.subject ||
          item.subject.replace(/^\s*re\s*:\s*/i, "").toLowerCase() ===
            subject.replace(/^\s*re\s*:\s*/i, "").toLowerCase()) &&
        item.recipient.trim().toLowerCase() ===
          (inboundFrom ?? contact?.email ?? "").trim().toLowerCase(),
    );

    conversations.push({
      id,
      threadId: eventThreadId(lastInbound),
      dealId,
      contactId,
      outreachItemId: linkedOutreach?.id ?? null,
      companyName: deal?.companyName ?? company?.name ?? "Unmatched reply",
      contactName: contact
        ? [contact.firstName, contact.lastName].filter(Boolean).join(" ")
        : (inboundFrom ?? "Unknown sender"),
      contactEmail: inboundFrom ?? contact?.email ?? null,
      subject,
      lastMessageAt: ordered[ordered.length - 1]!.occurredAt,
      latestInboundBody,
      latestInboundAt: lastInbound.occurredAt,
      replyDraftId: activeDraft?.id ?? null,
      messages: ordered.map((event) => {
        const item = event.outreachItemId
          ? outreachById.get(event.outreachItemId)
          : undefined;
        const direction = event.kind === "replied" ? "inbound" : "outbound";
        return {
          id: event.id,
          direction,
          status: event.kind,
          from:
            direction === "inbound"
              ? text(event.payload.from)
              : text(event.payload.senderEmail),
          to:
            direction === "inbound"
              ? text(event.payload.recipient)
              : (item?.recipient ?? null),
          subject: text(event.payload.subject) ?? item?.subject ?? null,
          body: messageBody(event, item),
          occurredAt: event.occurredAt,
        };
      }),
    });
  }

  return conversations.sort((a, b) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt),
  );
}

export async function getSalesConversation(
  id: string,
): Promise<SalesConversation | null> {
  return (
    (await listSalesConversations()).find((item) => item.id === id) ?? null
  );
}

import type { ReplyIntent } from "@hrmny/ai";
import { getContact, getDeal, updateDeal } from "../crm/repository";
import { applyReplyIntent } from "../leadgen/reply-intent";
import { getOutreach, listOutreach, patchOutreach } from "../leadgen/store";
import { domainOf, isEmailChannel, suppressTarget } from "./compliance";
import { listEmailEvents, recordEmailEvent } from "./store";

export type GmailDeliveryNoticeKind = "bounced" | "complained";

/** Fail closed: only explicit provider labels or recognizable system notices. */
export function classifyGmailDeliveryNotice(input: {
  from: string;
  subject?: string;
  body: string;
  eventType?: string;
}): GmailDeliveryNoticeKind | null {
  const eventType = input.eventType
    ?.trim()
    .toLowerCase()
    .replace(/[ -]+/g, "_");
  if (
    [
      "bounce",
      "bounced",
      "hard_bounce",
      "soft_bounce",
      "delivery_failed",
    ].includes(eventType ?? "")
  ) {
    return "bounced";
  }
  if (
    ["complaint", "complained", "spam_complaint", "feedback_loop"].includes(
      eventType ?? "",
    )
  ) {
    return "complained";
  }
  const from = input.from.toLowerCase();
  const notice = `${input.subject ?? ""}\n${input.body}`.toLowerCase();
  if (
    /(?:mailer-daemon|postmaster)@/.test(from) &&
    /(?:delivery status notification \(failure\)|address not found|message (?:was not|wasn't|could not be) delivered|recipient address rejected|permanent (?:error|failure)|\b550[ -]5\.1\.1\b|undeliverable)/.test(
      notice,
    )
  ) {
    return "bounced";
  }
  if (
    /(?:feedbackloop|abuse)@/.test(from) &&
    /(?:feedback loop|abuse report|spam complaint|reported as spam)/.test(
      notice,
    )
  ) {
    return "complained";
  }
  return null;
}

function recipientFromDeliveryNotice(body: string): string | null {
  const match = body.match(
    /(?:Final-Recipient|Original-Recipient):\s*(?:rfc822;\s*)?([^\s<>;,]+@[^\s<>;,]+)/i,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

export async function ingestGmailDeliveryEvent(input: {
  kind: GmailDeliveryNoticeKind;
  externalId?: string;
  threadId?: string;
  recipientEmail?: string;
  fromEmail: string;
  subject?: string;
  body: string;
  actorEmployeeId?: string | null;
}) {
  const events = await listEmailEvents();
  const duplicate = input.externalId
    ? events.find(
        (event) =>
          event.provider === "gmail" &&
          event.kind === input.kind &&
          event.externalId === input.externalId,
      )
    : null;
  if (duplicate) return { applied: false as const, duplicate: true as const };

  const sentEvents = events.filter((event) => event.kind === "sent");
  const owned = (event: (typeof sentEvents)[number]) =>
    !input.actorEmployeeId ||
    event.payload.ownerEmployeeId === input.actorEmployeeId;
  const threadEvent = input.threadId
    ? sentEvents.find(
        (event) => event.payload.threadId === input.threadId && owned(event),
      )
    : null;
  const recipient =
    input.recipientEmail?.trim().toLowerCase() ||
    recipientFromDeliveryNotice(input.body);
  const candidates = recipient
    ? (await listOutreach())
        .filter(
          (item) =>
            item.state === "sent" &&
            isEmailChannel(item.channel) &&
            item.recipient.trim().toLowerCase() === recipient,
        )
        .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    : [];
  const item =
    (threadEvent?.outreachItemId
      ? await getOutreach(threadEvent.outreachItemId)
      : null) ??
    candidates.find((candidate) =>
      sentEvents.some(
        (event) => event.outreachItemId === candidate.id && owned(event),
      ),
    ) ??
    null;
  const ownerEvent = item
    ? sentEvents.find((event) => event.outreachItemId === item.id)
    : null;
  if (
    item &&
    input.actorEmployeeId &&
    ownerEvent?.payload.ownerEmployeeId !== input.actorEmployeeId
  ) {
    throw new Error(
      "Gmail delivery notice owner does not match the outreach sender",
    );
  }

  await recordEmailEvent({
    outreachItemId: item?.id ?? null,
    contactId: item?.contactId ?? null,
    kind: input.kind,
    provider: "gmail",
    externalId: input.externalId ?? null,
    payload: {
      from: input.fromEmail,
      subject: input.subject?.slice(0, 500),
      body: input.body.slice(0, 2_000),
      recipient: recipient ?? item?.recipient ?? null,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.actorEmployeeId
        ? { ownerEmployeeId: input.actorEmployeeId }
        : {}),
    },
  });
  if (!item) return { applied: false as const, duplicate: false as const };

  const suppressionReason = input.kind === "bounced" ? "bounce" : "complaint";
  await suppressTarget({
    email: item.recipient,
    reason: suppressionReason,
    source: "gmail-delivery-notice",
  });
  const pending = (await listOutreach({ dealId: item.dealId })).filter(
    (candidate) =>
      ["draft", "approved"].includes(candidate.state) &&
      candidate.recipient.trim().toLowerCase() ===
        item.recipient.trim().toLowerCase(),
  );
  for (const candidate of pending) {
    await patchOutreach(candidate.id, {
      state: "discarded",
      reworkFeedback: `${input.kind} recorded; follow-up stopped`,
    });
  }
  await patchOutreach(item.id, {
    reworkFeedback: `${input.kind} recorded; recipient suppressed`,
  });
  return {
    applied: true as const,
    duplicate: false as const,
    outreachItemId: item.id,
    discardedFollowups: pending.length,
  };
}

export async function honorUnsubscribe(input: {
  dealId?: string | null;
  email?: string | null;
  source?: string;
}): Promise<{ suppressed: boolean; dealClosed: boolean }> {
  let email = input.email ?? null;
  if (!email && input.dealId) {
    const deal = await getDeal(input.dealId);
    if (deal?.primaryContactId) {
      email = (await getContact(deal.primaryContactId))?.email ?? null;
    }
  }
  if (email) {
    await suppressTarget({
      email,
      domain: domainOf(email),
      reason: "unsubscribe",
      source: input.source ?? "reply-intent",
    });
  }
  let dealClosed = false;
  if (input.dealId) {
    const deal = await getDeal(input.dealId);
    if (deal) {
      await updateDeal(input.dealId, {
        closeOutcome: "lost",
        lostReason: "unsubscribe",
      });
      dealClosed = true;
      const pending = (await listOutreach({ dealId: input.dealId })).filter(
        (o) => o.state === "draft" || o.state === "approved",
      );
      for (const item of pending) {
        await patchOutreach(item.id, { state: "discarded" });
      }
    }
  }
  return { suppressed: Boolean(email), dealClosed };
}

export async function applySalesOsReplyIntent(input: {
  dealId: string;
  intent: ReplyIntent;
  actorEmployeeId?: string | null;
  email?: string | null;
}) {
  if (input.intent === "unsubscribe") {
    const email =
      input.email ??
      (await (async () => {
        const deal = await getDeal(input.dealId);
        if (!deal?.primaryContactId) return null;
        return (await getContact(deal.primaryContactId))?.email ?? null;
      })());
    const honored = await honorUnsubscribe({
      dealId: input.dealId,
      email,
      source: "reply-intent",
    });
    return {
      intent: input.intent,
      toStage: null,
      moved: false,
      suppressed: honored.suppressed,
      dealClosed: honored.dealClosed,
    };
  }
  const moved = await applyReplyIntent({
    dealId: input.dealId,
    intent: input.intent,
    actorEmployeeId: input.actorEmployeeId,
  });
  return { ...moved, suppressed: false, dealClosed: false };
}

export async function ingestGmailReply(input: {
  outreachItemId?: string;
  dealId?: string;
  fromEmail: string;
  body: string;
  externalId?: string;
  threadId?: string;
  actorEmployeeId?: string | null;
}) {
  const events = await listEmailEvents();
  const duplicate = input.externalId
    ? events.find(
        (event) =>
          event.provider === "gmail" &&
          event.kind === "replied" &&
          event.externalId === input.externalId,
      )
    : null;
  if (duplicate) {
    return {
      intent: (duplicate.payload.intent ?? "other") as ReplyIntent,
      applied: false as const,
      duplicate: true as const,
    };
  }

  const sentEvents = events.filter((event) => event.kind === "sent");
  const owned = (event: (typeof sentEvents)[number]) =>
    !input.actorEmployeeId ||
    event.payload.ownerEmployeeId === input.actorEmployeeId;
  const threadEvent = input.threadId
    ? sentEvents.find(
        (event) => event.payload.threadId === input.threadId && owned(event),
      )
    : null;
  const explicitItem = input.outreachItemId
    ? await getOutreach(input.outreachItemId)
    : null;
  const candidates = (await listOutreach()).filter(
    (item) =>
      isEmailChannel(item.channel) &&
      item.state === "sent" &&
      item.recipient.toLowerCase() === input.fromEmail.toLowerCase(),
  );
  const item =
    explicitItem ??
    (threadEvent?.outreachItemId
      ? await getOutreach(threadEvent.outreachItemId)
      : null) ??
    candidates.find((candidate) =>
      sentEvents.some(
        (event) => event.outreachItemId === candidate.id && owned(event),
      ),
    ) ??
    null;
  const ownerEvent = item
    ? sentEvents.find((event) => event.outreachItemId === item.id)
    : null;
  if (
    item &&
    input.actorEmployeeId &&
    ownerEvent?.payload.ownerEmployeeId !== input.actorEmployeeId
  ) {
    throw new Error("Gmail reply owner does not match the outreach sender");
  }

  const itemId = item?.id ?? null;
  const dealId = input.dealId ?? item?.dealId ?? null;
  const classified = heuristicIntent(input.body);
  await recordEmailEvent({
    outreachItemId: itemId,
    contactId: item?.contactId,
    kind: "replied",
    provider: "gmail",
    externalId: input.externalId ?? null,
    payload: {
      from: input.fromEmail,
      body: input.body.slice(0, 2000),
      intent: classified,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      ...(input.actorEmployeeId
        ? { ownerEmployeeId: input.actorEmployeeId }
        : {}),
    },
  });
  if (!dealId) {
    return {
      intent: classified,
      applied: false as const,
      duplicate: false as const,
    };
  }
  const applied = await applySalesOsReplyIntent({
    dealId,
    intent: classified,
    actorEmployeeId: input.actorEmployeeId,
    email: input.fromEmail,
  });
  return {
    ...applied,
    intent: classified,
    applied: true as const,
    duplicate: false as const,
  };
}

export function heuristicIntent(body: string): ReplyIntent {
  const t = body.toLowerCase();
  if (/unsub|opt.?out|remove me|stop emailing/.test(t)) return "unsubscribe";
  if (/interested|let.?s (talk|meet)|schedule|book a/.test(t))
    return "interested";
  if (/\?/.test(t)) return "question";
  if (/not now|later|next quarter|circle back/.test(t)) return "not_now";
  return "other";
}

/** Poll is a no-op without a Workspace token; callers pass messages. */
export async function watchGmailReplies(
  messages: {
    fromEmail: string;
    body: string;
    externalId?: string;
    dealId?: string;
  }[],
): Promise<number> {
  let n = 0;
  for (const msg of messages) {
    await ingestGmailReply(msg);
    n += 1;
  }
  return n;
}

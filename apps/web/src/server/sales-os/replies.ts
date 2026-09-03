import type { ReplyIntent } from "@hrmny/ai";
import { getContact, getDeal, updateDeal } from "../crm/repository";
import { applyReplyIntent } from "../leadgen/reply-intent";
import { getOutreach, listOutreach, patchOutreach } from "../leadgen/store";
import { domainOf, isEmailChannel, suppressTarget } from "./compliance";
import { listEmailEvents, recordEmailEvent } from "./store";

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

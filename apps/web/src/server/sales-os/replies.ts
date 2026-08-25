import { mockReplyIntent, type ReplyIntent } from "@hrmny/ai";
import { getContact, getDeal, updateDeal } from "../crm/repository";
import { applyReplyIntent } from "../leadgen/reply-intent";
import { listOutreach, patchOutreach } from "../leadgen/store";
import { domainOf, isEmailChannel, suppressTarget } from "./compliance";
import { recordEmailEvent } from "./store";

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
  actorEmployeeId?: string | null;
}) {
  const items = input.outreachItemId
    ? []
    : (await listOutreach()).filter(
        (o) =>
          isEmailChannel(o.channel) &&
          o.state === "sent" &&
          o.recipient.toLowerCase() === input.fromEmail.toLowerCase(),
      );
  const itemId = input.outreachItemId ?? items[0]?.id ?? null;
  const dealId = input.dealId ?? items[0]?.dealId ?? null;
  await recordEmailEvent({
    outreachItemId: itemId,
    kind: "replied",
    provider: "gmail",
    externalId: input.externalId ?? null,
    payload: { from: input.fromEmail, body: input.body.slice(0, 2000) },
  });
  const classified = (mockReplyIntent(input.body).intent ??
    heuristicIntent(input.body)) as ReplyIntent;
  if (!dealId) {
    return { intent: classified, applied: false as const };
  }
  const applied = await applySalesOsReplyIntent({
    dealId,
    intent: classified,
    actorEmployeeId: input.actorEmployeeId,
    email: input.fromEmail,
  });
  return { intent: classified, applied: true as const, ...applied };
}

function heuristicIntent(body: string): ReplyIntent {
  const t = body.toLowerCase();
  if (/unsub|opt.?out|remove me|stop emailing/.test(t)) return "unsubscribe";
  if (/interested|let.?s (talk|meet)|schedule|book a/.test(t)) return "interested";
  if (/\?/.test(t)) return "question";
  if (/not now|later|next quarter|circle back/.test(t)) return "not_now";
  return "other";
}

/** Poll is a no-op without a Workspace token; callers pass messages. */
export async function watchGmailReplies(messages: {
  fromEmail: string;
  body: string;
  externalId?: string;
  dealId?: string;
}[]): Promise<number> {
  let n = 0;
  for (const msg of messages) {
    await ingestGmailReply(msg);
    n += 1;
  }
  return n;
}

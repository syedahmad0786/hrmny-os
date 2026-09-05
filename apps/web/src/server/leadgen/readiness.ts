import { getContact, getDeal } from "../crm/repository";
import { getDb } from "../db";
import { isSyntheticDeal } from "../../lib/synthetic-records";
import {
  assertEmailSendAllowed,
  hasValidUnsubscribeLink,
  isEmailChannel,
} from "../sales-os/compliance";
import { listOutreach, type OutreachItem } from "./store";

/** The same read-only decision is shown before review and checked again at dispatch. */
export async function outreachReadiness(
  item: OutreachItem,
  siblings?: OutreachItem[],
): Promise<{ ready: boolean; reason: string | null }> {
  if (item.state === "sent" || item.state === "discarded")
    return { ready: false, reason: "This message is no longer pending." };
  if (!isEmailChannel(item.channel)) return { ready: true, reason: null };
  if (/^test$/i.test(item.subject?.trim() ?? ""))
    return {
      ready: false,
      reason:
        "Replace the test subject with the message you want the recipient to see.",
    };
  const [contact, deal, all] = await Promise.all([
    item.contactId ? getContact(item.contactId) : null,
    getDeal(item.dealId),
    siblings ?? listOutreach(),
  ]);
  if (getDb() && deal && isSyntheticDeal(deal))
    return {
      ready: false,
      reason:
        "This is a retained test record. Use the test environment for outreach.",
    };
  const recipient = item.recipient.trim().toLowerCase();
  if (item.cadenceTouch === 1) {
    const firstTouches = all
      .filter(
        (other) =>
          other.state !== "discarded" &&
          isEmailChannel(other.channel) &&
          other.cadenceTouch === 1 &&
          other.recipient.trim().toLowerCase() === recipient &&
          !/^test$/i.test(other.subject?.trim() ?? ""),
      )
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      );
    const alreadySent = firstTouches.find(
      (other) => other.state === "sent" && other.id !== item.id,
    );
    if (alreadySent || (firstTouches[0] && firstTouches[0].id !== item.id))
      return {
        ready: false,
        reason: alreadySent
          ? "A first email has already been sent to this person. Continue the conversation or prepare a follow-up."
          : "Another first email is already waiting for this person. Review or discard that draft first.",
      };
  }
  const check = await assertEmailSendAllowed({
    email: item.recipient,
    emailVerified: Boolean(
      contact?.emailVerified &&
      contact.email?.trim().toLowerCase() === recipient,
    ),
    body: item.body,
    companyName: deal?.companyName,
  });
  if (!check.ok) return { ready: false, reason: check.reason };
  if (!hasValidUnsubscribeLink(item.body, item.recipient))
    return {
      ready: false,
      reason:
        "This draft needs a fresh unsubscribe link. Rework it and review the updated message.",
    };
  return { ready: true, reason: null };
}

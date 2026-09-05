import { and, connectionAccount, eq } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { listOutreachEmailBindings } from "../integrations/inbox";
import { listEmailEvents } from "../sales-os/store";
import { listOutreach, type OutreachItem } from "./store";

const isEmail = (item: OutreachItem) =>
  ["gmail", "email"].includes(item.channel.toLowerCase());
const sequence = (item: OutreachItem) =>
  `${item.dealId}:${item.recipient.trim().toLowerCase()}`;

/** Staff roles and organizational provider approval never grant mailbox access. */
export async function visibleSalesEmailData(employeeId: string | null) {
  const [outreach, events, bindings] = await Promise.all([
    listOutreach(),
    listEmailEvents(),
    listOutreachEmailBindings(),
  ]);
  const db = getDb();
  const mailboxes =
    db && employeeId
      ? await db
          .select({ id: connectionAccount.connectionAccountId })
          .from(connectionAccount)
          .where(
            and(
              eq(connectionAccount.ownerEmployeeId, employeeId),
              eq(connectionAccount.scope, "staff"),
            ),
          )
      : [];
  const mailboxIds = new Set(mailboxes.map((row) => row.id));
  const owns = (owner: unknown, mailbox: unknown) =>
    Boolean(
      employeeId &&
      (owner === employeeId ||
        (typeof mailbox === "string" && mailboxIds.has(mailbox))),
    );
  const privateIds = new Set<string>();
  const ownedIds = new Set<string>();
  for (const event of events) {
    if (!event.outreachItemId) continue;
    privateIds.add(event.outreachItemId);
    if (
      owns(
        event.payload.ownerEmployeeId,
        event.payload.senderConnectionAccountId,
      )
    ) {
      ownedIds.add(event.outreachItemId);
    }
  }
  for (const binding of bindings) {
    privateIds.add(binding.outreachItemId);
    if (owns(binding.ownerEmployeeId, binding.connectionAccountId)) {
      ownedIds.add(binding.outreachItemId);
    }
  }
  const ownsSequence = new Map<string, boolean>();
  for (const item of outreach) {
    if (!isEmail(item) || item.state !== "sent") continue;
    privateIds.add(item.id); // Legacy mail without proven ownership stays private.
    const key = sequence(item);
    ownsSequence.set(
      key,
      (ownsSequence.get(key) ?? true) && ownedIds.has(item.id),
    );
  }
  return {
    outreach: outreach.filter((item) => {
      if (!isEmail(item)) return true;
      if (privateIds.has(item.id)) return ownedIds.has(item.id);
      // A follow-up can contain the previous private message, even before sending.
      if (item.cadenceTouch > 1) {
        return ownsSequence.get(sequence(item)) === true;
      }
      return true; // Unsent, unbound first-touch proposals remain in the review queue.
    }),
    emailEvents: events.filter((event) =>
      owns(
        event.payload.ownerEmployeeId,
        event.payload.senderConnectionAccountId,
      ),
    ),
  };
}

export async function visibleOutreach(id: string, employeeId: string | null) {
  return (
    (await visibleSalesEmailData(employeeId)).outreach.find(
      (item) => item.id === id,
    ) ?? null
  );
}

export async function requireVisibleOutreach(
  id: string,
  employeeId: string | null,
) {
  const item = await visibleOutreach(id, employeeId);
  if (!item)
    throw new TRPCError({ code: "NOT_FOUND", message: "Outreach not found" });
  return item;
}

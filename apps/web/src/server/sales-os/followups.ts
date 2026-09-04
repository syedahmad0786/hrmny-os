import type { OutreachItem } from "../leadgen/store";
import type { EmailEventRow } from "./types";

export type EmailFollowupStatus = {
  sourceId: string;
  queuedItemId: string | null;
  dealId: string;
  recipient: string;
  currentTouch: number;
  nextTouch: number | null;
  dueAt: string | null;
  state: "due" | "waiting" | "queued" | "replied" | "stopped" | "complete";
  reason: string;
};

const DAY_MS = 86_400_000;

/** One reply-aware cadence status per deal/contact email sequence. */
export function buildEmailFollowupStatuses(input: {
  outreach: OutreachItem[];
  emailEvents: EmailEventRow[];
  cadenceTouches: number;
  cadenceDays: number;
  now?: Date;
}): EmailFollowupStatus[] {
  const groups = new Map<string, OutreachItem[]>();
  for (const item of input.outreach) {
    if (
      item.state === "discarded" ||
      !["gmail", "email"].includes(item.channel.toLowerCase())
    ) {
      continue;
    }
    const identity = item.contactId ?? item.recipient.trim().toLowerCase();
    const key = `${item.dealId}\u0000${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  const now = input.now ?? new Date();
  const spacingDays = Math.max(
    1,
    Math.ceil(input.cadenceDays / Math.max(1, input.cadenceTouches - 1)),
  );
  const statuses: EmailFollowupStatus[] = [];

  for (const sequence of groups.values()) {
    sequence.sort(
      (a, b) =>
        a.cadenceTouch - b.cadenceTouch ||
        a.createdAt.localeCompare(b.createdAt),
    );
    const latestSent = [...sequence]
      .reverse()
      .find((item) => item.state === "sent" && item.sentAt);
    if (!latestSent?.sentAt) continue;

    const ids = new Set(sequence.map((item) => item.id));
    const terminal = input.emailEvents
      .filter(
        (event) =>
          event.outreachItemId &&
          ids.has(event.outreachItemId) &&
          ["replied", "unsubscribed", "complained", "bounced"].includes(
            event.kind,
          ),
      )
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    const nextQueued = sequence.find(
      (item) =>
        item.cadenceTouch > latestSent.cadenceTouch &&
        (item.state === "draft" || item.state === "approved"),
    );
    const base = {
      sourceId: latestSent.id,
      queuedItemId: nextQueued?.id ?? null,
      dealId: latestSent.dealId,
      recipient: latestSent.recipient,
      currentTouch: latestSent.cadenceTouch,
    };

    if (terminal?.kind === "replied") {
      statuses.push({
        ...base,
        nextTouch: null,
        dueAt: null,
        state: "replied",
        reason: "Reply received — cadence stopped",
      });
      continue;
    }
    if (terminal) {
      statuses.push({
        ...base,
        nextTouch: null,
        dueAt: null,
        state: "stopped",
        reason: `${terminal.kind} recorded — cadence stopped`,
      });
      continue;
    }
    if (nextQueued) {
      statuses.push({
        ...base,
        nextTouch: nextQueued.cadenceTouch,
        dueAt: null,
        state: "queued",
        reason: `Touch ${nextQueued.cadenceTouch} is ${nextQueued.state === "draft" ? "awaiting review" : "approved and ready"}`,
      });
      continue;
    }
    if (latestSent.cadenceTouch >= input.cadenceTouches) {
      statuses.push({
        ...base,
        nextTouch: null,
        dueAt: null,
        state: "complete",
        reason: `All ${input.cadenceTouches} touches completed without a reply`,
      });
      continue;
    }

    const dueAt = new Date(
      new Date(latestSent.sentAt).getTime() + spacingDays * DAY_MS,
    ).toISOString();
    const due = now.getTime() >= new Date(dueAt).getTime();
    statuses.push({
      ...base,
      nextTouch: latestSent.cadenceTouch + 1,
      dueAt,
      state: due ? "due" : "waiting",
      reason: due
        ? `Touch ${latestSent.cadenceTouch + 1} is due`
        : `Touch ${latestSent.cadenceTouch + 1} is scheduled`,
    });
  }

  return statuses.sort((a, b) =>
    (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"),
  );
}

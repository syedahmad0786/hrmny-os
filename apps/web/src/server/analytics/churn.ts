/**
 * M10 churn signals — pure function scoring active clients on recency/volume of
 * approved deliverables + engagement. ponytail: recency heuristic, no model.
 */

export type ChurnClient = {
  clientId: string;
  name: string;
  /** ISO date; a near renewal with stale delivery bumps risk. */
  renewalDate?: string | null;
};

/** An approved-deliverable / client-facing activity event with a timestamp. */
export type ChurnActivity = { clientId: string; approvedAt: string };

export type ChurnRow = {
  clientId: string;
  name: string;
  risk: number;
  reason: string;
};

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(from: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(from).getTime()) / DAY_MS);
}

/**
 * Risk desc, sliced to `limit`. Recency of the last approved deliverable is the
 * primary signal (0 days → healthy, ≥30 days → maxed); an imminent renewal with
 * stale delivery adds a bump. Clients with no delivery on record score high.
 */
export function scoreChurn(input: {
  clients: ChurnClient[];
  deliverables: ChurnActivity[];
  limit: number;
  now?: Date;
}): ChurnRow[] {
  const now = input.now ?? new Date();

  const lastByClient = new Map<string, string>();
  const countByClient = new Map<string, number>();
  for (const ev of input.deliverables) {
    const prev = lastByClient.get(ev.clientId);
    if (!prev || ev.approvedAt > prev) lastByClient.set(ev.clientId, ev.approvedAt);
    if (daysBetween(ev.approvedAt, now) <= 30)
      countByClient.set(ev.clientId, (countByClient.get(ev.clientId) ?? 0) + 1);
  }

  const rows = input.clients.map((c): ChurnRow => {
    const last = lastByClient.get(c.clientId);
    if (!last) {
      return {
        clientId: c.clientId,
        name: c.name,
        risk: 0.85,
        reason: "No approved deliverable on record",
      };
    }
    const days = daysBetween(last, now);
    let risk = Math.min(1, Math.max(0, days / 30));

    // Imminent renewal (≤30 days out) with stale delivery is the danger zone.
    let renewalNote = "";
    if (c.renewalDate) {
      const daysToRenewal = -daysBetween(c.renewalDate, now);
      if (daysToRenewal >= 0 && daysToRenewal <= 30 && days >= 14) {
        risk = Math.min(1, risk + 0.1);
        renewalNote = `; renews in ${daysToRenewal}d`;
      }
    }

    const recent = countByClient.get(c.clientId) ?? 0;
    const reason =
      days >= 21
        ? `No approved deliverable in ${days} days${renewalNote}`
        : days >= 14
          ? `Deliverables slowing (last ${days}d ago, ${recent} in 30d)${renewalNote}`
          : `Engagement steady (${recent} approved in 30d)`;

    return { clientId: c.clientId, name: c.name, risk: round2(risk), reason };
  });

  rows.sort(
    (a, b) => b.risk - a.risk || a.name.localeCompare(b.name),
  );
  return rows.slice(0, input.limit);
}

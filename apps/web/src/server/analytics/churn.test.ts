import { describe, expect, it } from "vitest";
import { scoreChurn, type ChurnActivity, type ChurnClient } from "./churn";

const NOW = new Date("2026-07-30T00:00:00Z");
const DAY_MS = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY_MS).toISOString();
const daysAhead = (n: number) =>
  new Date(NOW.getTime() + n * DAY_MS).toISOString().slice(0, 10);

const client = (id: string, name: string, renewalDate?: string): ChurnClient => ({
  clientId: id,
  name,
  renewalDate,
});

describe("scoreChurn", () => {
  it("scores steady, slowing, stale, and never-delivered clients", () => {
    const clients = [
      client("steady", "Steady Co"),
      client("stale", "Stale Co"),
      client("never", "Never Co"),
    ];
    const deliverables: ChurnActivity[] = [
      { clientId: "steady", approvedAt: daysAgo(3) },
      { clientId: "stale", approvedAt: daysAgo(25) },
      // "never" has no delivery events
    ];

    const rows = scoreChurn({ clients, deliverables, limit: 20, now: NOW });

    // Sorted by risk desc: never (0.85) > stale (0.83) > steady (0.1).
    expect(rows.map((r) => r.clientId)).toEqual(["never", "stale", "steady"]);

    const steady = rows.find((r) => r.clientId === "steady")!;
    expect(steady.risk).toBe(0.1);
    expect(steady.reason).toContain("Engagement steady");

    const stale = rows.find((r) => r.clientId === "stale")!;
    expect(stale.risk).toBe(0.83);
    expect(stale.reason).toBe("No approved deliverable in 25 days");

    const never = rows.find((r) => r.clientId === "never")!;
    expect(never.risk).toBe(0.85);
    expect(never.reason).toBe("No approved deliverable on record");
  });

  it("bumps risk when a stale client is near renewal", () => {
    const rows = scoreChurn({
      clients: [client("c", "Renewal Co", daysAhead(10))],
      deliverables: [{ clientId: "c", approvedAt: daysAgo(20) }],
      limit: 20,
      now: NOW,
    });
    // 20/30 = 0.67, +0.1 renewal bump = 0.77.
    expect(rows[0]!.risk).toBe(0.77);
    expect(rows[0]!.reason).toContain("renews in 10d");
  });

  it("respects the limit after sorting", () => {
    const clients = [
      client("a", "A"),
      client("b", "B"),
      client("c", "C"),
    ];
    const deliverables: ChurnActivity[] = [
      { clientId: "a", approvedAt: daysAgo(1) }, // 0.03
      { clientId: "b", approvedAt: daysAgo(28) }, // 0.93 (most stale)
      // c never delivered → 0.85
    ];
    const rows = scoreChurn({ clients, deliverables, limit: 2, now: NOW });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.clientId)).toEqual(["b", "c"]);
  });

  it("returns nothing when there are no active clients", () => {
    expect(
      scoreChurn({ clients: [], deliverables: [], limit: 20, now: NOW }),
    ).toEqual([]);
  });
});

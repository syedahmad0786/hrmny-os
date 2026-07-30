import { describe, expect, it } from "vitest";
import { forecastCapacity, type CapacityItem } from "./capacity";

const NOW = new Date("2026-07-30T00:00:00Z");
const DAY_MS = 86_400_000;
const dueIn = (days: number) =>
  new Date(NOW.getTime() + days * DAY_MS).toISOString();

function item(overrides: Partial<CapacityItem>): CapacityItem {
  return {
    assigneeEmployeeId: "e1",
    assigneeName: "Alice",
    dueAt: dueIn(2),
    completedAt: null,
    estimatedMinutes: 60,
    ...overrides,
  };
}

describe("forecastCapacity", () => {
  it("sums assigned minutes vs window capacity and flags overbooked assignees", () => {
    const items: CapacityItem[] = [
      item({ assigneeName: "Alice", dueAt: dueIn(2), estimatedMinutes: 1200 }),
      item({ assigneeName: "Bob", dueAt: dueIn(3), estimatedMinutes: 3000 }),
      // Out of the 1-week window → excluded.
      item({ assigneeName: "Alice", dueAt: dueIn(40), estimatedMinutes: 9999 }),
      // Completed → excluded.
      item({ assigneeName: "Carol", dueAt: dueIn(2), estimatedMinutes: 600, completedAt: dueIn(-1) }),
      // Unassigned → no capacity owner, excluded.
      item({ assigneeName: null, assigneeEmployeeId: null, dueAt: dueIn(2), estimatedMinutes: 500 }),
    ];

    const res = forecastCapacity({ items, weeks: 1, now: NOW });

    // Capacity per assignee = 40h * 60 * 1wk = 2400 min. Bob (3000) is overbooked.
    // Utilization = (1200 + 3000) / (2 assignees * 2400) = 0.875.
    expect(res.weeks).toBe(1);
    expect(res.utilizationPct).toBe(0.88);
    expect(res.overbookedRoles).toEqual(["Bob"]);
  });

  it("honours a custom weekly capacity", () => {
    const res = forecastCapacity({
      items: [item({ assigneeName: "Solo", dueAt: dueIn(1), estimatedMinutes: 600 })],
      weeks: 1,
      capacityHoursPerWeek: 10, // 10h * 60 = 600 min capacity → exactly full
      now: NOW,
    });
    expect(res.utilizationPct).toBe(1);
    expect(res.overbookedRoles).toEqual([]);
  });

  it("returns zero utilization when nothing is scheduled", () => {
    const res = forecastCapacity({ items: [], weeks: 4, now: NOW });
    expect(res.utilizationPct).toBe(0);
    expect(res.overbookedRoles).toEqual([]);
    expect(res.note).toContain("No scheduled work");
  });
});

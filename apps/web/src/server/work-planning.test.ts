import { describe, expect, it } from "vitest";
import {
  budgetSummary,
  capacityUtilization,
  criticalPath,
  splitTimerByUtcDay,
  weightedProgress,
} from "./work-planning";

describe("work planning calculations", () => {
  it("rolls up progress, capacity, budgets, and timer days", () => {
    expect(
      weightedProgress([
        { progress: 100, weight: 1 },
        { progress: 25, weight: 3 },
      ]),
    ).toBe(43.75);
    expect(capacityUtilization(2_700, 40)).toBe(112.5);
    expect(budgetSummary(10_000, 200, 1_800, 600)).toEqual({
      actualCost: 6_000,
      forecastCost: 8_000,
      variance: 2_000,
    });
    expect(
      criticalPath([
        { itemId: "a", durationMinutes: 60, dependencies: [] },
        { itemId: "b", durationMinutes: 120, dependencies: ["a"] },
        { itemId: "c", durationMinutes: 30, dependencies: [] },
      ]),
    ).toEqual(["a", "b"]);
    expect(
      splitTimerByUtcDay(
        "2026-07-24T23:30:00.000Z",
        "2026-07-25T00:45:00.000Z",
      ),
    ).toEqual([
      { workDate: "2026-07-24", minutes: 30 },
      { workDate: "2026-07-25", minutes: 45 },
    ]);
    expect(() => splitTimerByUtcDay("bad", new Date())).toThrow();
  });
});

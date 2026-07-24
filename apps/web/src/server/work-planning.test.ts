import { describe, expect, it } from "vitest";
import {
  budgetSummary,
  buildWorkReportChart,
  capacityUtilization,
  countReportBuckets,
  criticalPath,
  matchesMetadataReportFilters,
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
    expect(
      buildWorkReportChart(
        [
          {
            itemId: "a",
            parentItemId: null,
            itemType: "task",
            priority: "high",
            assigneeName: "Aisha",
            sectionName: "Doing",
            projectName: "Launch",
            dueAt: "2026-07-24T12:00:00.000Z",
            completedAt: null,
            estimatedMinutes: 120,
            actualMinutes: 60,
          },
          {
            itemId: "b",
            parentItemId: "a",
            itemType: "task",
            priority: "high",
            assigneeName: "Aisha",
            sectionName: "Doing",
            projectName: "Launch",
            dueAt: "2026-07-25T12:00:00.000Z",
            completedAt: null,
            estimatedMinutes: 30,
            actualMinutes: 15,
          },
        ],
        {
          groupBy: "assignee",
          metric: "estimated_minutes",
          completion: "incomplete",
          dueFrom: "2026-07-20",
          dueTo: "2026-07-26",
          includeSubtasks: false,
          customFieldId: null,
        },
      ),
    ).toEqual({ data: [{ label: "Aisha", value: 120 }], total: 120 });
    expect(
      buildWorkReportChart(
        [
          {
            itemId: "a",
            parentItemId: null,
            itemType: "task",
            priority: null,
            assigneeName: null,
            sectionName: null,
            projectName: "Launch",
            dueAt: null,
            completedAt: null,
            estimatedMinutes: null,
            actualMinutes: 0,
            customFieldValue: ["UAE", "KSA", "UAE"],
          },
        ],
        {
          groupBy: "custom_field",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: "field",
        },
      ),
    ).toEqual({
      data: [
        { label: "KSA", value: 1 },
        { label: "UAE", value: 1 },
      ],
      total: 2,
    });
    expect(countReportBuckets(["On track", "At risk", "On track"])).toEqual({
      data: [
        { label: "On track", value: 2 },
        { label: "At risk", value: 1 },
      ],
      total: 3,
    });
    expect(
      matchesMetadataReportFilters(
        {
          ownerEmployeeId: "owner",
          status: "on_track",
          privacy: "organization",
          parentId: "parent",
        },
        { ownerEmployeeId: "owner", status: "on_track" },
      ),
    ).toBe(true);
    expect(
      matchesMetadataReportFilters(
        {
          ownerEmployeeId: "owner",
          status: "on_track",
          parentId: "parent",
        },
        { includeSubgoals: false },
      ),
    ).toBe(false);
  });
});

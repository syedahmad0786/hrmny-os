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
    expect(
      buildWorkReportChart(
        [
          {
            itemId: "subtask",
            parentItemId: "parent",
            itemType: "task",
            priority: "urgent",
            assigneeEmployeeId: "owner",
            assigneeName: "Aisha",
            sectionName: null,
            projectName: "Launch",
            dueAt: null,
            completedAt: null,
            estimatedMinutes: 30,
            actualMinutes: 0,
          },
        ],
        {
          groupBy: "assignee",
          metric: "task_count",
          completion: "all",
          dueFrom: null,
          dueTo: null,
          includeSubtasks: true,
          customFieldId: null,
          assigneeEmployeeId: "owner",
          priority: "urgent",
          itemType: "task",
          subtasks: "only",
        },
      ),
    ).toEqual({ data: [{ label: "Aisha", value: 1 }], total: 1 });
    const numericRows = [
      {
        itemId: "native",
        parentItemId: null,
        itemType: "task" as const,
        priority: null,
        assigneeName: null,
        sectionName: null,
        projectName: "Launch",
        dueAt: null,
        completedAt: null,
        estimatedMinutes: null,
        actualMinutes: 0,
        metricCustomFieldValue: 10,
      },
      {
        itemId: "asana",
        parentItemId: null,
        itemType: "task" as const,
        priority: null,
        assigneeName: null,
        sectionName: null,
        projectName: "Support",
        dueAt: null,
        completedAt: null,
        estimatedMinutes: null,
        actualMinutes: 0,
        metricCustomFieldValue: { number_value: 20 },
      },
    ];
    const numericSpec = {
      groupBy: "completion" as const,
      metric: "custom_field_sum" as const,
      completion: "all" as const,
      dueFrom: null,
      dueTo: null,
      includeSubtasks: true,
      customFieldId: null,
      metricCustomFieldKey: "asana:budget",
    };
    expect(buildWorkReportChart(numericRows, numericSpec)).toEqual({
      data: [{ label: "Incomplete", value: 30 }],
      total: 30,
    });
    expect(
      buildWorkReportChart(numericRows, {
        ...numericSpec,
        metric: "custom_field_average",
      }),
    ).toEqual({ data: [{ label: "Incomplete", value: 15 }], total: 15 });
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
          objectId: "project",
          ownerEmployeeId: "owner",
          status: "on_track",
          privacy: "organization",
          parentId: "parent",
          teamIds: ["team"],
          dueDate: "2026-07-24",
        },
        {
          objectIds: ["project"],
          ownerEmployeeId: "owner",
          status: "on_track",
          teamId: "team",
          dateField: "due",
          dateFrom: "2026-07-01",
          dateTo: "2026-07-31",
        },
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
    expect(
      matchesMetadataReportFilters(
        {
          objectId: "project",
          ownerEmployeeId: "owner",
          dueDate: "2026-07-24",
        },
        {
          objectIds: ["another-project"],
          dateField: "due",
          dateFrom: "2026-08-01",
        },
      ),
    ).toBe(false);
  });
});

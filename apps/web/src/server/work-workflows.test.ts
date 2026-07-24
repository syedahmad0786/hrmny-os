import { describe, expect, it } from "vitest";
import {
  normalizeFormAnswers,
  relativeDate,
  ruleBranchMatches,
} from "./work-workflows";

describe("work workflow rules", () => {
  it("matches branches and resolves relative dates", () => {
    expect(
      ruleBranchMatches(
        {
          mode: "all",
          conditions: [
            { field: "priority", operator: "equals", value: "high" },
            { field: "title", operator: "contains", value: "launch" },
          ],
          actions: [{ type: "complete" }],
        },
        {
          title: "Launch campaign",
          priority: "high",
          completed: false,
          sectionId: null,
          itemType: "task",
        },
      ),
    ).toBe(true);
    expect(relativeDate(2, new Date("2026-01-30T12:00:00Z"))).toBe(
      "2026-02-01T12:00:00.000Z",
    );
    expect(
      normalizeFormAnswers(
        [
          {
            key: "type",
            label: "Type",
            type: "single_select",
            required: true,
            options: ["Campaign", "Event"],
          },
          {
            key: "venue",
            label: "Venue",
            type: "text",
            required: true,
            options: [],
            showWhen: { key: "type", equals: "Event" },
          },
        ],
        { type: "Campaign" },
      ),
    ).toEqual({ type: "Campaign" });
    expect(() =>
      normalizeFormAnswers(
        [
          {
            key: "type",
            label: "Type",
            type: "single_select",
            required: true,
            options: ["Campaign"],
          },
        ],
        { type: "Invalid" },
      ),
    ).toThrow();
  });
});

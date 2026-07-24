import { describe, expect, it } from "vitest";
import { nextRecurrenceDate, normalizeCustomFieldValue } from "./work-daily";

describe("daily work rules", () => {
  it("clamps recurring month ends and validates typed custom fields", () => {
    expect(
      nextRecurrenceDate("2026-01-31T12:00:00.000Z", {
        frequency: "monthly",
        interval: 1,
      }),
    ).toBe("2026-02-28T12:00:00.000Z");
    expect(
      normalizeCustomFieldValue(
        "multi_select",
        ["Red", "Red", "Blue"],
        ["Red", "Blue"],
      ),
    ).toEqual(["Red", "Blue"]);
    expect(() => normalizeCustomFieldValue("number", Number.NaN)).toThrow();
    expect(() => normalizeCustomFieldValue("date", "2026-02-31")).toThrow();
  });
});

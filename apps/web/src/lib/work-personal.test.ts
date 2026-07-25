import { describe, expect, it } from "vitest";
import {
  movePersonalCalendarAnchor,
  personalCalendarDateKeys,
} from "./work-personal";

describe("personal Work calendar", () => {
  it("builds stable Monday weeks and complete month grids", () => {
    expect(personalCalendarDateKeys("2026-07-24", "week", true)).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    expect(personalCalendarDateKeys("2026-07-24", "week", false)).toHaveLength(
      5,
    );
    const month = personalCalendarDateKeys("2026-07-24", "month", true);
    expect(month[0]).toBe("2026-06-29");
    expect(month.at(-1)).toBe("2026-08-02");
    expect(movePersonalCalendarAnchor("2026-07-24", "month", 1)).toBe(
      "2026-08-01",
    );
  });
});

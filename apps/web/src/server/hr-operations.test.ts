import { describe, expect, it } from "vitest";
import {
  canAccessEmployeeHrData,
  canDecideEmployeeRequest,
  calculateLeaveDays,
  dubaiDate,
  isHrAdministrator,
  validateAttendanceWindow,
} from "./hr-operations";

describe("leave and attendance rules", () => {
  it("counts UAE office weekdays and validates half days", () => {
    expect(calculateLeaveDays("2026-07-24", "2026-07-27", "full")).toBe(2);
    expect(calculateLeaveDays("2026-07-27", "2026-07-27", "first_half")).toBe(
      0.5,
    );
    expect(() =>
      calculateLeaveDays("2026-07-27", "2026-07-28", "first_half"),
    ).toThrow("HALF_DAY_MUST_BE_ONE_DATE");
  });

  it("uses Dubai work dates and rejects invalid correction windows", () => {
    expect(dubaiDate(new Date("2026-07-23T20:30:00.000Z"))).toBe("2026-07-24");
    expect(
      validateAttendanceWindow(
        "2026-07-24",
        "2026-07-24T05:00:00.000Z",
        "2026-07-24T13:00:00.000Z",
      ).clockOut,
    ).toBeInstanceOf(Date);
    expect(() =>
      validateAttendanceWindow(
        "2026-07-24",
        "2026-07-24T13:00:00.000Z",
        "2026-07-24T05:00:00.000Z",
      ),
    ).toThrow("INVALID_ATTENDANCE_WINDOW");
  });

  it("limits HR administration to named roles", () => {
    expect(isHrAdministrator(["hr"])).toBe(true);
    expect(isHrAdministrator(["staff"])).toBe(false);
  });

  it("scopes records to self, direct manager, or HR without self-approval", () => {
    const base = {
      actorEmployeeId: "actor",
      targetEmployeeId: "target",
      isDirectReport: false,
    };
    expect(canAccessEmployeeHrData({ ...base, roles: ["staff"] })).toBe(false);
    expect(
      canAccessEmployeeHrData({
        ...base,
        targetEmployeeId: "actor",
        roles: ["staff"],
      }),
    ).toBe(true);
    expect(
      canDecideEmployeeRequest({
        ...base,
        isDirectReport: true,
        roles: ["staff"],
      }),
    ).toBe(true);
    expect(
      canDecideEmployeeRequest({
        ...base,
        targetEmployeeId: "actor",
        roles: ["hr"],
      }),
    ).toBe(false);
  });
});

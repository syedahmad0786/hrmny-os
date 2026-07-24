import { describe, expect, it } from "vitest";
import {
  canAccessEmployeeRecord,
  documentExpiryState,
  lifecycleTaskDueAt,
} from "./core-hr";

describe("core HR access and dates", () => {
  const base = {
    actorEmployeeId: "actor",
    actorEmail: "manager@hrmny.co",
    roles: ["staff"],
    targetEmployeeId: "target",
    targetReportsToEmail: null,
  };

  it("limits records to self, direct reports, or HR administrators", () => {
    expect(
      canAccessEmployeeRecord({ ...base, targetEmployeeId: "actor" }),
    ).toBe(true);
    expect(
      canAccessEmployeeRecord({
        ...base,
        targetReportsToEmail: "MANAGER@HRMNY.CO",
      }),
    ).toBe(true);
    expect(canAccessEmployeeRecord({ ...base, roles: ["hr"] })).toBe(true);
    expect(canAccessEmployeeRecord(base)).toBe(false);
  });

  it("flags document expiry and calculates lifecycle due dates", () => {
    const today = new Date("2026-07-24T20:00:00.000Z");
    expect(documentExpiryState(null, today)).toBe("none");
    expect(documentExpiryState("2026-07-23", today)).toBe("expired");
    expect(documentExpiryState("2026-08-20", today)).toBe("expiring");
    expect(documentExpiryState("2026-09-01", today)).toBe("valid");
    expect(lifecycleTaskDueAt(today, 3).toISOString()).toBe(
      "2026-07-27T20:00:00.000Z",
    );
  });
});

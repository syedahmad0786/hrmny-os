import { describe, expect, it } from "vitest";
import {
  availableHrReportingModules,
  canAccessBenefitsEmployee,
  isEligibleForBenefit,
} from "./benefits-reporting";

describe("benefits access, eligibility, and reporting gates", () => {
  it("allows only self or HR record access", () => {
    expect(
      canAccessBenefitsEmployee({
        actorEmployeeId: "employee-a",
        targetEmployeeId: "employee-a",
        roles: ["staff"],
      }),
    ).toBe(true);
    expect(
      canAccessBenefitsEmployee({
        actorEmployeeId: "employee-a",
        targetEmployeeId: "employee-b",
        roles: ["staff"],
      }),
    ).toBe(false);
    expect(
      canAccessBenefitsEmployee({
        actorEmployeeId: "employee-a",
        targetEmployeeId: "employee-b",
        roles: ["hr"],
      }),
    ).toBe(true);
  });

  it("matches an active eligibility rule and gates optional KPI modules", () => {
    const rules = [
      {
        department: "Creative",
        employmentType: "Full time",
        minServiceDays: 90,
        startsAt: null,
        endsAt: null,
        isActive: true,
      },
    ];
    expect(
      isEligibleForBenefit(
        rules,
        {
          department: "creative",
          employmentType: "FULL TIME",
          joiningDate: "2026-01-01",
        },
        new Date("2026-07-24T12:00:00.000Z"),
      ),
    ).toBe(true);
    expect(
      isEligibleForBenefit(
        rules,
        {
          department: "Sales",
          employmentType: "Full time",
          joiningDate: "2026-01-01",
        },
        new Date("2026-07-24T12:00:00.000Z"),
      ),
    ).toBe(false);
    expect(
      availableHrReportingModules({
        leaveRequest: true,
        attendanceRecord: false,
        salaryPackage: true,
        payrollRun: true,
      }),
    ).toEqual({
      headcount: true,
      turnover: true,
      leave: true,
      attendance: false,
      payrollReadiness: true,
    });
  });
});

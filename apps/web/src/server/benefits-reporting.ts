export const BENEFITS_HR_ROLES = ["partner", "director", "hr"] as const;

export function isBenefitsHrAdmin(roles: readonly string[]): boolean {
  return roles.some((role) =>
    BENEFITS_HR_ROLES.some((adminRole) => adminRole === role),
  );
}

export function canAccessBenefitsEmployee(input: {
  actorEmployeeId: string;
  targetEmployeeId: string;
  roles: readonly string[];
}): boolean {
  return (
    input.actorEmployeeId === input.targetEmployeeId ||
    isBenefitsHrAdmin(input.roles)
  );
}

export type EligibilityRule = {
  department: string | null;
  employmentType: string | null;
  minServiceDays: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
};

export type EligibilityEmployee = {
  department: string | null;
  employmentType: string | null;
  joiningDate: string | null;
};

function sameOptional(value: string | null, expected: string | null): boolean {
  return (
    !expected || value?.trim().toLowerCase() === expected.trim().toLowerCase()
  );
}

/** No rules means company-wide eligibility; otherwise one active matching rule is enough. */
export function isEligibleForBenefit(
  rules: readonly EligibilityRule[],
  employee: EligibilityEmployee,
  today = new Date(),
): boolean {
  const active = rules.filter((rule) => rule.isActive);
  if (active.length === 0) return true;
  const date = today.toISOString().slice(0, 10);
  const serviceDays = employee.joiningDate
    ? Math.max(
        0,
        Math.floor(
          (Date.parse(`${date}T00:00:00.000Z`) -
            Date.parse(`${employee.joiningDate}T00:00:00.000Z`)) /
            86_400_000,
        ),
      )
    : 0;
  return active.some(
    (rule) =>
      sameOptional(employee.department, rule.department) &&
      sameOptional(employee.employmentType, rule.employmentType) &&
      serviceDays >= rule.minServiceDays &&
      (!rule.startsAt || rule.startsAt <= date) &&
      (!rule.endsAt || rule.endsAt >= date),
  );
}

export type HrReportingPresence = {
  leaveRequest: boolean;
  attendanceRecord: boolean;
  salaryPackage: boolean;
  payrollRun: boolean;
};

export function availableHrReportingModules(presence: HrReportingPresence) {
  return {
    headcount: true,
    turnover: true,
    leave: presence.leaveRequest,
    attendance: presence.attendanceRecord,
    payrollReadiness: presence.salaryPackage && presence.payrollRun,
  };
}

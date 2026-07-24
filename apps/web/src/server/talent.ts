export type TalentWorkflow =
  "requisition" | "candidate" | "offer" | "cycle" | "survey";

const ADMIN_ROLES = new Set([
  "partner",
  "director",
  "hr",
  "developer",
  "hiring",
  "admin",
]);

const TRANSITIONS: Record<TalentWorkflow, Record<string, readonly string[]>> = {
  requisition: {
    draft: ["open", "cancelled"],
    open: ["paused", "closed", "cancelled"],
    paused: ["open", "closed", "cancelled"],
  },
  candidate: {
    applied: ["screening", "rejected", "withdrawn"],
    screening: ["interview", "rejected", "withdrawn"],
    interview: ["offer", "rejected", "withdrawn"],
    offer: ["hired", "rejected", "withdrawn"],
  },
  offer: {
    draft: ["sent", "withdrawn"],
    sent: ["accepted", "declined", "withdrawn"],
  },
  cycle: {
    draft: ["active", "closed"],
    active: ["closed"],
  },
  survey: {
    draft: ["open", "closed"],
    open: ["closed"],
  },
};

export function isTalentAdministrator(roles: readonly string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.has(role));
}

export function canAccessEmployeeTalentRecord(
  actorEmployeeId: string,
  roles: readonly string[],
  subjectEmployeeId: string,
): boolean {
  return actorEmployeeId === subjectEmployeeId || isTalentAdministrator(roles);
}

export function canTransitionTalent(
  workflow: TalentWorkflow,
  from: string,
  to: string,
): boolean {
  return TRANSITIONS[workflow][from]?.includes(to) ?? false;
}

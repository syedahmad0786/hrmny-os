const ADMIN_ROLES = new Set(["partner", "director", "hr", "admin"]);

export function isWorkplaceAdmin(roles: readonly string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.has(role));
}

export function canAccessEmployeeScope(
  actorEmployeeId: string,
  roles: readonly string[],
  subjectEmployeeId: string | null,
): boolean {
  return (
    isWorkplaceAdmin(roles) ||
    (subjectEmployeeId !== null && actorEmployeeId === subjectEmployeeId)
  );
}

const STEP_TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["in_progress", "completed", "skipped", "failed"],
  in_progress: ["completed", "skipped", "failed"],
};

export function canTransitionWorkflowStep(from: string, to: string): boolean {
  return STEP_TRANSITIONS[from]?.includes(to) ?? false;
}

const REQUEST_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["triaged", "open", "resolved", "closed"],
  triaged: [
    "open",
    "pending_requester",
    "pending_internal",
    "resolved",
    "closed",
  ],
  open: ["pending_requester", "pending_internal", "resolved", "closed"],
  pending_requester: ["open", "resolved", "closed"],
  pending_internal: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
};

export function canTransitionServiceRequest(from: string, to: string): boolean {
  return REQUEST_TRANSITIONS[from]?.includes(to) ?? false;
}

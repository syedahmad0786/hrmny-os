export const CORE_HR_ADMIN_ROLES = ["partner", "director", "hr"] as const;

export function isCoreHrAdmin(roles: readonly string[]): boolean {
  return roles.some((role) =>
    CORE_HR_ADMIN_ROLES.some((adminRole) => adminRole === role),
  );
}

export function canAccessEmployeeRecord(input: {
  actorEmployeeId: string;
  actorEmail: string;
  roles: readonly string[];
  targetEmployeeId: string;
  targetReportsToEmail: string | null;
}): boolean {
  return (
    isCoreHrAdmin(input.roles) ||
    input.actorEmployeeId === input.targetEmployeeId ||
    input.targetReportsToEmail?.trim().toLowerCase() ===
      input.actorEmail.trim().toLowerCase()
  );
}

export type DocumentExpiryState = "none" | "valid" | "expiring" | "expired";

export function documentExpiryState(
  expiresAt: string | null,
  today = new Date(),
): DocumentExpiryState {
  if (!expiresAt) return "none";
  const expiry = new Date(`${expiresAt}T00:00:00.000Z`);
  if (Number.isNaN(expiry.getTime())) throw new Error("INVALID_EXPIRY_DATE");
  const start = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  const days = Math.ceil((expiry.getTime() - start) / 86_400_000);
  if (days < 0) return "expired";
  return days <= 30 ? "expiring" : "valid";
}

export function lifecycleTaskDueAt(
  anchor: Date,
  relativeDueDays: number,
): Date {
  if (!Number.isInteger(relativeDueDays) || Math.abs(relativeDueDays) > 365) {
    throw new Error("INVALID_RELATIVE_DUE_DAYS");
  }
  return new Date(anchor.getTime() + relativeDueDays * 86_400_000);
}

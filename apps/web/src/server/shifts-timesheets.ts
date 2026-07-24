const WORKFORCE_ROLES = new Set(["partner", "director", "hr", "traffic"]);

export function isWorkforceOperator(roles: readonly string[]): boolean {
  return roles.some((role) => WORKFORCE_ROLES.has(role));
}

export function canViewWorkRecord(input: {
  roles: readonly string[];
  actorEmployeeId: string;
  targetEmployeeId: string;
  isDirectReport: boolean;
}): boolean {
  return (
    isWorkforceOperator(input.roles) ||
    input.actorEmployeeId === input.targetEmployeeId ||
    input.isDirectReport
  );
}

export function canDecideWorkRequest(input: {
  roles: readonly string[];
  actorEmployeeId: string;
  targetEmployeeId: string;
  isDirectReport: boolean;
}): boolean {
  return (
    input.actorEmployeeId !== input.targetEmployeeId &&
    (isWorkforceOperator(input.roles) || input.isDirectReport)
  );
}

export function validateShiftWindow(
  startsAt: string | Date,
  endsAt: string | Date,
): { startsAt: Date; endsAt: Date; minutes: number } {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const minutes = (end.getTime() - start.getTime()) / 60_000;
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    minutes <= 0 ||
    minutes > 48 * 60
  ) {
    throw new Error("INVALID_SHIFT_WINDOW");
  }
  return { startsAt: start, endsAt: end, minutes };
}

export function intervalsOverlap(
  firstStart: string | Date,
  firstEnd: string | Date,
  secondStart: string | Date,
  secondEnd: string | Date,
): boolean {
  const first = validateShiftWindow(firstStart, firstEnd);
  const second = validateShiftWindow(secondStart, secondEnd);
  return first.startsAt < second.endsAt && second.startsAt < first.endsAt;
}

export function validateDailyMinutes(
  currentMinutes: number,
  nextMinutes: number,
  replacedMinutes = 0,
): number {
  const total = currentMinutes - replacedMinutes + nextMinutes;
  if (
    !Number.isInteger(currentMinutes) ||
    !Number.isInteger(nextMinutes) ||
    !Number.isInteger(replacedMinutes) ||
    nextMinutes < 1 ||
    replacedMinutes < 0 ||
    total > 1440
  ) {
    throw new Error("INVALID_DAILY_MINUTES");
  }
  return total;
}

export function canTransitionShift(
  from: string,
  to: "published" | "cancelled",
): boolean {
  return (
    (from === "draft" && (to === "published" || to === "cancelled")) ||
    (from === "published" && to === "cancelled")
  );
}

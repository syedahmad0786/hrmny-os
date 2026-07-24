export type LeavePortion = "full" | "first_half" | "second_half";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function utcDate(value: string): Date {
  if (!DATE_RE.test(value)) throw new Error("INVALID_DATE");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("INVALID_DATE");
  }
  return date;
}

export function calculateLeaveDays(
  startDate: string,
  endDate: string,
  portion: LeavePortion,
): number {
  const start = utcDate(startDate);
  const end = utcDate(endDate);
  if (end < start) throw new Error("END_BEFORE_START");
  if (portion !== "full" && startDate !== endDate) {
    throw new Error("HALF_DAY_MUST_BE_ONE_DATE");
  }

  let weekdays = 0;
  for (
    const day = new Date(start);
    day <= end;
    day.setUTCDate(day.getUTCDate() + 1)
  ) {
    const weekday = day.getUTCDay();
    if (weekday !== 0 && weekday !== 6) weekdays += 1;
  }
  if (weekdays === 0) throw new Error("NO_WORKING_DAYS");
  return portion === "full" ? weekdays : 0.5;
}

export function dubaiDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function validateAttendanceWindow(
  workDate: string,
  requestedClockIn: string,
  requestedClockOut: string,
): { clockIn: Date; clockOut: Date } {
  utcDate(workDate);
  const clockIn = new Date(requestedClockIn);
  const clockOut = new Date(requestedClockOut);
  const duration = clockOut.getTime() - clockIn.getTime();
  if (
    Number.isNaN(clockIn.getTime()) ||
    Number.isNaN(clockOut.getTime()) ||
    dubaiDate(clockIn) !== workDate ||
    duration <= 0 ||
    duration > 24 * 60 * 60 * 1000
  ) {
    throw new Error("INVALID_ATTENDANCE_WINDOW");
  }
  return { clockIn, clockOut };
}

export function isHrAdministrator(roles: string[]): boolean {
  return roles.some((role) => ["partner", "director", "hr"].includes(role));
}

export function canAccessEmployeeHrData(input: {
  roles: string[];
  actorEmployeeId: string;
  targetEmployeeId: string;
  isDirectReport: boolean;
}): boolean {
  return (
    isHrAdministrator(input.roles) ||
    input.actorEmployeeId === input.targetEmployeeId ||
    input.isDirectReport
  );
}

export function canDecideEmployeeRequest(input: {
  roles: string[];
  actorEmployeeId: string;
  targetEmployeeId: string;
  isDirectReport: boolean;
}): boolean {
  return (
    input.actorEmployeeId !== input.targetEmployeeId &&
    (isHrAdministrator(input.roles) || input.isDirectReport)
  );
}

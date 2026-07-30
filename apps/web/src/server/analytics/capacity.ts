/**
 * M10 capacity forecast — pure function over work-item assignments.
 * Utilization of the assigned workforce over the next `weeks`; a role/assignee
 * is overbooked when their scheduled minutes exceed their window capacity.
 * ponytail: naive per-assignee sum vs a flat weekly capacity, no calendar/PTO
 * modelling — good enough at 25-staff scale.
 */

/** Minimal work-assignment shape — WorkItem satisfies this structurally. */
export type CapacityItem = {
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  /** ISO datetime the work is due; drives the forecast window. */
  dueAt: string | null;
  completedAt: string | null;
  estimatedMinutes?: number | null;
};

export type CapacityResult = {
  weeks: number;
  /** 0–1 fraction: scheduled minutes ÷ capacity of assignees with work. */
  utilizationPct: number;
  overbookedRoles: string[];
  note: string;
};

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function forecastCapacity(input: {
  items: CapacityItem[];
  weeks: number;
  /** Working capacity per assignee per week; demo default 40h. */
  capacityHoursPerWeek?: number;
  now?: Date;
}): CapacityResult {
  const now = input.now ?? new Date();
  const capacityPerWeek = input.capacityHoursPerWeek ?? 40;
  const horizonEnd = new Date(now.getTime() + input.weeks * 7 * DAY_MS);
  const capacityMinutes = capacityPerWeek * 60 * input.weeks;

  const minutesByAssignee = new Map<string, number>();
  let scheduled = 0;
  for (const item of input.items) {
    if (item.completedAt || !item.dueAt) continue;
    const due = new Date(item.dueAt);
    if (due < now || due >= horizonEnd) continue;
    const label = item.assigneeName ?? item.assigneeEmployeeId;
    if (!label) continue; // unassigned work has no capacity owner to forecast
    const minutes = item.estimatedMinutes ?? 0;
    if (minutes <= 0) continue;
    minutesByAssignee.set(label, (minutesByAssignee.get(label) ?? 0) + minutes);
    scheduled += minutes;
  }

  const assignees = minutesByAssignee.size;
  if (assignees === 0) {
    return {
      weeks: input.weeks,
      utilizationPct: 0,
      overbookedRoles: [],
      note: `No scheduled work in the next ${input.weeks} week(s)`,
    };
  }

  const overbookedRoles = [...minutesByAssignee.entries()]
    .filter(([, minutes]) => minutes > capacityMinutes)
    .map(([label]) => label)
    .sort();

  return {
    weeks: input.weeks,
    utilizationPct: round2(scheduled / (assignees * capacityMinutes)),
    overbookedRoles,
    note: `${scheduled / 60}h scheduled across ${assignees} assignee(s) vs ${capacityPerWeek}h/wk over ${input.weeks}wk`,
  };
}

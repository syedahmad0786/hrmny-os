export type PersonalCalendarMode = "week" | "month";

const fromDateKey = (dateKey: string) => new Date(`${dateKey}T12:00:00`);

export function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number) {
  const date = fromDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function startOfWeek(dateKey: string) {
  const day = fromDateKey(dateKey).getDay();
  return addDays(dateKey, -(day === 0 ? 6 : day - 1));
}

export function personalCalendarDateKeys(
  anchorKey: string,
  mode: PersonalCalendarMode,
  showWeekends: boolean,
) {
  let first = startOfWeek(anchorKey);
  let count = 7;
  if (mode === "month") {
    const anchor = fromDateKey(anchorKey);
    const monthStart = localDateKey(
      new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12),
    );
    const monthEnd = localDateKey(
      new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12),
    );
    first = startOfWeek(monthStart);
    count = Math.round(
      (fromDateKey(addDays(monthEnd, 7)).getTime() -
        fromDateKey(first).getTime()) /
        86_400_000,
    );
    count -= count % 7;
  }
  return Array.from({ length: count }, (_, index) =>
    addDays(first, index),
  ).filter(
    (dateKey) =>
      showWeekends || ![0, 6].includes(fromDateKey(dateKey).getDay()),
  );
}

export function movePersonalCalendarAnchor(
  anchorKey: string,
  mode: PersonalCalendarMode,
  direction: -1 | 1,
) {
  if (mode === "week") return addDays(anchorKey, direction * 7);
  const anchor = fromDateKey(anchorKey);
  return localDateKey(
    new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1, 12),
  );
}

export function dueDateKey(dueAt: string | null) {
  return dueAt ? localDateKey(new Date(dueAt)) : null;
}

export function dueAtFromDateKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00`).toISOString();
}

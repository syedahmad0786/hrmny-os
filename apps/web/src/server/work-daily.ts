export type WorkRecurrence = {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  interval: number;
  endDate?: string;
};

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function nextRecurrenceDate(
  current: string | Date,
  recurrence: WorkRecurrence,
): string | null {
  const value = new Date(current);
  if (Number.isNaN(value.getTime())) throw new Error("Invalid recurrence date");
  const interval = Math.max(1, Math.min(365, Math.trunc(recurrence.interval)));
  if (recurrence.frequency === "daily") {
    value.setUTCDate(value.getUTCDate() + interval);
  } else if (recurrence.frequency === "weekly") {
    value.setUTCDate(value.getUTCDate() + interval * 7);
  } else {
    const originalDay = value.getUTCDate();
    const months =
      recurrence.frequency === "monthly" ? interval : interval * 12;
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() + months);
    value.setUTCDate(
      Math.min(
        originalDay,
        daysInUtcMonth(value.getUTCFullYear(), value.getUTCMonth()),
      ),
    );
  }
  if (
    recurrence.endDate &&
    value.toISOString().slice(0, 10) > recurrence.endDate
  ) {
    return null;
  }
  return value.toISOString();
}

export type WorkCustomFieldType =
  | "text"
  | "number"
  | "date"
  | "boolean"
  | "single_select"
  | "multi_select"
  | "people";

export function normalizeCustomFieldValue(
  type: WorkCustomFieldType,
  value: unknown,
  options: readonly string[] = [],
): unknown {
  if (value === null) return null;
  if (type === "text") {
    if (typeof value !== "string" || value.length > 10_000)
      throw new Error("Text value is invalid");
    return value;
  }
  if (type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error("Number value is invalid");
    return value;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new Error("Boolean value is invalid");
    return value;
  }
  if (type === "date") {
    const parsed =
      typeof value === "string" ? new Date(`${value}T00:00:00Z`) : null;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !parsed ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new Error("Date value is invalid");
    }
    return value;
  }
  if (type === "single_select") {
    if (typeof value !== "string" || !options.includes(value))
      throw new Error("Select value is invalid");
    return value;
  }
  if (type === "multi_select") {
    if (
      !Array.isArray(value) ||
      value.length > 100 ||
      value.some(
        (entry) => typeof entry !== "string" || !options.includes(entry),
      )
    ) {
      throw new Error("Multi-select value is invalid");
    }
    return [...new Set(value)];
  }
  if (
    !Array.isArray(value) ||
    value.length > 50 ||
    value.some(
      (entry) =>
        typeof entry !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          entry,
        ),
    )
  ) {
    throw new Error("People value is invalid");
  }
  return [...new Set(value)];
}

export type DiscoverySchedule = {
  timeZone: string;
  localTime: string;
  /** JavaScript weekday numbers: Sunday 0 through Saturday 6. */
  weekdays: number[];
};

/** Dubai has no daylight-saving transition. Other zones require an explicit implementation. */
export function previewDiscoverySchedule(
  schedule: DiscoverySchedule,
  after: Date,
  count = 3,
): string[] {
  if (schedule.timeZone !== "Asia/Dubai")
    throw new Error("Discovery schedules currently support Asia/Dubai only");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime))
    throw new Error("Use a time between 00:00 and 23:59");
  if (
    !schedule.weekdays.length ||
    schedule.weekdays.length > 7 ||
    new Set(schedule.weekdays).size !== schedule.weekdays.length ||
    schedule.weekdays.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    )
  )
    throw new Error("Select distinct weekdays from Sunday to Saturday");
  if (
    !Number.isFinite(after.getTime()) ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 10
  )
    throw new Error(
      "A valid starting date and one to ten preview times are required",
    );

  const offset = 4 * 60 * 60 * 1000;
  const local = new Date(after.getTime() + offset);
  const [hour, minute] = schedule.localTime.split(":").map(Number);
  const result: string[] = [];
  for (let day = 0; day <= count * 7; day += 1) {
    const candidate = new Date(
      Date.UTC(
        local.getUTCFullYear(),
        local.getUTCMonth(),
        local.getUTCDate() + day,
        hour,
        minute,
      ),
    );
    const instant = candidate.getTime() - offset;
    if (
      schedule.weekdays.includes(candidate.getUTCDay()) &&
      instant > after.getTime()
    )
      result.push(new Date(instant).toISOString());
    if (result.length === count) return result;
  }
  throw new Error("Could not calculate the requested schedule preview");
}

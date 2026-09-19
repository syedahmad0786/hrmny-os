import { describe, expect, it } from "vitest";
import { previewDiscoverySchedule } from "./discovery-schedule";

const daily = {
  timeZone: "Asia/Dubai",
  localTime: "06:30",
  weekdays: [1, 2, 3, 4, 5],
};

describe("Discovery published schedule preview", () => {
  it("converts Dubai time, excludes an already due slot and skips the weekend", () => {
    expect(
      previewDiscoverySchedule(daily, new Date("2026-09-18T02:30:00Z")),
    ).toEqual([
      "2026-09-21T02:30:00.000Z",
      "2026-09-22T02:30:00.000Z",
      "2026-09-23T02:30:00.000Z",
    ]);
    expect(
      previewDiscoverySchedule(daily, new Date("2026-09-18T02:29:59Z"), 1),
    ).toEqual(["2026-09-18T02:30:00.000Z"]);
  });

  it("uses the local weekday across a UTC midnight and year boundary", () => {
    expect(
      previewDiscoverySchedule(
        { ...daily, localTime: "00:15", weekdays: [5] },
        new Date("2026-12-31T20:00:00Z"),
        1,
      ),
    ).toEqual(["2026-12-31T20:15:00.000Z"]);
    expect(
      previewDiscoverySchedule(
        { ...daily, weekdays: [5] },
        new Date("2026-09-18T03:00:00Z"),
        3,
      ),
    ).toEqual([
      "2026-09-25T02:30:00.000Z",
      "2026-10-02T02:30:00.000Z",
      "2026-10-09T02:30:00.000Z",
    ]);
  });

  it("rejects invalid or unsupported schedules instead of displaying invented times", () => {
    for (const patch of [
      { timeZone: "America/New_York" },
      { localTime: "24:00" },
      { weekdays: [] },
      { weekdays: [1, 1] },
      { weekdays: [7] },
    ])
      expect(() =>
        previewDiscoverySchedule({ ...daily, ...patch }, new Date()),
      ).toThrow();
    expect(() =>
      previewDiscoverySchedule(daily, new Date("invalid")),
    ).toThrow();
    expect(() => previewDiscoverySchedule(daily, new Date(), 0)).toThrow();
  });
});

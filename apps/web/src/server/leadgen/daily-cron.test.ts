import { afterEach, describe, expect, it } from "vitest";
import {
  LEADGEN_UTC_HOUR,
  resetLeadgenDailyMemory,
  runLeadgenDailyCron,
} from "./daily-cron";

describe("leadgen daily cron", () => {
  afterEach(() => {
    resetLeadgenDailyMemory();
  });

  it("skips before the Dubai morning window", async () => {
    const early = new Date("2026-08-21T01:00:00.000Z");
    expect(early.getUTCHours()).toBeLessThan(LEADGEN_UTC_HOUR);
    const result = await runLeadgenDailyCron(early);
    expect(result).toEqual({ ran: false, skipped: "before_window" });
  });
});

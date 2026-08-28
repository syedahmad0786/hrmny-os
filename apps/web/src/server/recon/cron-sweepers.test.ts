import { afterEach, describe, expect, it } from "vitest";
import {
  resetReconCronMemory,
  runCompetitorScanCron,
  runMemoryEmbedBackfillCron,
  runRetainerMonthStartCron,
  runXeroMirrorCron,
} from "./cron-sweepers";

describe("recon cron sweepers", () => {
  afterEach(() => {
    resetReconCronMemory();
  });

  it("mirrors Xero invoices in mock mode and is idempotent for the day", async () => {
    const first = await runXeroMirrorCron(new Date("2026-08-27T10:00:00.000Z"));
    expect(first.ran).toBe(true);
    expect(first.mode).toBe("mock");
    expect(first.upserted).toBeGreaterThan(0);
    const second = await runXeroMirrorCron(new Date("2026-08-27T11:00:00.000Z"));
    expect(second).toEqual({ ran: false, skipped: "already_ran" });
  });

  it("runs a mock competitor scan once per day", async () => {
    const prev = process.env.LEADGEN_COMPETITORS;
    process.env.LEADGEN_COMPETITORS = "Rival Studio";
    try {
      const first = await runCompetitorScanCron(
        new Date("2026-08-27T10:00:00.000Z"),
      );
      expect(first.ran).toBe(true);
      expect(first.findings).toBeGreaterThan(0);
      const second = await runCompetitorScanCron(
        new Date("2026-08-27T11:00:00.000Z"),
      );
      expect(second.skipped).toBe("already_ran");
    } finally {
      if (prev === undefined) delete process.env.LEADGEN_COMPETITORS;
      else process.env.LEADGEN_COMPETITORS = prev;
    }
  });

  it("does not invent a competitor target when none is configured", async () => {
    const previous = process.env.LEADGEN_COMPETITORS;
    delete process.env.LEADGEN_COMPETITORS;
    try {
      const result = await runCompetitorScanCron(
        new Date("2026-08-28T05:00:00.000Z"),
      );
      expect(result).toMatchObject({ ran: false, skipped: "no_targets" });
    } finally {
      if (previous === undefined) delete process.env.LEADGEN_COMPETITORS;
      else process.env.LEADGEN_COMPETITORS = previous;
    }
  });

  it("drafts retainers for the current month without posting to Xero", async () => {
    const first = await runRetainerMonthStartCron(
      new Date("2026-08-27T10:00:00.000Z"),
    );
    expect(first.period).toBe("2026-08");
    expect(first.ran).toBe(true);
    const second = await runRetainerMonthStartCron(
      new Date("2026-08-27T11:00:00.000Z"),
    );
    expect(second.skipped).toBe("already_ran");
  });

  it("skips memory embed backfill when DATABASE_URL is unset", async () => {
    const result = await runMemoryEmbedBackfillCron();
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe("no_db");
  });
});

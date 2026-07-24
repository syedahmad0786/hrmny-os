import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canDecideWorkRequest,
  canTransitionShift,
  canViewWorkRecord,
  intervalsOverlap,
  isWorkforceOperator,
  validateDailyMinutes,
  validateShiftWindow,
} from "./shifts-timesheets";
import { resolveDevUser, sessionCanViewMargin } from "./auth/session";
import { createCallerFactory } from "./trpc/trpc";
import { shiftsTimesheetsRouter } from "./trpc/shifts-timesheets-router";

const createCaller = createCallerFactory(shiftsTimesheetsRouter);

describe("shift and timesheet rules", () => {
  it("scopes workforce data to self, direct manager, HR, or traffic", () => {
    const base = {
      actorEmployeeId: "actor",
      targetEmployeeId: "target",
      roles: ["staff"],
      isDirectReport: false,
    };
    expect(canViewWorkRecord(base)).toBe(false);
    expect(canViewWorkRecord({ ...base, isDirectReport: true })).toBe(true);
    expect(canViewWorkRecord({ ...base, roles: ["traffic"] })).toBe(true);
    expect(isWorkforceOperator(["hr"])).toBe(true);
    expect(isWorkforceOperator(["staff"])).toBe(false);
    expect(
      canDecideWorkRequest({
        ...base,
        targetEmployeeId: "actor",
        roles: ["hr"],
      }),
    ).toBe(false);
  });

  it("validates shift conflicts and lifecycle", () => {
    expect(
      validateShiftWindow(
        "2026-07-24T05:00:00.000Z",
        "2026-07-24T13:00:00.000Z",
      ).minutes,
    ).toBe(480);
    expect(
      intervalsOverlap(
        "2026-07-24T05:00:00.000Z",
        "2026-07-24T13:00:00.000Z",
        "2026-07-24T12:00:00.000Z",
        "2026-07-24T15:00:00.000Z",
      ),
    ).toBe(true);
    expect(canTransitionShift("draft", "published")).toBe(true);
    expect(canTransitionShift("published", "published")).toBe(false);
  });

  it("caps all entries on an employee day at 24 hours", () => {
    expect(validateDailyMinutes(480, 120)).toBe(600);
    expect(validateDailyMinutes(500, 240, 120)).toBe(620);
    expect(() => validateDailyMinutes(1400, 60)).toThrow(
      "INVALID_DAILY_MINUTES",
    );
  });

  it("blocks ordinary staff from schedule administration before database access", async () => {
    const user = resolveDevUser("am");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });
    await expect(
      caller.templates.save({
        name: "Day shift",
        startTime: "09:00",
        endTime: "18:00",
        breakMinutes: 60,
        isActive: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps all scheduling tables outside the browser Data API", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/db/migrations/0013_shifts_timesheets.sql",
      ),
      "utf8",
    );
    const tables = [
      ...migration.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+public\.([a-z_]+)/gi,
      ),
    ].map((match) => match[1]!);

    expect(tables).toHaveLength(6);
    for (const table of tables) expect(migration).toContain(`'${table}'`);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/FROM PUBLIC/i);
    expect(migration).toMatch(/FROM anon/i);
    expect(migration).toMatch(/FROM authenticated/i);
  });
});

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("work migration compatibility", () => {
  it("upgrades the earlier timesheet project table", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0019_work_management.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0019_work_management.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0019_work_management.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS owner_employee_id/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS source_platform/i);
    expect(migration).toMatch(/ALTER COLUMN code DROP NOT NULL/i);
  });

  it("extends the shared timesheet and project tables for planning", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0023_work_planning.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0023_work_planning.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0023_work_planning.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ALTER TABLE public\.time_entry/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.work_goal/i);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_portfolio/i,
    );
    expect(migration).toMatch(/work_timer_employee_active_uniq/i);
  });
});

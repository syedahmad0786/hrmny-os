import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessEmployeeTalentRecord,
  canTransitionTalent,
  isTalentAdministrator,
} from "./talent";

describe("talent security and workflow rules", () => {
  it("keeps candidate and review administration away from ordinary staff", () => {
    expect(isTalentAdministrator(["hr"])).toBe(true);
    expect(isTalentAdministrator(["hiring"])).toBe(true);
    expect(isTalentAdministrator(["traffic"])).toBe(false);
    expect(
      canAccessEmployeeTalentRecord("employee-a", ["traffic"], "employee-b"),
    ).toBe(false);
    expect(
      canAccessEmployeeTalentRecord("employee-a", ["traffic"], "employee-a"),
    ).toBe(true);
  });

  it("allows only explicit hiring and performance state changes", () => {
    expect(canTransitionTalent("candidate", "interview", "offer")).toBe(true);
    expect(canTransitionTalent("candidate", "applied", "hired")).toBe(false);
    expect(canTransitionTalent("offer", "accepted", "draft")).toBe(false);
    expect(canTransitionTalent("survey", "closed", "open")).toBe(false);
  });

  it("keeps every Talent table outside the browser Data API", () => {
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/db/migrations/0011_bayzat_talent.sql",
      ),
      "utf8",
    );
    const tables = [
      ...migration.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+public\.([a-z_]+)/gi,
      ),
    ].map((match) => match[1]!);

    expect(tables).toHaveLength(10);
    for (const table of tables) expect(migration).toContain(`'${table}'`);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(migration).toMatch(/FROM PUBLIC/i);
    expect(migration).toMatch(/FROM anon/i);
    expect(migration).toMatch(/FROM authenticated/i);
  });
});

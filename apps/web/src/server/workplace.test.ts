import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessEmployeeScope,
  canTransitionServiceRequest,
  canTransitionWorkflowStep,
  isWorkplaceAdmin,
} from "./workplace";

describe("workplace access and workflow rules", () => {
  it("keeps administration restricted while employees see only their scope", () => {
    expect(isWorkplaceAdmin(["hr"])).toBe(true);
    expect(isWorkplaceAdmin(["traffic"])).toBe(false);
    expect(canAccessEmployeeScope("a", ["traffic"], "a")).toBe(true);
    expect(canAccessEmployeeScope("a", ["traffic"], "b")).toBe(false);
    expect(canAccessEmployeeScope("a", ["traffic"], null)).toBe(false);
    expect(canAccessEmployeeScope("a", ["hr"], "b")).toBe(true);
  });

  it("allows only explicit workflow and request state changes", () => {
    expect(canTransitionWorkflowStep("pending", "completed")).toBe(true);
    expect(canTransitionWorkflowStep("completed", "pending")).toBe(false);
    expect(canTransitionServiceRequest("new", "open")).toBe(true);
    expect(canTransitionServiceRequest("closed", "open")).toBe(false);
  });

  it("keeps all workplace tables outside the browser Data API", () => {
    const migration = readFileSync(
      resolve(process.cwd(), "../../packages/db/migrations/0014_workplace.sql"),
      "utf8",
    );
    const tables = [
      ...migration.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+public\.([a-z_]+)/gi,
      ),
    ].map((match) => match[1]!);

    expect(tables).toHaveLength(9);
    for (const table of tables) expect(migration).toContain(`'${table}'`);
    expect(migration).toMatch(
      /ALTER TABLE public\.ticket ENABLE ROW LEVEL SECURITY/i,
    );
    expect(migration).toMatch(/FROM PUBLIC/i);
    expect(migration).toMatch(/FROM anon/i);
    expect(migration).toMatch(/FROM authenticated/i);
  });
});

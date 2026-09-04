import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HRMNY_PRODUCTION_0077_MIGRATION } from "./production-migration-0075-0077-contract";
import {
  HRMNY_MARKETS_0077,
  HRMNY_MARKETS_0078,
  HRMNY_PRODUCTION_0078_MIGRATION,
  validateProduction0078State,
} from "./production-migration-0078-contract";

const prior = [
  {
    created_at: HRMNY_PRODUCTION_0077_MIGRATION.createdAt,
    hash: HRMNY_PRODUCTION_0077_MIGRATION.hash,
  },
];
const complete = [
  ...prior,
  {
    created_at: HRMNY_PRODUCTION_0078_MIGRATION.createdAt,
    hash: HRMNY_PRODUCTION_0078_MIGRATION.hash,
  },
];
const migration = readFileSync(
  fileURLToPath(new URL("../migrations/0078_gcc_markets.sql", import.meta.url)),
  "utf8",
);

describe("production migration 0078 state lock", () => {
  it("only appends the five reviewed market labels", () => {
    expect(
      migration.match(/ALTER TYPE public\.market_enum ADD VALUE/g),
    ).toHaveLength(5);
    for (const value of ["Oman", "Qatar", "Kuwait", "Bahrain", "GCC"]) {
      expect(migration).toContain(`'${value}'`);
    }
    expect(migration).not.toMatch(/\b(?:CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
  });

  it("accepts the exact prior state for preflight and exact new state for verify", () => {
    expect(
      validateProduction0078State({
        phase: "preflight",
        migrationRows: prior,
        marketValues: [...HRMNY_MARKETS_0077],
      }),
    ).toEqual({ migrationsToApply: 1, state: "0077" });
    expect(
      validateProduction0078State({
        phase: "verify",
        migrationRows: complete,
        marketValues: [...HRMNY_MARKETS_0078],
      }),
    ).toEqual({ migrationsToApply: 0, state: "0078" });
  });

  it("refuses partial enum or journal state", () => {
    expect(() =>
      validateProduction0078State({
        phase: "preflight",
        migrationRows: complete,
        marketValues: [...HRMNY_MARKETS_0077],
      }),
    ).toThrow(/not an exact 0077 or 0078/i);
    expect(() =>
      validateProduction0078State({
        phase: "verify",
        migrationRows: prior,
        marketValues: [...HRMNY_MARKETS_0077],
      }),
    ).toThrow(/did not append/i);
  });
});

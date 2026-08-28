import { describe, expect, it } from "vitest";
import {
  HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
  HRMNY_PRODUCTION_PROJECT_REF,
  validateProductionMigrationInputs,
} from "./production-migration-contract";

const base = {
  projectRef: HRMNY_PRODUCTION_PROJECT_REF,
  backupReceipt: "backup-receipt-2026-08-28",
  confirmation: HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
};

describe("production migration target contract", () => {
  it("accepts only the canonical direct project URL", () => {
    const result = validateProductionMigrationInputs({
      ...base,
      databaseUrl: `postgresql://postgres:secret@db.${HRMNY_PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`,
    });
    expect(result).toMatchObject({
      projectRef: HRMNY_PRODUCTION_PROJECT_REF,
      targetKind: "direct",
    });
  });

  it("accepts a canonical Supavisor session-pool URL", () => {
    const result = validateProductionMigrationInputs({
      ...base,
      databaseUrl: `postgresql://postgres.${HRMNY_PRODUCTION_PROJECT_REF}:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
    });
    expect(result.targetKind).toBe("session_pooler");
  });

  it("rejects a different project or transaction-pool port", () => {
    expect(() =>
      validateProductionMigrationInputs({
        ...base,
        databaseUrl:
          "postgresql://postgres.otherproject:secret@aws-0.pooler.supabase.com:5432/postgres",
      }),
    ).toThrow(/canonical HRMNY project/i);
    expect(() =>
      validateProductionMigrationInputs({
        ...base,
        databaseUrl: `postgresql://postgres.${HRMNY_PRODUCTION_PROJECT_REF}:secret@aws-0.pooler.supabase.com:6543/postgres`,
      }),
    ).toThrow(/port 5432/i);
  });

  it("requires the backup receipt and exact confirmation phrase", () => {
    const databaseUrl = `postgresql://postgres:secret@db.${HRMNY_PRODUCTION_PROJECT_REF}.supabase.co:5432/postgres`;
    expect(() =>
      validateProductionMigrationInputs({
        ...base,
        databaseUrl,
        backupReceipt: "",
      }),
    ).toThrow(/backup or PITR receipt/i);
    expect(() =>
      validateProductionMigrationInputs({
        ...base,
        databaseUrl,
        confirmation: "yes",
      }),
    ).toThrow(/confirmation phrase/i);
  });
});

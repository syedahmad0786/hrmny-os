import { describe, expect, it } from "vitest";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
  HRMNY_PRODUCTION_PROJECT_REF,
  validateProductionMigrationInputs,
  validateProductionMigrationJournal,
} from "./production-migration-contract";

const base = {
  projectRef: HRMNY_PRODUCTION_PROJECT_REF,
  backupReceipt: "backup-receipt-2026-08-28",
  confirmation: HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
};

const reconciledSchema = {
  crm_quote: true,
  inbound_lane: true,
  client_onboarding: true,
  legacy_readiness: true,
};

const preflight = {
  phase: "preflight" as const,
  count: 70,
  head: "1785182400000",
  inbox: false,
  legacyFingerprint: HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint,
  tailCount: 0,
  actualTailFingerprint: "empty-tail-fingerprint",
  expectedTailFingerprint: "repository-tail-fingerprint",
  reconciledSchema,
};

const verify = {
  phase: "verify" as const,
  count: 77,
  head: "1787947200000",
  inbox: true,
  legacyFingerprint: HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint,
  tailCount: 7,
  actualTailFingerprint: "repository-tail-fingerprint",
  expectedTailFingerprint: "repository-tail-fingerprint",
  reconciledSchema,
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

describe("production migration legacy bridge contract", () => {
  it("accepts only the observed 70-row legacy baseline", () => {
    expect(validateProductionMigrationJournal(preflight)).toMatchObject({
      fromTag: "legacy_0070_m1_production_readiness",
      toTag: "0074_integration_inbox_invoice_metadata",
      migrationsToApply: 7,
      legacyRowsPreserved: 70,
    });
  });

  it("rejects baseline journal, schema, or inbox drift", () => {
    expect(() =>
      validateProductionMigrationJournal({
        ...preflight,
        legacyFingerprint: "changed",
      }),
    ).toThrow(/baseline fingerprint drifted/i);
    expect(() =>
      validateProductionMigrationJournal({
        ...preflight,
        reconciledSchema: { ...reconciledSchema, crm_quote: false },
      }),
    ).toThrow(/reconciled bridge contract/i);
    expect(() =>
      validateProductionMigrationJournal({ ...preflight, count: 71 }),
    ).toThrow(/exact 70-row legacy baseline/i);
    expect(() =>
      validateProductionMigrationJournal({ ...preflight, inbox: true }),
    ).toThrow(/already appears present/i);
  });

  it("accepts only 77 rows with the legacy prefix and exact repository tail", () => {
    expect(validateProductionMigrationJournal(verify)).toMatchObject({
      fromTag: "0074_integration_inbox_invoice_metadata",
      migrationsToApply: 0,
      legacyRowsPreserved: 70,
    });
    expect(() =>
      validateProductionMigrationJournal({
        ...verify,
        actualTailFingerprint: "different-tail",
      }),
    ).toThrow(/exact 0068-0074 journal tail/i);
    expect(() =>
      validateProductionMigrationJournal({ ...verify, count: 74 }),
    ).toThrow(/exact 0068-0074 journal tail/i);
    expect(() =>
      validateProductionMigrationJournal({ ...verify, inbox: false }),
    ).toThrow(/exact 0068-0074 journal tail/i);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HRMNY_PRODUCTION_0075_MIGRATION } from "./production-migration-0075-contract";
import { HRMNY_PRODUCTION_LEGACY_BASELINE } from "./production-migration-contract";
import {
  HRMNY_PRODUCTION_0076_CONFIRMATION,
  HRMNY_PRODUCTION_0076_MIGRATION,
  validateProduction0076Inputs,
  validateProduction0076Journal,
  validateProduction0076RepositoryBand,
  validateProduction0076RepositoryEntry,
  type Apollo0076SchemaState,
} from "./production-migration-0076-contract";

const projectRef = "klrugedztqxlvyghyzxs";
const base = {
  projectRef,
  backupReceipt: "pitr-receipt-2026-09-01",
  quiescenceReceipt: "quiesced-workers-2026-09-01",
  confirmation: HRMNY_PRODUCTION_0076_CONFIRMATION,
  maintenanceConfirmation:
    "KEEP APOLLO PEOPLE SEARCH QUIESCED UNTIL THE NEW RUNTIME IS VALIDATED",
};

function syntheticDatabaseUrl(input: {
  user: string;
  password?: string | null;
  host: string;
  port?: number;
  database?: string;
  query?: string | null;
}) {
  const credentials =
    input.password === null
      ? input.user
      : `${input.user}:${input.password ?? "secret"}`;
  const query =
    input.query === null ? "" : `?${input.query ?? "sslmode=verify-full"}`;
  return `postgresql://${credentials}@${input.host}:${input.port ?? 5432}/${input.database ?? "postgres"}${query}`;
}

const absentSchema: Apollo0076SchemaState = {
  priorContractReady: true,
  namedColumnsPresent: 0,
  correctColumns: 0,
  namedChecksPresent: 0,
  correctChecks: 0,
  namedIndexesPresent: 0,
  correctIndexes: 0,
  namedFunctionsPresent: 0,
  correctFunctions: 0,
  namedTriggersPresent: 0,
  correctTriggers: 0,
  securedTables: 1,
  runningApolloJobs: 0,
  backfillViolations: 0,
  duplicateRunningSlots: 0,
};

const verifiedSchema: Apollo0076SchemaState = {
  priorContractReady: true,
  namedColumnsPresent: 1,
  correctColumns: 1,
  namedChecksPresent: 1,
  correctChecks: 1,
  namedIndexesPresent: 1,
  correctIndexes: 1,
  namedFunctionsPresent: 1,
  correctFunctions: 1,
  namedTriggersPresent: 1,
  correctTriggers: 1,
  securedTables: 1,
  runningApolloJobs: 0,
  backfillViolations: 0,
  duplicateRunningSlots: 0,
};

const exactPrefix = {
  legacyFingerprint: HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint,
  oldTailCount: 7,
  actualOldTailFingerprint: "exact-0068-0074-tail",
  expectedOldTailFingerprint: "exact-0068-0074-tail",
  priorMigrationCount: 1,
  priorMigrationHash: HRMNY_PRODUCTION_0075_MIGRATION.hash,
};

describe("production migration 0076 target lock", () => {
  it("pins the in-transaction writer fence before schema or data changes", () => {
    const sql = readFileSync(
      new URL(
        "../migrations/0076_apollo_people_search_serialization.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const lock = sql.indexOf(
      "LOCK TABLE public.scheduled_job IN SHARE ROW EXCLUSIVE MODE",
    );
    const zeroRunning = sql.indexOf(
      "Migration 0076 requires zero running Apollo People Search jobs",
    );
    const alter = sql.indexOf("ALTER TABLE public.scheduled_job");
    const compatibilityFunction = sql.indexOf(
      "CREATE OR REPLACE FUNCTION public.scheduled_job_assign_apollo_concurrency_key()",
    );
    const compatibilityTrigger = sql.indexOf(
      "CREATE TRIGGER scheduled_job_assign_apollo_concurrency_key_trg",
    );
    const backfill = sql.indexOf("UPDATE public.scheduled_job");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(zeroRunning).toBeGreaterThan(lock);
    expect(alter).toBeGreaterThan(zeroRunning);
    expect(compatibilityFunction).toBeGreaterThan(alter);
    expect(compatibilityTrigger).toBeGreaterThan(compatibilityFunction);
    expect(backfill).toBeGreaterThan(compatibilityTrigger);
    expect(sql).toMatch(/kind = 'apollo_people_search'/);
    expect(sql).toMatch(/status = 'running'/);
  });

  it("pins the exact journal entry and reviewed repository band", () => {
    expect(() =>
      validateProduction0076RepositoryEntry({
        idx: 75,
        version: "7",
        when: 1788283943222,
        tag: "0076_apollo_people_search_serialization",
        breakpoints: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateProduction0076RepositoryEntry({
        when: 1788283943223,
        tag: "0076_apollo_people_search_serialization",
      }),
    ).toThrow(/journal entry/i);

    const reviewed = [
      { tag: "legacy", when: 1785182400000 },
      { tag: "0068_os_modules", when: 1787284800000 },
      { tag: "0069_seam_outbox", when: 1787298000000 },
      { tag: "0070_portal_magic_token", when: 1787306400000 },
      { tag: "0071_portal_session_grant", when: 1787310000000 },
      { tag: "0072_sales_os", when: 1787673600000 },
      { tag: "0073_connections_app_policy", when: 1787860800000 },
      { tag: "0074_integration_inbox_invoice_metadata", when: 1787947200000 },
      { tag: "0075_apollo_search_fencing", when: 1788168448556 },
      {
        tag: "0076_apollo_people_search_serialization",
        when: 1788283943222,
      },
    ];
    expect(() => validateProduction0076RepositoryBand(reviewed)).not.toThrow();
    expect(() =>
      validateProduction0076RepositoryBand([
        ...reviewed.slice(0, -1),
        { tag: "unreviewed", when: 1788200000000 },
        reviewed.at(-1)!,
      ]),
    ).toThrow(/exactly reviewed/i);
  });

  it("accepts only exact direct and session-pooler production identities", () => {
    expect(
      validateProduction0076Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          host: `db.${projectRef}.supabase.co`,
        }),
      }).targetKind,
    ).toBe("direct");
    expect(
      validateProduction0076Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: `postgres.${projectRef}`,
          host: "aws-0-eu-central-1.pooler.supabase.com",
        }),
      }).targetKind,
    ).toBe("session_pooler");
  });

  it("rejects wrong identity, transport, database, phrase, or backup", () => {
    const validUrl = syntheticDatabaseUrl({
      user: "postgres",
      host: `db.${projectRef}.supabase.co`,
    });
    const invalid = [
      syntheticDatabaseUrl({
        user: `postgres.${projectRef}`,
        host: "untrusted.example",
      }),
      syntheticDatabaseUrl({
        user: `postgres.${projectRef}`,
        host: "aws-0-eu-central-1.pooler.supabase.com",
        port: 6543,
      }),
      syntheticDatabaseUrl({
        user: "postgres",
        host: `db.${projectRef}.supabase.co`,
        database: "other",
      }),
      syntheticDatabaseUrl({
        user: "postgres",
        host: `db.${projectRef}.supabase.co`,
        query: "sslmode=require",
      }),
    ];
    for (const databaseUrl of invalid) {
      expect(() =>
        validateProduction0076Inputs({ ...base, databaseUrl }),
      ).toThrow();
    }
    expect(() =>
      validateProduction0076Inputs({
        ...base,
        databaseUrl: validUrl,
        confirmation: "yes",
      }),
    ).toThrow(/confirmation/i);
    expect(() =>
      validateProduction0076Inputs({
        ...base,
        databaseUrl: validUrl,
        backupReceipt: "",
      }),
    ).toThrow(/backup|PITR/i);
    expect(() =>
      validateProduction0076Inputs({
        ...base,
        databaseUrl: validUrl,
        quiescenceReceipt: "",
      }),
    ).toThrow(/drained|disabled/i);
    expect(() =>
      validateProduction0076Inputs({
        ...base,
        databaseUrl: validUrl,
        maintenanceConfirmation: "rolling deploy",
      }),
    ).toThrow(/quiesced/i);
  });
});

describe("production migration 0076 journal and readback lock", () => {
  it("accepts the exact 0075 preflight with no running Apollo work", () => {
    expect(
      validateProduction0076Journal({
        phase: "preflight",
        count: 78,
        head: HRMNY_PRODUCTION_0075_MIGRATION.createdAt,
        ...exactPrefix,
        migrationCount: 0,
        migrationHash: null,
        schema: absentSchema,
      }),
    ).toMatchObject({
      fromTag: "0075_apollo_search_fencing",
      toTag: "0076_apollo_people_search_serialization",
      migrationsToApply: 1,
    });
  });

  it("fails preflight for partial objects or any running Apollo job", () => {
    for (const schema of [
      { ...absentSchema, namedColumnsPresent: 1 },
      { ...absentSchema, namedChecksPresent: 1 },
      { ...absentSchema, namedIndexesPresent: 1 },
      { ...absentSchema, namedFunctionsPresent: 1 },
      { ...absentSchema, namedTriggersPresent: 1 },
      { ...absentSchema, runningApolloJobs: 1 },
    ]) {
      expect(() =>
        validateProduction0076Journal({
          phase: "preflight",
          count: 78,
          head: HRMNY_PRODUCTION_0075_MIGRATION.createdAt,
          ...exactPrefix,
          migrationCount: 0,
          migrationHash: null,
          schema,
        }),
      ).toThrow();
    }
  });

  it("accepts exact verified 0076 with preserved 0075 hash", () => {
    expect(
      validateProduction0076Journal({
        phase: "verify",
        count: 79,
        head: HRMNY_PRODUCTION_0076_MIGRATION.createdAt,
        ...exactPrefix,
        migrationCount: 1,
        migrationHash: HRMNY_PRODUCTION_0076_MIGRATION.hash,
        schema: verifiedSchema,
      }),
    ).toMatchObject({
      fromTag: "0076_apollo_people_search_serialization",
      migrationsToApply: 0,
    });
  });

  it("rejects prior-head, current-row, schema, backfill, and slot drift", () => {
    const attempts = [
      { prefix: { priorMigrationHash: "wrong" }, schema: verifiedSchema },
      { migrationHash: "wrong", schema: verifiedSchema },
      { schema: { ...verifiedSchema, correctColumns: 0 } },
      { schema: { ...verifiedSchema, correctChecks: 0 } },
      { schema: { ...verifiedSchema, correctIndexes: 0 } },
      { schema: { ...verifiedSchema, correctFunctions: 0 } },
      { schema: { ...verifiedSchema, correctTriggers: 0 } },
      { schema: { ...verifiedSchema, securedTables: 0 } },
      { schema: { ...verifiedSchema, backfillViolations: 1 } },
      { schema: { ...verifiedSchema, duplicateRunningSlots: 1 } },
      { schema: { ...verifiedSchema, runningApolloJobs: 1 } },
      { schema: { ...verifiedSchema, priorContractReady: false } },
    ];
    for (const attempt of attempts) {
      expect(() =>
        validateProduction0076Journal({
          phase: "verify",
          count: 79,
          head: HRMNY_PRODUCTION_0076_MIGRATION.createdAt,
          ...exactPrefix,
          ...attempt.prefix,
          migrationCount: 1,
          migrationHash:
            attempt.migrationHash ?? HRMNY_PRODUCTION_0076_MIGRATION.hash,
          schema: attempt.schema,
        }),
      ).toThrow();
    }
  });
});

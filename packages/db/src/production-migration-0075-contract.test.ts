import { describe, expect, it } from "vitest";
import { HRMNY_PRODUCTION_LEGACY_BASELINE } from "./production-migration-contract";
import {
  HRMNY_PRODUCTION_0075_CONFIRMATION,
  HRMNY_PRODUCTION_0075_MIGRATION,
  validateProduction0075Inputs,
  validateProduction0075Journal,
  validateProduction0075RepositoryBand,
  validateProduction0075RepositoryEntry,
  type Apollo0075SchemaState,
} from "./production-migration-0075-contract";

const projectRef = "klrugedztqxlvyghyzxs";
const base = {
  projectRef,
  backupReceipt: "pitr-receipt-2026-08-31",
  confirmation: HRMNY_PRODUCTION_0075_CONFIRMATION,
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
    input.query === null
      ? ""
      : `?${input.query ?? "sslmode=verify-full"}`;
  return `${"postgresql"}://${credentials}@${input.host}:${input.port ?? 5432}/${input.database ?? "postgres"}${query}`;
}

const absentSchema: Apollo0075SchemaState = {
  priorContractReady: true,
  namedColumnsPresent: 0,
  correctColumns: 0,
  namedConstraintsPresent: 0,
  correctConstraints: 0,
  namedIndexesPresent: 0,
  correctIndexes: 0,
  securedTables: 1,
  backfillViolations: 0,
};

const verifiedSchema: Apollo0075SchemaState = {
  priorContractReady: true,
  namedColumnsPresent: 9,
  correctColumns: 9,
  namedConstraintsPresent: 3,
  correctConstraints: 3,
  namedIndexesPresent: 2,
  correctIndexes: 2,
  securedTables: 2,
  backfillViolations: 0,
};

const exactPrefix = {
  legacyFingerprint: HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint,
  oldTailCount: 7,
  actualOldTailFingerprint: "exact-0068-0074-tail",
  expectedOldTailFingerprint: "exact-0068-0074-tail",
};

describe("production migration 0075 target lock", () => {
  it("accepts the real journal entry shape while pinning tag and timestamp", () => {
    expect(() =>
      validateProduction0075RepositoryEntry({
        idx: 74,
        version: "7",
        when: 1788168448556,
        tag: "0075_apollo_search_fencing",
        breakpoints: true,
      }),
    ).not.toThrow();
    expect(() =>
      validateProduction0075RepositoryEntry({
        when: 1788168448557,
        tag: "0075_apollo_search_fencing",
      }),
    ).toThrow(/journal entry/i);
  });

  it("rejects any unreviewed repository migration inside the apply band", () => {
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
    ];
    expect(() => validateProduction0075RepositoryBand(reviewed)).not.toThrow();
    expect(() =>
      validateProduction0075RepositoryBand([
        ...reviewed.slice(0, -1),
        { tag: "unreviewed", when: 1788000000000 },
        reviewed.at(-1)!,
      ]),
    ).toThrow(/exactly reviewed/i);
  });

  it("accepts only the exact direct HRMNY project identity", () => {
    expect(
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          host: `db.${projectRef}.supabase.co`,
        }),
      }),
    ).toMatchObject({ projectRef, targetKind: "direct" });
  });

  it("accepts the exact documented session-pooler identity", () => {
    expect(
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: `postgres.${projectRef}`,
          host: "aws-0-eu-central-1.pooler.supabase.com",
        }),
      }).targetKind,
    ).toBe("session_pooler");
  });

  it("rejects embedded refs, wrong users, transaction ports, and wrong databases", () => {
    const urls = [
      syntheticDatabaseUrl({
        user: `postgres.${projectRef}`,
        host: "untrusted.example",
      }),
      syntheticDatabaseUrl({
        user: `postgres.${projectRef}`,
        host: "evil.pooler.supabase.com",
      }),
      syntheticDatabaseUrl({
        user: "wrong",
        host: `db.${projectRef}.supabase.co`,
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
    ];
    for (const databaseUrl of urls) {
      expect(() =>
        validateProduction0075Inputs({ ...base, databaseUrl }),
      ).toThrow();
    }
  });

  it("requires an exact phrase, backup receipt, and credential", () => {
    const databaseUrl = syntheticDatabaseUrl({
      user: "postgres",
      host: `db.${projectRef}.supabase.co`,
    });
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl,
        confirmation: "yes",
      }),
    ).toThrow(/confirmation/i);
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl,
        backupReceipt: "",
      }),
    ).toThrow(/backup|PITR/i);
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          password: null,
          host: `db.${projectRef}.supabase.co`,
        }),
      }),
    ).toThrow(/credentials/i);
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          host: `db.${projectRef}.supabase.co`,
          query: null,
        }),
      }),
    ).toThrow(/TLS|sslmode/i);
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          host: `db.${projectRef}.supabase.co`,
          query: "sslmode=disable",
        }),
      }),
    ).toThrow(/TLS|sslmode/i);
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          host: `db.${projectRef}.supabase.co`,
          query: "sslmode=require",
        }),
      }),
    ).toThrow(/TLS|sslmode/i);
    expect(() =>
      validateProduction0075Inputs({
        ...base,
        databaseUrl: syntheticDatabaseUrl({
          user: "postgres",
          host: `db.${projectRef}.supabase.co`,
          query: "sslmode=verify-full&sslmode=disable",
        }),
      }),
    ).toThrow(/TLS|sslmode/i);
  });
});

describe("production migration 0075 journal and readback lock", () => {
  it("accepts only the exact 0074 prefix with no partial 0075 schema", () => {
    expect(
      validateProduction0075Journal({
        phase: "preflight",
        count: 77,
        head: "1787947200000",
        ...exactPrefix,
        migrationCount: 0,
        migrationHash: null,
        schema: absentSchema,
      }),
    ).toMatchObject({
      fromTag: "0074_integration_inbox_invoice_metadata",
      toTag: "0075_apollo_search_fencing",
      migrationsToApply: 1,
    });
  });

  it("rejects journal drift and partially present 0075 objects", () => {
    const preflight = {
      phase: "preflight" as const,
      count: 77,
      head: "1787947200000",
      ...exactPrefix,
      migrationCount: 0,
      migrationHash: null,
      schema: absentSchema,
    };
    expect(() =>
      validateProduction0075Journal({
        ...preflight,
        actualOldTailFingerprint: "changed",
      }),
    ).toThrow(/0068-0074/i);
    expect(() =>
      validateProduction0075Journal({
        ...preflight,
        schema: { ...absentSchema, namedColumnsPresent: 1 },
      }),
    ).toThrow(/partially|reconcile/i);
    expect(() =>
      validateProduction0075Journal({
        ...preflight,
        schema: { ...absentSchema, backfillViolations: 1 },
      }),
    ).toThrow(/backfill|reconcile/i);
  });

  it("accepts only an exact 0075 journal row and complete readback", () => {
    expect(
      validateProduction0075Journal({
        phase: "verify",
        count: 78,
        head: HRMNY_PRODUCTION_0075_MIGRATION.createdAt,
        ...exactPrefix,
        migrationCount: 1,
        migrationHash: HRMNY_PRODUCTION_0075_MIGRATION.hash,
        schema: verifiedSchema,
      }),
    ).toMatchObject({ migrationsToApply: 0 });
  });

  it("rejects a wrong migration hash, constraint, security, or backfill", () => {
    const verify = {
      phase: "verify" as const,
      count: 78,
      head: HRMNY_PRODUCTION_0075_MIGRATION.createdAt,
      ...exactPrefix,
      migrationCount: 1,
      migrationHash: HRMNY_PRODUCTION_0075_MIGRATION.hash,
      schema: verifiedSchema,
    };
    expect(() =>
      validateProduction0075Journal({ ...verify, migrationHash: "wrong" }),
    ).toThrow(/exact reviewed 0075/i);
    expect(() =>
      validateProduction0075Journal({
        ...verify,
        schema: { ...verifiedSchema, correctConstraints: 2 },
      }),
    ).toThrow(/readback/i);
    expect(() =>
      validateProduction0075Journal({
        ...verify,
        schema: { ...verifiedSchema, securedTables: 1 },
      }),
    ).toThrow(/readback/i);
    expect(() =>
      validateProduction0075Journal({
        ...verify,
        schema: { ...verifiedSchema, backfillViolations: 1 },
      }),
    ).toThrow(/readback/i);
  });
});

import { describe, expect, it } from "vitest";
import {
  HRMNY_PRODUCTION_0075_TO_0077_BAND,
  HRMNY_PRODUCTION_0075_TO_0077_CONFIRMATION,
  validateProduction0075To0077Inputs,
  validateProduction0075To0077Journal,
  validateProduction0075To0077RepositoryBand,
} from "./production-migration-0075-0077-contract";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
  HRMNY_PRODUCTION_PROJECT_REF,
} from "./production-migration-contract";

const databaseUrl =
  `postgresql://postgres.${HRMNY_PRODUCTION_PROJECT_REF}:secret` +
  "@aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";
const exactPrefix = {
  legacyFingerprint: HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint,
  oldTailCount: 7,
  actualOldTailFingerprint: "exact-0068-0074-tail",
  expectedOldTailFingerprint: "exact-0068-0074-tail",
};

describe("production 0075-0077 runner contract", () => {
  it("keeps audit read-only and requires receipts for an apply preflight", () => {
    expect(
      validateProduction0075To0077Inputs({
        phase: "audit",
        databaseUrl,
        projectRef: HRMNY_PRODUCTION_PROJECT_REF,
        backupReceipt: undefined,
        runtimeReceipt: undefined,
        confirmation: undefined,
      }).targetKind,
    ).toBe("session_pooler");

    const apply = {
      phase: "preflight" as const,
      databaseUrl,
      projectRef: HRMNY_PRODUCTION_PROJECT_REF,
      backupReceipt: "fresh-backup-receipt",
      runtimeReceipt: "vercel-runtime-receipt",
      confirmation: HRMNY_PRODUCTION_0075_TO_0077_CONFIRMATION,
    };
    expect(() => validateProduction0075To0077Inputs(apply)).not.toThrow();
    expect(() =>
      validateProduction0075To0077Inputs({ ...apply, backupReceipt: "" }),
    ).toThrow(/fresh backup|PITR/i);
    expect(() =>
      validateProduction0075To0077Inputs({ ...apply, confirmation: "yes" }),
    ).toThrow(/confirmation/i);
  });

  it("pins the repository and production journal to the exact additive band", () => {
    const repository = [
      {
        tag: "legacy",
        when: Number(HRMNY_PRODUCTION_LEGACY_BASELINE.createdAt),
      },
      ...HRMNY_PRODUCTION_MIGRATION_BAND.map(({ tag, createdAt }) => ({
        tag,
        when: Number(createdAt),
      })),
      ...HRMNY_PRODUCTION_0075_TO_0077_BAND.map(({ tag, createdAt }) => ({
        tag,
        when: Number(createdAt),
      })),
    ];
    expect(() =>
      validateProduction0075To0077RepositoryBand(repository),
    ).not.toThrow();
    expect(() =>
      validateProduction0075To0077RepositoryBand([
        ...repository,
        { tag: "unreviewed", when: 1788322190001 },
      ]),
    ).toThrow(/exactly reviewed/i);

    expect(
      validateProduction0075To0077Journal({
        phase: "preflight",
        count: 77,
        head: "1787947200000",
        migrationRows: [],
        ...exactPrefix,
      }),
    ).toMatchObject({ migrationsToApply: 3, legacyRowsPreserved: 70 });
    expect(
      validateProduction0075To0077Journal({
        phase: "verify",
        count: 80,
        head: "1788322190000",
        migrationRows: HRMNY_PRODUCTION_0075_TO_0077_BAND.map(
          ({ createdAt, hash }) => ({ created_at: createdAt, hash }),
        ),
        ...exactPrefix,
      }),
    ).toMatchObject({ migrationsToApply: 0, legacyRowsPreserved: 70 });
    expect(() =>
      validateProduction0075To0077Journal({
        phase: "verify",
        count: 80,
        head: "1788322190000",
        migrationRows: HRMNY_PRODUCTION_0075_TO_0077_BAND.map(
          ({ createdAt, hash }, index) => ({
            created_at: createdAt,
            hash: index === 2 ? "drifted" : hash,
          }),
        ),
        ...exactPrefix,
      }),
    ).toThrow(/exact reviewed 0075-0077/i);
  });
});

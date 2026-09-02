import {
  HRMNY_PRODUCTION_0075_MIGRATION,
  validateProduction0075Target,
  type ValidatedProduction0075Target,
} from "./production-migration-0075-contract";
import { HRMNY_PRODUCTION_0076_MIGRATION } from "./production-migration-0076-contract";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
} from "./production-migration-contract";

export const HRMNY_PRODUCTION_0075_TO_0077_CONFIRMATION =
  "APPLY MIGRATIONS 0075 THROUGH 0077 TO HRMNY PRODUCTION";

export const HRMNY_PRODUCTION_0077_MIGRATION = {
  count: 1,
  createdAt: "1788322190000",
  hash: "e27f6b87903a856885719489385d221766623ef64914686fecfc2a246e02ae38",
  tag: "0077_qm_control_repository" as const,
};

export const HRMNY_PRODUCTION_0075_TO_0077_BAND = [
  HRMNY_PRODUCTION_0075_MIGRATION,
  HRMNY_PRODUCTION_0076_MIGRATION,
  HRMNY_PRODUCTION_0077_MIGRATION,
] as const;

export type Production0075To0077Phase = "audit" | "preflight" | "verify";

export type Production0075To0077Inputs = {
  phase: Production0075To0077Phase;
  databaseUrl: string | undefined;
  projectRef: string | undefined;
  backupReceipt: string | undefined;
  runtimeReceipt: string | undefined;
  confirmation: string | undefined;
};

export type Production0075To0077JournalRow = {
  created_at: string;
  hash: string;
};

export function validateProduction0075To0077Inputs(
  input: Production0075To0077Inputs,
): ValidatedProduction0075Target {
  const target = validateProduction0075Target(input);
  if (input.phase === "audit") return target;
  if (input.confirmation !== HRMNY_PRODUCTION_0075_TO_0077_CONFIRMATION) {
    throw new Error(
      "Exact 0075-0077 production confirmation phrase is missing.",
    );
  }
  if ((input.backupReceipt?.trim().length ?? 0) < 8) {
    throw new Error("A fresh backup or PITR receipt reference is required.");
  }
  if ((input.runtimeReceipt?.trim().length ?? 0) < 8) {
    throw new Error("A deployed compatible-runtime receipt is required.");
  }
  return target;
}

export function validateProduction0075To0077RepositoryBand(
  entries: Array<{ tag: string; when: number }>,
): void {
  const actual = entries
    .filter(
      ({ when }) =>
        BigInt(when) > BigInt(HRMNY_PRODUCTION_LEGACY_BASELINE.createdAt),
    )
    .map(({ tag, when }) => ({ tag, createdAt: String(when) }));
  const expected = [
    ...HRMNY_PRODUCTION_MIGRATION_BAND,
    ...HRMNY_PRODUCTION_0075_TO_0077_BAND,
  ];
  if (
    actual.length !== expected.length ||
    actual.some(
      (entry, index) =>
        entry.tag !== expected[index]?.tag ||
        entry.createdAt !== expected[index]?.createdAt,
    )
  ) {
    throw new Error(
      "Repository migration band is not exactly reviewed 0068-0077.",
    );
  }
}

export function validateProduction0075To0077Journal(input: {
  phase: Production0075To0077Phase;
  count: number;
  head: string | null;
  legacyFingerprint: string;
  oldTailCount: number;
  actualOldTailFingerprint: string;
  expectedOldTailFingerprint: string;
  migrationRows: Production0075To0077JournalRow[];
}): { migrationsToApply: 0 | 3; legacyRowsPreserved: number } {
  if (
    input.legacyFingerprint !== HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint
  ) {
    throw new Error(
      "The immutable 70-row production baseline fingerprint drifted.",
    );
  }
  if (
    input.oldTailCount !== HRMNY_PRODUCTION_MIGRATION_BAND.length ||
    input.actualOldTailFingerprint !== input.expectedOldTailFingerprint
  ) {
    throw new Error("The exact reviewed 0068-0074 journal tail drifted.");
  }

  if (input.phase !== "verify") {
    if (
      input.count !==
        HRMNY_PRODUCTION_LEGACY_BASELINE.count +
          HRMNY_PRODUCTION_MIGRATION_BAND.length ||
      input.head !== HRMNY_PRODUCTION_MIGRATION_BAND.at(-1)?.createdAt ||
      input.migrationRows.length !== 0
    ) {
      throw new Error("Production is not at the exact reviewed 0074 head.");
    }
    return {
      migrationsToApply: 3,
      legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
    };
  }

  if (
    input.count !==
      HRMNY_PRODUCTION_LEGACY_BASELINE.count +
        HRMNY_PRODUCTION_MIGRATION_BAND.length +
        HRMNY_PRODUCTION_0075_TO_0077_BAND.length ||
    input.head !== HRMNY_PRODUCTION_0077_MIGRATION.createdAt ||
    input.migrationRows.length !== HRMNY_PRODUCTION_0075_TO_0077_BAND.length ||
    input.migrationRows.some(
      (row, index) =>
        row.created_at !==
          HRMNY_PRODUCTION_0075_TO_0077_BAND[index]?.createdAt ||
        row.hash !== HRMNY_PRODUCTION_0075_TO_0077_BAND[index]?.hash,
    )
  ) {
    throw new Error(
      "Production did not append the exact reviewed 0075-0077 band.",
    );
  }
  return {
    migrationsToApply: 0,
    legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
  };
}

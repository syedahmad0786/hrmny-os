import { HRMNY_PRODUCTION_0075_MIGRATION } from "./production-migration-0075-contract";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
  HRMNY_PRODUCTION_PROJECT_REF,
} from "./production-migration-contract";

export const HRMNY_PRODUCTION_0076_CONFIRMATION =
  "APPLY MIGRATION 0076 APOLLO PEOPLE SEARCH SERIALIZATION TO HRMNY PRODUCTION";
export const HRMNY_PRODUCTION_0076_MAINTENANCE_CONFIRMATION =
  "KEEP APOLLO PEOPLE SEARCH QUIESCED UNTIL THE NEW RUNTIME IS VALIDATED";

export const HRMNY_PRODUCTION_0075_HEAD = {
  count:
    HRMNY_PRODUCTION_LEGACY_BASELINE.count +
    HRMNY_PRODUCTION_MIGRATION_BAND.length +
    HRMNY_PRODUCTION_0075_MIGRATION.count,
  createdAt: HRMNY_PRODUCTION_0075_MIGRATION.createdAt,
  hash: HRMNY_PRODUCTION_0075_MIGRATION.hash,
  tag: HRMNY_PRODUCTION_0075_MIGRATION.tag,
};

export const HRMNY_PRODUCTION_0076_MIGRATION = {
  count: 1,
  createdAt: "1788283943222",
  hash: "4941903ab873fabbb4a7359a83b95a48daee1df9eddae9ba38fa3cfb78bd68a7",
  tag: "0076_apollo_people_search_serialization" as const,
};

export type Production0076Phase = "preflight" | "verify";

export type Production0076Inputs = {
  databaseUrl: string | undefined;
  projectRef: string | undefined;
  backupReceipt: string | undefined;
  quiescenceReceipt: string | undefined;
  confirmation: string | undefined;
  maintenanceConfirmation: string | undefined;
};

export type ValidatedProduction0076Target = {
  databaseUrl: URL;
  projectRef: typeof HRMNY_PRODUCTION_PROJECT_REF;
  targetKind: "direct" | "session_pooler";
};

export type Apollo0076SchemaState = {
  priorContractReady: boolean;
  namedColumnsPresent: number;
  correctColumns: number;
  namedChecksPresent: number;
  correctChecks: number;
  namedIndexesPresent: number;
  correctIndexes: number;
  namedFunctionsPresent: number;
  correctFunctions: number;
  namedTriggersPresent: number;
  correctTriggers: number;
  securedTables: number;
  runningApolloJobs: number;
  backfillViolations: number;
  duplicateRunningSlots: number;
};

export type ValidatedProduction0076Journal = {
  phase: Production0076Phase;
  fromTag:
    | typeof HRMNY_PRODUCTION_0075_HEAD.tag
    | typeof HRMNY_PRODUCTION_0076_MIGRATION.tag;
  toTag: typeof HRMNY_PRODUCTION_0076_MIGRATION.tag;
  migrationsToApply: 0 | 1;
  legacyRowsPreserved: number;
};

export function validateProduction0076RepositoryEntry(
  entry: {
    tag?: unknown;
    when?: unknown;
    [key: string]: unknown;
  } | null,
): void {
  if (
    entry?.tag !== HRMNY_PRODUCTION_0076_MIGRATION.tag ||
    String(entry.when) !== HRMNY_PRODUCTION_0076_MIGRATION.createdAt
  ) {
    throw new Error("Repository journal entry for 0076 drifted.");
  }
}

export function validateProduction0076RepositoryBand(
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
    {
      tag: HRMNY_PRODUCTION_0075_MIGRATION.tag,
      createdAt: HRMNY_PRODUCTION_0075_MIGRATION.createdAt,
    },
    {
      tag: HRMNY_PRODUCTION_0076_MIGRATION.tag,
      createdAt: HRMNY_PRODUCTION_0076_MIGRATION.createdAt,
    },
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
      "Repository migration band is not exactly reviewed 0068-0076.",
    );
  }
}

/** Lock the manual 0076 runner to exact Supabase direct/session-pooler forms. */
export function validateProduction0076Inputs(
  input: Production0076Inputs,
): ValidatedProduction0076Target {
  if (input.projectRef !== HRMNY_PRODUCTION_PROJECT_REF) {
    throw new Error("Canonical HRMNY Supabase project ref was not confirmed.");
  }
  if (input.confirmation !== HRMNY_PRODUCTION_0076_CONFIRMATION) {
    throw new Error("Exact 0076 production confirmation phrase is missing.");
  }
  if (
    input.maintenanceConfirmation !==
    HRMNY_PRODUCTION_0076_MAINTENANCE_CONFIRMATION
  ) {
    throw new Error(
      "Apollo People Search must remain quiesced until the new runtime is validated.",
    );
  }
  const backupReceipt = input.backupReceipt?.trim();
  if (!backupReceipt || backupReceipt.length < 8) {
    throw new Error("A backup or PITR receipt reference is required.");
  }
  const quiescenceReceipt = input.quiescenceReceipt?.trim();
  if (!quiescenceReceipt || quiescenceReceipt.length < 8) {
    throw new Error(
      "A receipt proving old Apollo People Search workers are drained and disabled is required.",
    );
  }
  const rawUrl = input.databaseUrl?.trim();
  if (!rawUrl) {
    throw new Error("HRMNY_PRODUCTION_DATABASE_URL is not configured.");
  }

  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawUrl);
  } catch {
    throw new Error("HRMNY_PRODUCTION_DATABASE_URL is not a valid URL.");
  }
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol)) {
    throw new Error("Production migration target must be PostgreSQL.");
  }
  if (!databaseUrl.password) {
    throw new Error("Production migration target credentials are incomplete.");
  }
  if ((databaseUrl.port || "5432") !== "5432") {
    throw new Error(
      "Use the direct or Supavisor session connection on port 5432; transaction pooling is refused.",
    );
  }
  if (
    decodeURIComponent(databaseUrl.pathname).replace(/^\//, "") !== "postgres"
  ) {
    throw new Error("Production migration target database must be postgres.");
  }
  const sslModes = databaseUrl.searchParams.getAll("sslmode");
  const sslMode = sslModes[0]?.toLowerCase();
  if (sslModes.length !== 1 || sslMode !== "verify-full") {
    throw new Error(
      "Production migration target must authenticate TLS with sslmode=verify-full.",
    );
  }

  const hostname = databaseUrl.hostname.toLowerCase();
  const username = decodeURIComponent(databaseUrl.username).toLowerCase();
  const direct =
    hostname === `db.${HRMNY_PRODUCTION_PROJECT_REF}.supabase.co` &&
    username === "postgres";
  const sessionPooler =
    /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname) &&
    username === `postgres.${HRMNY_PRODUCTION_PROJECT_REF}`;
  if (!direct && !sessionPooler) {
    throw new Error(
      "Database URL is not an exact canonical HRMNY direct or session-pooler target.",
    );
  }

  return {
    databaseUrl,
    projectRef: HRMNY_PRODUCTION_PROJECT_REF,
    targetKind: direct ? "direct" : "session_pooler",
  };
}

function assertExact0075Prefix(input: {
  legacyFingerprint: string | undefined;
  oldTailCount: number | undefined;
  actualOldTailFingerprint: string | undefined;
  expectedOldTailFingerprint: string | undefined;
  priorMigrationCount: number | undefined;
  priorMigrationHash: string | null | undefined;
}): void {
  if (
    input.legacyFingerprint !== HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint
  ) {
    throw new Error(
      "The immutable 70-row production baseline fingerprint drifted.",
    );
  }
  if (
    input.oldTailCount !== HRMNY_PRODUCTION_MIGRATION_BAND.length ||
    !input.expectedOldTailFingerprint ||
    input.actualOldTailFingerprint !== input.expectedOldTailFingerprint
  ) {
    throw new Error("The exact reviewed 0068-0074 journal tail drifted.");
  }
  if (
    input.priorMigrationCount !== HRMNY_PRODUCTION_0075_MIGRATION.count ||
    input.priorMigrationHash !== HRMNY_PRODUCTION_0075_MIGRATION.hash
  ) {
    throw new Error("The exact reviewed 0075 production head drifted.");
  }
}

export function validateProduction0076Journal(input: {
  phase: Production0076Phase;
  count: number | undefined;
  head: string | null | undefined;
  legacyFingerprint: string | undefined;
  oldTailCount: number | undefined;
  actualOldTailFingerprint: string | undefined;
  expectedOldTailFingerprint: string | undefined;
  priorMigrationCount: number | undefined;
  priorMigrationHash: string | null | undefined;
  migrationCount: number | undefined;
  migrationHash: string | null | undefined;
  schema: Apollo0076SchemaState | undefined;
}): ValidatedProduction0076Journal {
  assertExact0075Prefix(input);
  if (!input.schema) throw new Error("0076 schema discovery is missing.");
  if (!input.schema.priorContractReady) {
    throw new Error("The reviewed 0075 production contract is not intact.");
  }
  if (input.schema.securedTables !== 1) {
    throw new Error("The scheduled-job browser security boundary drifted.");
  }

  if (input.phase === "preflight") {
    if (
      input.count !== HRMNY_PRODUCTION_0075_HEAD.count ||
      input.head !== HRMNY_PRODUCTION_0075_HEAD.createdAt ||
      input.migrationCount !== 0 ||
      input.migrationHash !== null
    ) {
      throw new Error("Production is not at the exact reviewed 0075 head.");
    }
    if (
      input.schema.namedColumnsPresent !== 0 ||
      input.schema.correctColumns !== 0 ||
      input.schema.namedChecksPresent !== 0 ||
      input.schema.correctChecks !== 0 ||
      input.schema.namedIndexesPresent !== 0 ||
      input.schema.correctIndexes !== 0 ||
      input.schema.namedFunctionsPresent !== 0 ||
      input.schema.correctFunctions !== 0 ||
      input.schema.namedTriggersPresent !== 0 ||
      input.schema.correctTriggers !== 0
    ) {
      throw new Error(
        "Migration 0076 is partially present; stop and reconcile.",
      );
    }
    if (
      input.schema.runningApolloJobs !== 0 ||
      input.schema.backfillViolations !== 0 ||
      input.schema.duplicateRunningSlots !== 0
    ) {
      throw new Error(
        "Apollo People Search work is running or cannot be serialized safely; wait for a zero-running preflight.",
      );
    }
    return {
      phase: input.phase,
      fromTag: HRMNY_PRODUCTION_0075_HEAD.tag,
      toTag: HRMNY_PRODUCTION_0076_MIGRATION.tag,
      migrationsToApply: 1,
      legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
    };
  }

  if (
    input.count !== HRMNY_PRODUCTION_0075_HEAD.count + 1 ||
    input.head !== HRMNY_PRODUCTION_0076_MIGRATION.createdAt ||
    input.migrationCount !== HRMNY_PRODUCTION_0076_MIGRATION.count ||
    input.migrationHash !== HRMNY_PRODUCTION_0076_MIGRATION.hash
  ) {
    throw new Error("Production did not append the exact reviewed 0076 row.");
  }
  if (
    input.schema.namedColumnsPresent !== 1 ||
    input.schema.correctColumns !== 1 ||
    input.schema.namedChecksPresent !== 1 ||
    input.schema.correctChecks !== 1 ||
    input.schema.namedIndexesPresent !== 1 ||
    input.schema.correctIndexes !== 1 ||
    input.schema.namedFunctionsPresent !== 1 ||
    input.schema.correctFunctions !== 1 ||
    input.schema.namedTriggersPresent !== 1 ||
    input.schema.correctTriggers !== 1 ||
    input.schema.backfillViolations !== 0 ||
    input.schema.duplicateRunningSlots !== 0 ||
    input.schema.runningApolloJobs !== 0
  ) {
    throw new Error(
      "Production 0076 schema, serialization, security, or backfill readback failed.",
    );
  }
  return {
    phase: input.phase,
    fromTag: HRMNY_PRODUCTION_0076_MIGRATION.tag,
    toTag: HRMNY_PRODUCTION_0076_MIGRATION.tag,
    migrationsToApply: 0,
    legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
  };
}

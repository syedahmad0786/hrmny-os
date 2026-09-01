import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
  HRMNY_PRODUCTION_PROJECT_REF,
} from "./production-migration-contract";

export const HRMNY_PRODUCTION_0075_CONFIRMATION =
  "APPLY MIGRATION 0075 APOLLO SEARCH FENCING TO HRMNY PRODUCTION";

export const HRMNY_PRODUCTION_0074_HEAD = {
  count:
    HRMNY_PRODUCTION_LEGACY_BASELINE.count +
    HRMNY_PRODUCTION_MIGRATION_BAND.length,
  createdAt: "1787947200000",
  tag: "0074_integration_inbox_invoice_metadata" as const,
};

export const HRMNY_PRODUCTION_0075_MIGRATION = {
  count: 1,
  createdAt: "1788168448556",
  hash: "8bae97228f848fde220193d8783672636670940dcb59e39bd5f98ef05212f201",
  tag: "0075_apollo_search_fencing" as const,
};

export type Production0075Phase = "preflight" | "verify";

export type Production0075Inputs = {
  databaseUrl: string | undefined;
  projectRef: string | undefined;
  backupReceipt: string | undefined;
  confirmation: string | undefined;
};

export type ValidatedProduction0075Target = {
  databaseUrl: URL;
  projectRef: typeof HRMNY_PRODUCTION_PROJECT_REF;
  targetKind: "direct" | "session_pooler";
};

export type Apollo0075SchemaState = {
  priorContractReady: boolean;
  namedColumnsPresent: number;
  correctColumns: number;
  namedConstraintsPresent: number;
  correctConstraints: number;
  namedIndexesPresent: number;
  correctIndexes: number;
  securedTables: number;
  backfillViolations: number;
};

export type ValidatedProduction0075Journal = {
  phase: Production0075Phase;
  fromTag:
    | typeof HRMNY_PRODUCTION_0074_HEAD.tag
    | typeof HRMNY_PRODUCTION_0075_MIGRATION.tag;
  toTag: typeof HRMNY_PRODUCTION_0075_MIGRATION.tag;
  migrationsToApply: 0 | 1;
  legacyRowsPreserved: number;
};

export function validateProduction0075RepositoryEntry(entry: {
  tag?: unknown;
  when?: unknown;
  [key: string]: unknown;
} | null): void {
  if (
    entry?.tag !== HRMNY_PRODUCTION_0075_MIGRATION.tag ||
    String(entry.when) !== HRMNY_PRODUCTION_0075_MIGRATION.createdAt
  ) {
    throw new Error("Repository journal entry for 0075 drifted.");
  }
}

export function validateProduction0075RepositoryBand(
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
      "Repository migration band is not exactly reviewed 0068-0075.",
    );
  }
}

/**
 * Lock the manual 0075 runner to exact Supabase direct/session-pooler forms.
 * A project ref merely embedded in an arbitrary hostname or username is never
 * sufficient production identity.
 */
export function validateProduction0075Inputs(
  input: Production0075Inputs,
): ValidatedProduction0075Target {
  if (input.projectRef !== HRMNY_PRODUCTION_PROJECT_REF) {
    throw new Error("Canonical HRMNY Supabase project ref was not confirmed.");
  }
  if (input.confirmation !== HRMNY_PRODUCTION_0075_CONFIRMATION) {
    throw new Error("Exact 0075 production confirmation phrase is missing.");
  }
  const backupReceipt = input.backupReceipt?.trim();
  if (!backupReceipt || backupReceipt.length < 8) {
    throw new Error("A backup or PITR receipt reference is required.");
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
  if (
    sslModes.length !== 1 ||
    sslMode !== "verify-full"
  ) {
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

function assertExact0074Prefix(input: {
  legacyFingerprint: string | undefined;
  oldTailCount: number | undefined;
  actualOldTailFingerprint: string | undefined;
  expectedOldTailFingerprint: string | undefined;
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
}

export function validateProduction0075Journal(input: {
  phase: Production0075Phase;
  count: number | undefined;
  head: string | null | undefined;
  legacyFingerprint: string | undefined;
  oldTailCount: number | undefined;
  actualOldTailFingerprint: string | undefined;
  expectedOldTailFingerprint: string | undefined;
  migrationCount: number | undefined;
  migrationHash: string | null | undefined;
  schema: Apollo0075SchemaState | undefined;
}): ValidatedProduction0075Journal {
  assertExact0074Prefix(input);
  if (!input.schema) throw new Error("0075 schema discovery is missing.");
  if (!input.schema.priorContractReady) {
    throw new Error("The reviewed 0074 production contract is not intact.");
  }

  if (input.phase === "preflight") {
    if (
      input.count !== HRMNY_PRODUCTION_0074_HEAD.count ||
      input.head !== HRMNY_PRODUCTION_0074_HEAD.createdAt ||
      input.migrationCount !== 0 ||
      input.migrationHash !== null
    ) {
      throw new Error("Production is not at the exact reviewed 0074 head.");
    }
    if (
      input.schema.namedColumnsPresent !== 0 ||
      input.schema.namedConstraintsPresent !== 0 ||
      input.schema.namedIndexesPresent !== 0 ||
      input.schema.backfillViolations !== 0
    ) {
      throw new Error(
        "Migration 0075 is partially present or its legacy Apollo backfill is unsafe; stop and reconcile.",
      );
    }
    return {
      phase: input.phase,
      fromTag: HRMNY_PRODUCTION_0074_HEAD.tag,
      toTag: HRMNY_PRODUCTION_0075_MIGRATION.tag,
      migrationsToApply: 1,
      legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
    };
  }

  if (
    input.count !== HRMNY_PRODUCTION_0074_HEAD.count + 1 ||
    input.head !== HRMNY_PRODUCTION_0075_MIGRATION.createdAt ||
    input.migrationCount !== 1 ||
    input.migrationHash !== HRMNY_PRODUCTION_0075_MIGRATION.hash
  ) {
    throw new Error("Production did not append the exact reviewed 0075 row.");
  }
  if (
    input.schema.namedColumnsPresent !== 9 ||
    input.schema.correctColumns !== 9 ||
    input.schema.namedConstraintsPresent !== 3 ||
    input.schema.correctConstraints !== 3 ||
    input.schema.namedIndexesPresent !== 2 ||
    input.schema.correctIndexes !== 2 ||
    input.schema.securedTables !== 2 ||
    input.schema.backfillViolations !== 0
  ) {
    throw new Error(
      "Production 0075 schema, fencing, security, or backfill readback failed.",
    );
  }
  return {
    phase: input.phase,
    fromTag: HRMNY_PRODUCTION_0075_MIGRATION.tag,
    toTag: HRMNY_PRODUCTION_0075_MIGRATION.tag,
    migrationsToApply: 0,
    legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
  };
}

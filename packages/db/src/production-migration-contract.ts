export const HRMNY_PRODUCTION_PROJECT_REF = "klrugedztqxlvyghyzxs";
export const HRMNY_PRODUCTION_MIGRATION_CONFIRMATION =
  "APPLY ADDITIVE MIGRATIONS 0068 THROUGH 0074 TO HRMNY PRODUCTION";

export const HRMNY_PRODUCTION_LEGACY_BASELINE = {
  count: 70,
  createdAt: "1785182400000",
  fingerprint:
    "cc60d88830c9f5d749ac6f3136ee769bf9275652b47bd8cc27b87e0651b3affd",
  tag: "legacy_0070_m1_production_readiness" as const,
};

export const HRMNY_PRODUCTION_MIGRATION_BAND = [
  { tag: "0068_os_modules", createdAt: "1787284800000" },
  { tag: "0069_seam_outbox", createdAt: "1787298000000" },
  { tag: "0070_portal_magic_token", createdAt: "1787306400000" },
  { tag: "0071_portal_session_grant", createdAt: "1787310000000" },
  { tag: "0072_sales_os", createdAt: "1787673600000" },
  { tag: "0073_connections_app_policy", createdAt: "1787860800000" },
  {
    tag: "0074_integration_inbox_invoice_metadata",
    createdAt: "1787947200000",
  },
] as const;

export type ProductionMigrationInputs = {
  databaseUrl: string | undefined;
  projectRef: string | undefined;
  backupReceipt: string | undefined;
  confirmation: string | undefined;
};

export type ValidatedProductionMigrationTarget = {
  databaseUrl: URL;
  projectRef: typeof HRMNY_PRODUCTION_PROJECT_REF;
  targetKind: "direct" | "session_pooler";
};

export type ProductionMigrationPhase = "preflight" | "verify";

export type ReconciledProductionSchema = {
  crm_quote: boolean;
  inbound_lane: boolean;
  client_onboarding: boolean;
  legacy_readiness: boolean;
};

export type ValidatedProductionMigrationJournal = {
  phase: ProductionMigrationPhase;
  fromTag:
    | typeof HRMNY_PRODUCTION_LEGACY_BASELINE.tag
    | "0074_integration_inbox_invoice_metadata";
  toTag: "0074_integration_inbox_invoice_metadata";
  migrationsToApply: number;
  legacyRowsPreserved: number;
};

const upgradedProductionHead = {
  count:
    HRMNY_PRODUCTION_LEGACY_BASELINE.count +
    HRMNY_PRODUCTION_MIGRATION_BAND.length,
  createdAt: "1787947200000",
  tag: "0074_integration_inbox_invoice_metadata" as const,
};

/**
 * Fail closed before any production connection. The URL is returned only to
 * the server-side runner and must never be logged.
 */
export function validateProductionMigrationInputs(
  input: ProductionMigrationInputs,
): ValidatedProductionMigrationTarget {
  if (input.projectRef !== HRMNY_PRODUCTION_PROJECT_REF) {
    throw new Error("Canonical HRMNY Supabase project ref was not confirmed.");
  }
  if (input.confirmation !== HRMNY_PRODUCTION_MIGRATION_CONFIRMATION) {
    throw new Error(
      "Exact production migration confirmation phrase is missing.",
    );
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
  const hostname = databaseUrl.hostname.toLowerCase();
  const username = decodeURIComponent(databaseUrl.username).toLowerCase();
  if (
    !hostname.includes(HRMNY_PRODUCTION_PROJECT_REF) &&
    !username.includes(HRMNY_PRODUCTION_PROJECT_REF)
  ) {
    throw new Error(
      "Database URL does not resolve to the canonical HRMNY project.",
    );
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

  return {
    databaseUrl,
    projectRef: HRMNY_PRODUCTION_PROJECT_REF,
    targetKind: hostname.startsWith("db.") ? "direct" : "session_pooler",
  };
}

function assertReconciledSchema(
  schema: ReconciledProductionSchema | undefined,
): void {
  if (!schema || Object.values(schema).some((present) => present !== true)) {
    throw new Error(
      "Legacy production schema does not satisfy the reconciled bridge contract.",
    );
  }
}

/**
 * The canonical database has a legitimate 70-row legacy journal whose final
 * five entries predate the current repository names. Never rewrite those
 * rows. Accept only its observed immutable fingerprint, then prove that the
 * exact repository hashes for 0068-0074 were appended.
 */
export function validateProductionMigrationJournal(input: {
  phase: ProductionMigrationPhase;
  count: number | undefined;
  head: string | null | undefined;
  inbox: boolean | undefined;
  legacyFingerprint: string | undefined;
  tailCount: number | undefined;
  actualTailFingerprint: string | undefined;
  expectedTailFingerprint: string | undefined;
  reconciledSchema: ReconciledProductionSchema | undefined;
}): ValidatedProductionMigrationJournal {
  assertReconciledSchema(input.reconciledSchema);

  if (
    input.legacyFingerprint !== HRMNY_PRODUCTION_LEGACY_BASELINE.fingerprint
  ) {
    throw new Error(
      "The immutable 70-row production baseline fingerprint drifted.",
    );
  }

  if (input.phase === "verify") {
    if (
      input.count !== upgradedProductionHead.count ||
      input.head !== upgradedProductionHead.createdAt ||
      input.inbox !== true ||
      input.tailCount !== HRMNY_PRODUCTION_MIGRATION_BAND.length ||
      !input.expectedTailFingerprint ||
      input.actualTailFingerprint !== input.expectedTailFingerprint
    ) {
      throw new Error(
        "Production verification did not preserve the legacy baseline and append the exact 0068-0074 journal tail.",
      );
    }
    return {
      phase: input.phase,
      fromTag: upgradedProductionHead.tag,
      toTag: upgradedProductionHead.tag,
      migrationsToApply: 0,
      legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
    };
  }

  if (input.inbox !== false) {
    throw new Error(
      "Migration 0074 already appears present; stop and reconcile before rerunning.",
    );
  }
  if (
    input.count !== HRMNY_PRODUCTION_LEGACY_BASELINE.count ||
    input.head !== HRMNY_PRODUCTION_LEGACY_BASELINE.createdAt ||
    input.tailCount !== 0
  ) {
    throw new Error(
      "Production is not at the exact 70-row legacy baseline required for the 0068-0074 bridge.",
    );
  }
  return {
    phase: input.phase,
    fromTag: HRMNY_PRODUCTION_LEGACY_BASELINE.tag,
    toTag: upgradedProductionHead.tag,
    migrationsToApply: HRMNY_PRODUCTION_MIGRATION_BAND.length,
    legacyRowsPreserved: HRMNY_PRODUCTION_LEGACY_BASELINE.count,
  };
}

export const HRMNY_PRODUCTION_PROJECT_REF = "klrugedztqxlvyghyzxs";
export const HRMNY_PRODUCTION_MIGRATION_CONFIRMATION =
  "APPLY ADDITIVE MIGRATION 0074 TO HRMNY PRODUCTION";

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

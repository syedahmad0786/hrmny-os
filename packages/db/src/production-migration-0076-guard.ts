import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  HRMNY_PRODUCTION_0075_MIGRATION,
  validateProduction0075RepositoryEntry,
} from "./production-migration-0075-contract";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
} from "./production-migration-contract";
import {
  HRMNY_PRODUCTION_0076_MIGRATION,
  validateProduction0076Inputs,
  validateProduction0076Journal,
  validateProduction0076RepositoryBand,
  validateProduction0076RepositoryEntry,
} from "./production-migration-0076-contract";
import { readApollo0076SchemaState } from "./production-migration-0076-discovery";

const phase = process.env.PRODUCTION_MIGRATION_PHASE;
assert(
  phase === "preflight" || phase === "verify",
  "PRODUCTION_MIGRATION_PHASE must be preflight or verify.",
);

const target = validateProduction0076Inputs({
  databaseUrl: process.env.HRMNY_PRODUCTION_DATABASE_URL,
  projectRef: process.env.HRMNY_PRODUCTION_PROJECT_REF,
  backupReceipt: process.env.HRMNY_PRODUCTION_BACKUP_RECEIPT,
  quiescenceReceipt: process.env.HRMNY_PRODUCTION_QUIESCENCE_RECEIPT,
  confirmation: process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
  maintenanceConfirmation:
    process.env.HRMNY_PRODUCTION_MAINTENANCE_CONFIRMATION,
});

type JournalRow = { created_at: string; hash: string };

function fingerprint(rows: JournalRow[]): string {
  return createHash("sha256")
    .update(
      rows.map(({ created_at, hash }) => `${created_at}:${hash}`).join(","),
    )
    .digest("hex");
}

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
const repositoryJournal = JSON.parse(
  readFileSync(join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };
validateProduction0076RepositoryBand(repositoryJournal.entries);

const repositoryOldBand = HRMNY_PRODUCTION_MIGRATION_BAND.map((expected) => {
  const entry = repositoryJournal.entries.find(
    ({ tag }) => tag === expected.tag,
  );
  assert.equal(
    String(entry?.when),
    expected.createdAt,
    `Repository journal timestamp drifted for ${expected.tag}.`,
  );
  return expected;
});
const repository0075 = repositoryJournal.entries.find(
  ({ tag }) => tag === HRMNY_PRODUCTION_0075_MIGRATION.tag,
);
validateProduction0075RepositoryEntry(repository0075 ?? null);
const repository0076 = repositoryJournal.entries.find(
  ({ tag }) => tag === HRMNY_PRODUCTION_0076_MIGRATION.tag,
);
validateProduction0076RepositoryEntry(repository0076 ?? null);
assert.equal(
  repositoryJournal.entries.at(-1)?.tag,
  HRMNY_PRODUCTION_0076_MIGRATION.tag,
  "0076 is no longer the repository migration head; issue a newly reviewed runner.",
);

function repositoryMigrationHash(tag: string): string {
  return createHash("sha256")
    .update(readFileSync(join(migrationsDirectory, `${tag}.sql`)))
    .digest("hex");
}

const repository0075Hash = repositoryMigrationHash(
  HRMNY_PRODUCTION_0075_MIGRATION.tag,
);
assert.equal(
  repository0075Hash,
  HRMNY_PRODUCTION_0075_MIGRATION.hash,
  "Reviewed 0075 SQL hash drifted.",
);
const repository0076Hash = repositoryMigrationHash(
  HRMNY_PRODUCTION_0076_MIGRATION.tag,
);
assert.equal(
  repository0076Hash,
  HRMNY_PRODUCTION_0076_MIGRATION.hash,
  "Reviewed 0076 SQL hash drifted.",
);

const expectedOldTailRows = repositoryOldBand.map(({ tag, createdAt }) => ({
  created_at: createdAt,
  hash: repositoryMigrationHash(tag),
}));
const expectedOldTailFingerprint = fingerprint(expectedOldTailRows);

const db = postgres(target.databaseUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
  onnotice: () => undefined,
});

try {
  const [identity] = await db<
    Array<{ database_name: string; journal_exists: boolean }>
  >`
    select current_database() as database_name,
           to_regclass('drizzle.__drizzle_migrations') is not null
             as journal_exists
  `;
  assert.equal(
    identity?.database_name,
    "postgres",
    "Unexpected database name.",
  );
  assert.equal(
    identity?.journal_exists,
    true,
    "Drizzle migration journal is missing.",
  );

  const journalRows = await db<JournalRow[]>`
    select created_at::text, hash
    from drizzle.__drizzle_migrations
    order by created_at, id
  `;
  const legacyRows = journalRows.slice(
    0,
    HRMNY_PRODUCTION_LEGACY_BASELINE.count,
  );
  const oldTailStart = HRMNY_PRODUCTION_LEGACY_BASELINE.count;
  const priorMigrationStart =
    oldTailStart + HRMNY_PRODUCTION_MIGRATION_BAND.length;
  const currentMigrationStart =
    priorMigrationStart + HRMNY_PRODUCTION_0075_MIGRATION.count;
  const oldTailRows = journalRows.slice(oldTailStart, priorMigrationStart);
  const priorMigrationRows = journalRows.slice(
    priorMigrationStart,
    currentMigrationStart,
  );
  const migrationRows = journalRows.slice(currentMigrationStart);
  const priorMigrationHash =
    priorMigrationRows.length === HRMNY_PRODUCTION_0075_MIGRATION.count &&
    priorMigrationRows[0]?.created_at ===
      HRMNY_PRODUCTION_0075_MIGRATION.createdAt
      ? (priorMigrationRows[0]?.hash ?? null)
      : null;
  const migrationHash =
    migrationRows.length === HRMNY_PRODUCTION_0076_MIGRATION.count &&
    migrationRows[0]?.created_at === HRMNY_PRODUCTION_0076_MIGRATION.createdAt
      ? (migrationRows[0]?.hash ?? null)
      : null;

  const schema = await readApollo0076SchemaState(db, phase);
  const journalState = validateProduction0076Journal({
    phase,
    count: journalRows.length,
    head: journalRows.at(-1)?.created_at ?? null,
    legacyFingerprint: fingerprint(legacyRows),
    oldTailCount: oldTailRows.length,
    actualOldTailFingerprint: fingerprint(oldTailRows),
    expectedOldTailFingerprint,
    priorMigrationCount: priorMigrationRows.length,
    priorMigrationHash,
    migrationCount: migrationRows.length,
    migrationHash,
    schema,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: "production_migration_0076_discovery",
        phase,
        projectRef: target.projectRef,
        targetKind: target.targetKind,
        database: identity?.database_name,
        backupReceiptConfirmed: true,
        quiescenceReceiptConfirmed: true,
        maintenanceWindowConfirmed: true,
        repository0075Hash,
        repository0076Hash,
        journal: {
          count: journalRows.length,
          head: journalRows.at(-1)?.created_at ?? null,
          legacyCount: legacyRows.length,
          oldTailCount: oldTailRows.length,
          priorMigrationCount: priorMigrationRows.length,
          priorMigrationHash,
          migrationCount: migrationRows.length,
          migrationHash,
        },
        schema,
        journalState,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end({ timeout: 5 });
}

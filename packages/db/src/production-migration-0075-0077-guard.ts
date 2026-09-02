import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  HRMNY_PRODUCTION_0075_TO_0077_BAND,
  validateProduction0075To0077Inputs,
  validateProduction0075To0077Journal,
  validateProduction0075To0077RepositoryBand,
  type Production0075To0077JournalRow,
  type Production0075To0077Phase,
} from "./production-migration-0075-0077-contract";
import {
  HRMNY_PRODUCTION_0075_MIGRATION,
  validateProduction0075Journal,
} from "./production-migration-0075-contract";
import { readApollo0075SchemaState } from "./production-migration-0075-discovery";
import {
  HRMNY_PRODUCTION_0076_MIGRATION,
  validateProduction0076Journal,
} from "./production-migration-0076-contract";
import { readApollo0076SchemaState } from "./production-migration-0076-discovery";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
} from "./production-migration-contract";

const phase = process.env.PRODUCTION_MIGRATION_PHASE as
  Production0075To0077Phase | undefined;
assert(
  phase === "audit" || phase === "preflight" || phase === "verify",
  "PRODUCTION_MIGRATION_PHASE must be audit, preflight, or verify.",
);

const target = validateProduction0075To0077Inputs({
  phase,
  databaseUrl: process.env.HRMNY_PRODUCTION_DATABASE_URL,
  projectRef: process.env.HRMNY_PRODUCTION_PROJECT_REF,
  backupReceipt: process.env.HRMNY_PRODUCTION_BACKUP_RECEIPT,
  runtimeReceipt: process.env.HRMNY_PRODUCTION_RUNTIME_RECEIPT,
  confirmation: process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
});

type JournalRow = Production0075To0077JournalRow;

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
validateProduction0075To0077RepositoryBand(repositoryJournal.entries);
assert.equal(
  repositoryJournal.entries.at(-1)?.tag,
  HRMNY_PRODUCTION_0075_TO_0077_BAND.at(-1)?.tag,
  "0077 is no longer the repository head; issue a newly reviewed runner.",
);

function repositoryMigrationHash(tag: string): string {
  return createHash("sha256")
    .update(
      readFileSync(join(migrationsDirectory, `${tag}.sql`), "utf8").replace(
        /\r\n/g,
        "\n",
      ),
    )
    .digest("hex");
}

for (const migration of HRMNY_PRODUCTION_0075_TO_0077_BAND) {
  assert.equal(
    repositoryMigrationHash(migration.tag),
    migration.hash,
    `Reviewed ${migration.tag} SQL hash drifted.`,
  );
}
const expectedOldTailFingerprint = fingerprint(
  HRMNY_PRODUCTION_MIGRATION_BAND.map(({ tag, createdAt }) => ({
    created_at: createdAt,
    hash: repositoryMigrationHash(tag),
  })),
);

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
  assert.equal(identity?.journal_exists, true, "Migration journal is missing.");

  const journalRows = await db<JournalRow[]>`
    select created_at::text, hash
    from drizzle.__drizzle_migrations
    order by created_at, id
  `;
  const oldTailStart = HRMNY_PRODUCTION_LEGACY_BASELINE.count;
  const migrationStart = oldTailStart + HRMNY_PRODUCTION_MIGRATION_BAND.length;
  const legacyRows = journalRows.slice(0, oldTailStart);
  const oldTailRows = journalRows.slice(oldTailStart, migrationStart);
  const migrationRows = journalRows.slice(migrationStart);
  const legacyFingerprint = fingerprint(legacyRows);
  const actualOldTailFingerprint = fingerprint(oldTailRows);
  const journalState = validateProduction0075To0077Journal({
    phase,
    count: journalRows.length,
    head: journalRows.at(-1)?.created_at ?? null,
    legacyFingerprint,
    oldTailCount: oldTailRows.length,
    actualOldTailFingerprint,
    expectedOldTailFingerprint,
    migrationRows,
  });

  const effectivePhase = phase === "verify" ? "verify" : "preflight";
  const apollo0075 = await readApollo0075SchemaState(db, effectivePhase);
  validateProduction0075Journal({
    phase: effectivePhase,
    count:
      effectivePhase === "verify" ? migrationStart + 1 : journalRows.length,
    head:
      effectivePhase === "verify"
        ? HRMNY_PRODUCTION_0075_MIGRATION.createdAt
        : (journalRows.at(-1)?.created_at ?? null),
    legacyFingerprint,
    oldTailCount: oldTailRows.length,
    actualOldTailFingerprint,
    expectedOldTailFingerprint,
    migrationCount: effectivePhase === "verify" ? 1 : 0,
    migrationHash:
      effectivePhase === "verify" ? (migrationRows[0]?.hash ?? null) : null,
    schema: apollo0075,
  });

  let apollo0076: Awaited<ReturnType<typeof readApollo0076SchemaState>> | null =
    null;
  if (phase === "verify") {
    apollo0076 = await readApollo0076SchemaState(db, "verify");
    validateProduction0076Journal({
      phase: "verify",
      count: migrationStart + 2,
      head: HRMNY_PRODUCTION_0076_MIGRATION.createdAt,
      legacyFingerprint,
      oldTailCount: oldTailRows.length,
      actualOldTailFingerprint,
      expectedOldTailFingerprint,
      priorMigrationCount: 1,
      priorMigrationHash: migrationRows[0]?.hash ?? null,
      migrationCount: 1,
      migrationHash: migrationRows[1]?.hash ?? null,
      schema: apollo0076,
    });
  } else {
    const [apolloPreflight] = await db<
      Array<{
        runningApolloJobs: number;
        columns: number;
        constraints: number;
        indexes: number;
        functions: number;
        triggers: number;
      }>
    >`
      select
        (select count(*)::int from public.scheduled_job
          where kind = 'apollo_people_search' and status = 'running')
          as "runningApolloJobs",
        (select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'scheduled_job'
            and column_name = 'concurrency_key') as columns,
        (select count(*)::int from pg_constraint
          where conname = 'scheduled_job_apollo_concurrency_key_chk')
          as constraints,
        (select count(*)::int from pg_indexes
          where schemaname = 'public'
            and indexname = 'scheduled_job_running_concurrency_uniq') as indexes,
        (select count(*)::int from pg_proc function_info
          join pg_namespace function_schema
            on function_schema.oid = function_info.pronamespace
          where function_schema.nspname = 'public'
            and function_info.proname =
              'scheduled_job_assign_apollo_concurrency_key') as functions,
        (select count(*)::int from pg_trigger
          where tgname = 'scheduled_job_assign_apollo_concurrency_key_trg'
            and not tgisinternal) as triggers
    `;
    assert.deepEqual(
      apolloPreflight,
      {
        runningApolloJobs: 0,
        columns: 0,
        constraints: 0,
        indexes: 0,
        functions: 0,
        triggers: 0,
      },
      "Production has running Apollo work or partial 0076 objects.",
    );
  }

  const [qm] = await db<
    Array<{
      tables: number;
      constraints: number;
      indexes: number;
      functions: number;
      triggers: number;
      securedTables: number;
      publicGrants: number;
      browserRoleGrants: number;
    }>
  >`
    select
      (select count(*)::int from pg_class relation
        where relation.oid in (
          to_regclass('public.qm_session_binding'),
          to_regclass('public.qm_command_decision')
        )) as tables,
      (select count(*)::int from pg_constraint
        where conname in (
          'qm_session_owner_uniq', 'qm_session_scope_uniq',
          'qm_session_lifecycle_chk', 'qm_session_scope_chk',
          'qm_session_runtime_chk', 'qm_session_upstream_pin_chk',
          'qm_session_state_version_chk', 'qm_decision_request_uniq',
          'qm_decision_input_digest_chk', 'qm_decision_outcome_chk',
          'qm_decision_reason_chk', 'qm_decision_capability_chk',
          'qm_decision_reason_outcome_chk',
          'qm_decision_session_metadata_chk',
          'qm_decision_work_record_chk'
        )) as constraints,
      (select count(*)::int from pg_indexes
        where schemaname = 'public' and indexname in (
          'qm_session_owner_uniq', 'qm_session_scope_uniq',
          'qm_session_owner_idx', 'qm_decision_request_uniq',
          'qm_decision_proposal_uniq', 'qm_decision_precheck_uniq',
          'qm_decision_session_recorded_idx'
        )) as indexes,
      (select count(*)::int from pg_proc function_info
        join pg_namespace function_schema
          on function_schema.oid = function_info.pronamespace
        join pg_language function_language
          on function_language.oid = function_info.prolang
        where function_schema.nspname = 'public'
          and function_info.proname = 'reject_qm_decision_mutation'
          and function_info.pronargs = 0
          and function_info.prorettype = 'trigger'::regtype
          and function_language.lanname = 'plpgsql'
          and not function_info.prosecdef
          and array_position(
            function_info.proconfig,
            'search_path=pg_catalog, public'
          ) is not null
          and not exists (
            select 1 from aclexplode(coalesce(
              function_info.proacl,
              acldefault('f', function_info.proowner)
            )) acl
            where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          )) as functions,
      (select count(*)::int from pg_trigger trigger_info
        where trigger_info.tgname = 'qm_command_decision_immutable_trg'
          and not trigger_info.tgisinternal
          and trigger_info.tgenabled = 'O'
          and trigger_info.tgrelid =
            to_regclass('public.qm_command_decision')
          and trigger_info.tgtype = 27
          and trigger_info.tgfoid =
            'public.reject_qm_decision_mutation()'::regprocedure) as triggers,
      (select count(*)::int from pg_class relation
        where relation.oid in (
          to_regclass('public.qm_session_binding'),
          to_regclass('public.qm_command_decision')
        ) and relation.relrowsecurity) as "securedTables",
      (select count(*)::int from pg_class relation
        where relation.oid in (
          to_regclass('public.qm_session_binding'),
          to_regclass('public.qm_command_decision')
        ) and exists (
          select 1 from aclexplode(coalesce(
            relation.relacl,
            acldefault('r', relation.relowner)
          )) acl
          where acl.grantee = 0
            and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
        )) as "publicGrants",
      (select count(*)::int from (
        values ('anon'), ('authenticated')
      ) role_name(name)
        join pg_roles role_info on role_info.rolname = role_name.name
        join (values
          (to_regclass('public.qm_session_binding')),
          (to_regclass('public.qm_command_decision'))
        ) relation_info(oid) on relation_info.oid is not null
        where has_table_privilege(
          role_info.oid,
          relation_info.oid,
          'SELECT,INSERT,UPDATE,DELETE'
        )) as "browserRoleGrants"
  `;
  const expectedQm =
    phase === "verify"
      ? {
          tables: 2,
          constraints: 15,
          indexes: 7,
          functions: 1,
          triggers: 1,
          securedTables: 2,
          publicGrants: 0,
          browserRoleGrants: 0,
        }
      : {
          tables: 0,
          constraints: 0,
          indexes: 0,
          functions: 0,
          triggers: 0,
          securedTables: 0,
          publicGrants: 0,
          browserRoleGrants: 0,
        };
  assert.deepEqual(qm, expectedQm, "Production QM repository readback failed.");

  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: "production_migration_0075_0077_discovery",
        phase,
        projectRef: target.projectRef,
        targetKind: target.targetKind,
        database: identity.database_name,
        backupReceiptConfirmed: phase !== "audit",
        compatibleRuntimeReceiptConfirmed: phase !== "audit",
        repositoryHashes: Object.fromEntries(
          HRMNY_PRODUCTION_0075_TO_0077_BAND.map(({ tag, hash }) => [
            tag,
            hash,
          ]),
        ),
        journal: {
          count: journalRows.length,
          head: journalRows.at(-1)?.created_at ?? null,
          legacyCount: legacyRows.length,
          oldTailCount: oldTailRows.length,
          migrationRows,
        },
        schema: { apollo0075, apollo0076, qm },
        journalState,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end({ timeout: 5 });
}

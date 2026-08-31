import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
} from "./production-migration-contract";
import {
  HRMNY_PRODUCTION_0075_MIGRATION,
  validateProduction0075Inputs,
  validateProduction0075Journal,
  validateProduction0075RepositoryBand,
  validateProduction0075RepositoryEntry,
  type Apollo0075SchemaState,
} from "./production-migration-0075-contract";
import {
  readApollo0075BackfillViolations,
  readApollo0075SchemaState,
} from "./production-migration-0075-discovery";

const phase = process.env.PRODUCTION_MIGRATION_PHASE;
assert(
  phase === "preflight" || phase === "verify",
  "PRODUCTION_MIGRATION_PHASE must be preflight or verify.",
);

const target = validateProduction0075Inputs({
  databaseUrl: process.env.HRMNY_PRODUCTION_DATABASE_URL,
  projectRef: process.env.HRMNY_PRODUCTION_PROJECT_REF,
  backupReceipt: process.env.HRMNY_PRODUCTION_BACKUP_RECEIPT,
  confirmation: process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
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
validateProduction0075RepositoryBand(repositoryJournal.entries);
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
assert.equal(
  repositoryJournal.entries.at(-1)?.tag,
  HRMNY_PRODUCTION_0075_MIGRATION.tag,
  "0075 is no longer the repository migration head; issue a newly reviewed runner.",
);
const migration0075Path = join(
  migrationsDirectory,
  `${HRMNY_PRODUCTION_0075_MIGRATION.tag}.sql`,
);
const repository0075Hash = createHash("sha256")
  .update(readFileSync(migration0075Path))
  .digest("hex");
assert.equal(
  repository0075Hash,
  HRMNY_PRODUCTION_0075_MIGRATION.hash,
  "Reviewed 0075 SQL hash drifted.",
);
const expectedOldTailRows = repositoryOldBand.map(({ tag, createdAt }) => ({
  created_at: createdAt,
  hash: createHash("sha256")
    .update(readFileSync(join(migrationsDirectory, `${tag}.sql`)))
    .digest("hex"),
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
  assert.equal(identity?.database_name, "postgres", "Unexpected database name.");
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
  const oldTailRows = journalRows.slice(
    HRMNY_PRODUCTION_LEGACY_BASELINE.count,
    HRMNY_PRODUCTION_LEGACY_BASELINE.count +
      HRMNY_PRODUCTION_MIGRATION_BAND.length,
  );
  const migrationRows = journalRows.slice(
    HRMNY_PRODUCTION_LEGACY_BASELINE.count +
      HRMNY_PRODUCTION_MIGRATION_BAND.length,
  );
  const migrationHash =
    migrationRows.length === 1 &&
    migrationRows[0]?.created_at === HRMNY_PRODUCTION_0075_MIGRATION.createdAt
      ? (migrationRows[0]?.hash ?? null)
      : null;

  const [schema] = await db<Apollo0075SchemaState[]>`
    with expected_columns(
      table_name, column_name, udt_name, nullable, default_zero
    ) as (
      values
        ('integration_inbox', 'owner_employee_id', 'uuid', true, false),
        ('integration_inbox', 'credential_connection_account_id', 'uuid', true, false),
        ('integration_inbox', 'state_version', 'int4', false, true),
        ('integration_inbox', 'attempt_token', 'uuid', true, false),
        ('integration_inbox', 'attempt_lease_expires_at', 'timestamptz', true, false),
        ('scheduled_job', 'integration_inbox_id', 'uuid', true, false),
        ('scheduled_job', 'state_version', 'int4', false, true),
        ('scheduled_job', 'attempt_token', 'uuid', true, false),
        ('scheduled_job', 'lease_expires_at', 'timestamptz', true, false)
    ),
    expected_constraints(
      constraint_name, table_name, column_name, foreign_table, foreign_column
    ) as (
      values
        (
          'integration_inbox_owner_employee_id_employee_fk',
          'integration_inbox', 'owner_employee_id', 'employee', 'employee_id'
        ),
        (
          'integration_inbox_credential_connection_account_fk',
          'integration_inbox', 'credential_connection_account_id',
          'connection_account', 'connection_account_id'
        ),
        (
          'scheduled_job_integration_inbox_fk',
          'scheduled_job', 'integration_inbox_id',
          'integration_inbox', 'integration_inbox_id'
        )
    ),
    expected_indexes(index_name) as (
      values
        ('scheduled_job_apollo_inbox_uniq'),
        ('integration_inbox_owner_operation_idx')
    ),
    expected_secure(table_name) as (
      values ('integration_inbox'), ('scheduled_job')
    ),
    prior_secure(table_name) as (
      values
        ('os_notification'), ('custom_agent'), ('chat_thread'),
        ('chat_message'), ('creative_generation'), ('seam_outbox'),
        ('portal_magic_token'), ('portal_session_grant'),
        ('sales_os_settings'), ('sales_os_evolve_proposal'),
        ('company_research'), ('contact_research'), ('suppression_entry'),
        ('email_event'), ('intel_signal'), ('sales_os_credit_ledger'),
        ('integration_inbox')
    )
    select
      (
        to_regclass('public.crm_quote') is not null
        and to_regclass('public.client_onboarding') is not null
        and exists (
          select 1 from pg_enum value
          join pg_type type on type.oid = value.enumtypid
          where type.typname = 'lead_source_lane_enum'
            and value.enumlabel = 'inbound'
        )
        and exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'asset'
            and column_name = 'work_item_id'
        )
        and exists (
          select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'health_signal'
            and column_name = 'delivery_status'
        )
        and exists (
          select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'employee_role_employee_role_uniq'
        )
        and (
          select count(*) from prior_secure expected
          join pg_class relation
            on relation.oid = to_regclass('public.' || expected.table_name)
          where relation.relrowsecurity
            and not (
              (exists(select 1 from pg_roles where rolname = 'anon')
                and has_table_privilege(
                  'anon', 'public.' || expected.table_name,
                  'SELECT,INSERT,UPDATE,DELETE'
                ))
              or
              (exists(select 1 from pg_roles where rolname = 'authenticated')
                and has_table_privilege(
                  'authenticated', 'public.' || expected.table_name,
                  'SELECT,INSERT,UPDATE,DELETE'
                ))
            )
        ) = 17
        and exists (
          select 1 from public.work_organization_policy
          where organization_key = 'default' and app_policy <> 'disabled'
        )
        and (
          select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'outreach_items'
            and column_name in (
              'contact_id', 'rework_feedback', 'linkedin_url',
              'cadence_touch', 'accepted_at'
            )
        ) = 5
        and exists (
          select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'integration_inbox_provider_event_uniq'
        )
        and (
          select count(*) from information_schema.columns
          where table_schema = 'public' and table_name = 'invoice'
            and column_name in (
              'contact_name', 'billing_kind', 'trn', 'trn_status',
              'rule_cited', 'source_attached',
              'proposed_by_employee_id', 'approved_by_employee_id'
            )
        ) = 8
      ) as "priorContractReady",
      (
        select count(*)::int from expected_columns expected
        join information_schema.columns column_info
          on column_info.table_schema = 'public'
          and column_info.table_name = expected.table_name
          and column_info.column_name = expected.column_name
      ) as "namedColumnsPresent",
      (
        select count(*)::int from expected_columns expected
        join information_schema.columns column_info
          on column_info.table_schema = 'public'
          and column_info.table_name = expected.table_name
          and column_info.column_name = expected.column_name
          and column_info.udt_name = expected.udt_name
          and (column_info.is_nullable = 'YES') = expected.nullable
          and (
            (expected.default_zero and column_info.column_default = '0')
            or (not expected.default_zero and column_info.column_default is null)
          )
      ) as "correctColumns",
      (
        select count(*)::int from expected_constraints expected
        join pg_constraint constraint_info
          on constraint_info.conname = expected.constraint_name
        join pg_class local_table
          on local_table.oid = constraint_info.conrelid
          and local_table.relname = expected.table_name
          and local_table.relnamespace = 'public'::regnamespace
      ) as "namedConstraintsPresent",
      (
        select count(*)::int from expected_constraints expected
        join pg_constraint constraint_info
          on constraint_info.conname = expected.constraint_name
          and constraint_info.contype = 'f'
          and constraint_info.confdeltype = 'n'
          and array_length(constraint_info.conkey, 1) = 1
          and array_length(constraint_info.confkey, 1) = 1
        join pg_class local_table
          on local_table.oid = constraint_info.conrelid
          and local_table.relname = expected.table_name
          and local_table.relnamespace = 'public'::regnamespace
        join pg_class foreign_table
          on foreign_table.oid = constraint_info.confrelid
          and foreign_table.relname = expected.foreign_table
          and foreign_table.relnamespace = 'public'::regnamespace
        where pg_catalog.get_attname(
                constraint_info.conrelid, constraint_info.conkey[1], false
              ) = expected.column_name
          and pg_catalog.get_attname(
                constraint_info.confrelid, constraint_info.confkey[1], false
              ) = expected.foreign_column
      ) as "correctConstraints",
      (
        select count(*)::int from expected_indexes expected
        join pg_indexes index_info
          on index_info.schemaname = 'public'
          and index_info.indexname = expected.index_name
      ) as "namedIndexesPresent",
      (
        select count(*)::int from pg_indexes index_info
        where index_info.schemaname = 'public'
          and (
            (
              index_info.indexname = 'scheduled_job_apollo_inbox_uniq'
              and lower(index_info.indexdef) like
                'create unique index scheduled_job_apollo_inbox_uniq on public.scheduled_job using btree (integration_inbox_id)%'
              and lower(index_info.indexdef) like '%where%'
              and lower(index_info.indexdef) like
                '%kind = ''apollo_people_search''%'
              and lower(index_info.indexdef) like
                '%integration_inbox_id is not null%'
            )
            or (
              index_info.indexname = 'integration_inbox_owner_operation_idx'
              and lower(index_info.indexdef) like
                'create index integration_inbox_owner_operation_idx on public.integration_inbox using btree (owner_employee_id, operation, received_at desc)%'
            )
          )
      ) as "correctIndexes",
      (
        select count(*)::int from expected_secure expected
        join pg_class relation
          on relation.oid = to_regclass('public.' || expected.table_name)
        where relation.relrowsecurity
          and not exists (
            select 1
            from aclexplode(
              coalesce(relation.relacl, acldefault('r', relation.relowner))
            ) acl
            where acl.grantee = 0
              and acl.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
          )
          and not (
            (exists(select 1 from pg_roles where rolname = 'anon')
              and has_table_privilege(
                'anon', 'public.' || expected.table_name,
                'SELECT,INSERT,UPDATE,DELETE'
              ))
            or
            (exists(select 1 from pg_roles where rolname = 'authenticated')
              and has_table_privilege(
                'authenticated', 'public.' || expected.table_name,
                'SELECT,INSERT,UPDATE,DELETE'
              ))
          )
      ) as "securedTables",
      0::int as "backfillViolations"
  `;
  assert(schema, "0075 schema discovery returned no row.");
  schema.backfillViolations = await readApollo0075BackfillViolations(db, phase);
  const sharedSchema = await readApollo0075SchemaState(db, phase);
  assert.deepEqual(
    sharedSchema,
    schema,
    "Shared disposable/production 0075 schema discovery drifted.",
  );

  const journalState = validateProduction0075Journal({
    phase,
    count: journalRows.length,
    head: journalRows.at(-1)?.created_at ?? null,
    legacyFingerprint: fingerprint(legacyRows),
    oldTailCount: oldTailRows.length,
    actualOldTailFingerprint: fingerprint(oldTailRows),
    expectedOldTailFingerprint,
    migrationCount: migrationRows.length,
    migrationHash,
    schema,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        kind: "production_migration_0075_discovery",
        phase,
        projectRef: target.projectRef,
        targetKind: target.targetKind,
        database: identity?.database_name,
        backupReceiptConfirmed: true,
        repository0075Hash,
        journal: {
          count: journalRows.length,
          head: journalRows.at(-1)?.created_at ?? null,
          legacyCount: legacyRows.length,
          oldTailCount: oldTailRows.length,
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

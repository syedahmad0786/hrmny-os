import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import {
  readApollo0075BackfillViolations,
  readApollo0075SchemaState,
} from "./production-migration-0075-discovery";
import {
  readApollo0076BackfillViolations,
  readApollo0076DuplicateRunningSlots,
  readApollo0076SchemaState,
} from "./production-migration-0076-discovery";

const adminUrl = new URL(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
);
const allowedHosts = new Set(["127.0.0.1", "localhost", "postgres"]);

assert.equal(
  process.env.MIGRATION_TEST_ALLOW_DROP,
  "true",
  "Set MIGRATION_TEST_ALLOW_DROP=true for isolated test-database checks.",
);
assert(
  allowedHosts.has(adminUrl.hostname),
  `Refusing to create or drop migration-test databases on ${adminUrl.hostname}.`,
);

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
const journal = JSON.parse(
  await readFile(`${migrationsDirectory}meta/_journal.json`, "utf8"),
) as { entries: Array<{ tag: string }> };
const apolloPriorHead = "0075_apollo_search_fencing";
const apolloHead = "0076_apollo_people_search_serialization";
const head = "0079_crm_operational_truth";
assert.equal(
  journal.entries.at(-1)?.tag,
  head,
  "Migration journal head drifted.",
);

const options = { max: 1, onnotice: () => undefined } as const;
const admin = postgres(adminUrl.toString(), options);
const databaseNames = [
  "hrmny_migration_fresh",
  "hrmny_migration_upgrade",
  "hrmny_migration_upgrade_band",
];
const migrationBandStart = "0068_os_modules";

function databaseUrl(name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function recreateDatabase(name: string): Promise<void> {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
}

async function applyMigration(connection: Sql, tag: string): Promise<void> {
  const body = await readFile(`${migrationsDirectory}${tag}.sql`, "utf8");
  await connection.unsafe(body, [], { prepare: false });
}

async function prepareSupabaseDatabase(connection: Sql): Promise<void> {
  const extensions = await connection<
    Array<{ name: string }>
  >`SELECT name FROM pg_available_extensions WHERE name IN ('supabase_vault', 'vector')`;
  assert.deepEqual(
    extensions.map(({ name }) => name).sort(),
    ["supabase_vault", "vector"],
    "Use the pinned Supabase PostgreSQL image for migration verification.",
  );
  await connection.unsafe("CREATE SCHEMA IF NOT EXISTS vault");
}

async function assertCurrentHead(connection: Sql): Promise<void> {
  const [operationalColumns] = await connection<Array<{ count: number }>>`
    select count(*)::int as count from information_schema.columns
    where table_schema='public' and table_name='deal'
      and column_name in ('record_class','classification_reason','opportunity_name','expected_close_date','closed_at','stage_entered_at')
  `;
  assert.equal(
    operationalColumns?.count,
    6,
    "Commercial provenance/date columns are missing.",
  );
  const [proofDeal] = await connection<Array<{ deal_id: string }>>`
    insert into public.deal (company_name, lead_source_lane)
    values ('Migration verification only', 'relationship_led') returning deal_id
  `;
  assert(proofDeal);
  try {
    const [closed] = await connection<
      Array<{ closed_at: Date; stage_entered_at: Date }>
    >`
      update public.deal set stage='qualify', close_outcome='won'
      where deal_id=${proofDeal.deal_id}::uuid returning closed_at, stage_entered_at
    `;
    assert(closed?.closed_at && closed.stage_entered_at);
    const [edited] = await connection<
      Array<{ closed_at: Date; stage_entered_at: Date }>
    >`
      update public.deal set opportunity_name='Edited after closing', updated_at=now()
      where deal_id=${proofDeal.deal_id}::uuid returning closed_at, stage_entered_at
    `;
    assert.deepEqual(
      edited,
      closed,
      "Editing a deal must not rewrite its commercial dates.",
    );
    const [draft] = await connection<Array<{ outreach_item_id: string }>>`
      insert into public.outreach_items (deal_id, channel, recipient, body, state)
      values (${proofDeal.deal_id}::uuid, 'email', 'verification@example.test', 'Reviewed text', 'approved')
      returning outreach_item_id
    `;
    assert(draft);
    const [changed] = await connection<
      Array<{ state: string; approved_by: string | null }>
    >`
      update public.outreach_items set body='Changed text'
      where outreach_item_id=${draft.outreach_item_id}::uuid returning state, approved_by
    `;
    assert.deepEqual(changed, { state: "draft", approved_by: null });
  } finally {
    await connection`delete from public.outreach_items where deal_id=${proofDeal.deal_id}::uuid`;
    await connection`delete from public.deal where deal_id=${proofDeal.deal_id}::uuid`;
  }
  const [markets] = await connection<Array<{ values: string[] }>>`
    select array_agg(value.enumlabel order by value.enumsortorder) as values
    from pg_enum value
    join pg_type type on type.oid = value.enumtypid
    where type.typname = 'market_enum'
  `;
  assert.deepEqual(
    markets?.values,
    ["UAE", "KSA", "Both", "Oman", "Qatar", "Kuwait", "Bahrain", "GCC"],
    "GCC market enum expansion is not installed.",
  );

  const [priorBridge] = await connection<Array<{ ok: boolean }>>`
    select
      to_regclass('public.portal_session_grant') is not null
      and to_regclass('public.sales_os_settings') is not null
      and to_regclass('public.sales_os_evolve_proposal') is not null
      and to_regclass('public.company_research') is not null
      and to_regclass('public.contact_research') is not null
      and to_regclass('public.suppression_entry') is not null
      and to_regclass('public.email_event') is not null
      and to_regclass('public.intel_signal') is not null
      and to_regclass('public.sales_os_credit_ledger') is not null
      and (
        select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'outreach_items'
          and column_name in (
            'contact_id', 'rework_feedback', 'linkedin_url',
            'cadence_touch', 'accepted_at'
          )
      ) = 5 as ok
  `;
  assert.equal(
    priorBridge?.ok,
    true,
    "The 0068-0074 additive band installs the complete Sales OS bridge schema.",
  );

  const [inbox] = await connection<Array<{ ok: boolean }>>`
    select
      to_regclass('public.integration_inbox') is not null
      and exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'integration_inbox_provider_event_uniq'
      )
      and (
        select relrowsecurity from pg_class
        where oid = 'public.integration_inbox'::regclass
      ) as ok
  `;
  assert.equal(inbox?.ok, true, "Integration inbox contract is installed.");

  const [browserBoundary] = await connection<Array<{ ok: boolean }>>`
    select not (
      has_table_privilege('anon', 'public.integration_inbox', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', 'public.integration_inbox', 'SELECT,INSERT,UPDATE,DELETE')
    ) as ok
  `;
  assert.equal(
    browserBoundary?.ok,
    true,
    "Browser Data API roles cannot access integration receipts.",
  );

  const [invoiceColumns] = await connection<Array<{ count: number }>>`
    select count(*)::int as count
    from information_schema.columns
    where table_schema = 'public' and table_name = 'invoice'
      and column_name in (
        'contact_name', 'billing_kind', 'trn', 'trn_status', 'rule_cited',
        'source_attached', 'proposed_by_employee_id', 'approved_by_employee_id'
      )
  `;
  assert.equal(invoiceColumns?.count, 8, "Invoice gate metadata is durable.");

  const [apolloFencing] = await connection<Array<{ ok: boolean }>>`
    select
      (
        select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'integration_inbox'
          and column_name in (
            'owner_employee_id', 'credential_connection_account_id',
            'state_version', 'attempt_token', 'attempt_lease_expires_at'
          )
      ) = 5
      and (
        select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'scheduled_job'
          and column_name in (
            'integration_inbox_id', 'state_version', 'attempt_token',
            'lease_expires_at'
          )
      ) = 4
      and exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'scheduled_job_apollo_inbox_uniq'
      )
      and (
        select relrowsecurity from pg_class
        where oid = 'public.scheduled_job'::regclass
      ) as ok
  `;
  assert.equal(
    apolloFencing?.ok,
    true,
    "Apollo receipt and scheduled-job attempt fencing is installed.",
  );

  const [scheduledJobBoundary] = await connection<Array<{ ok: boolean }>>`
    select not (
      has_table_privilege('anon', 'public.scheduled_job', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', 'public.scheduled_job', 'SELECT,INSERT,UPDATE,DELETE')
    ) as ok
  `;
  assert.equal(
    scheduledJobBoundary?.ok,
    true,
    "Browser Data API roles cannot access scheduled jobs.",
  );

  // The accepted production database has an immutable legacy journal prefix
  // plus reconciled M1 artifacts that a canonical fresh migration chain does
  // not reproduce. Keep that identity distinction explicit: disposable proof
  // validates 0075 itself, while the production guard alone requires the
  // separately reviewed legacy contract.
  const { priorContractReady, ...apollo0075Schema } =
    await readApollo0075SchemaState(connection, "verify");
  assert.equal(
    priorContractReady,
    false,
    "Disposable migrations must not masquerade as the reconciled production legacy baseline.",
  );
  assert.deepEqual(
    apollo0075Schema,
    {
      namedColumnsPresent: 9,
      correctColumns: 9,
      namedConstraintsPresent: 3,
      correctConstraints: 3,
      namedIndexesPresent: 2,
      correctIndexes: 2,
      securedTables: 2,
      backfillViolations: 0,
    },
    "0075 schema readback failed on the disposable database.",
  );

  const { priorContractReady: prior0076Ready, ...apollo0076Schema } =
    await readApollo0076SchemaState(connection, "verify");
  assert.equal(
    prior0076Ready,
    false,
    "Disposable migrations must not masquerade as the reconciled production legacy baseline.",
  );
  assert.deepEqual(
    apollo0076Schema,
    {
      namedColumnsPresent: 1,
      correctColumns: 1,
      namedChecksPresent: 1,
      correctChecks: 1,
      namedIndexesPresent: 1,
      correctIndexes: 1,
      namedFunctionsPresent: 1,
      correctFunctions: 1,
      namedTriggersPresent: 1,
      correctTriggers: 1,
      securedTables: 1,
      runningApolloJobs: 0,
      backfillViolations: 0,
      duplicateRunningSlots: 0,
    },
    "0076 schema and compatibility-trigger readback failed on the disposable database.",
  );

  const [qmRepository] = await connection<Array<{ ok: boolean }>>`
    select
      to_regclass('public.qm_session_binding') is not null
      and to_regclass('public.qm_command_decision') is not null
      and (
        select count(*) from pg_constraint
        where conname in (
          'qm_session_owner_uniq',
          'qm_session_scope_uniq',
          'qm_session_lifecycle_chk',
          'qm_session_scope_chk',
          'qm_session_runtime_chk',
          'qm_session_upstream_pin_chk',
          'qm_session_state_version_chk',
          'qm_decision_request_uniq',
          'qm_decision_input_digest_chk',
          'qm_decision_outcome_chk',
          'qm_decision_reason_chk',
          'qm_decision_capability_chk',
          'qm_decision_reason_outcome_chk',
          'qm_decision_session_metadata_chk',
          'qm_decision_work_record_chk'
        )
      ) = 15
      and (
        select count(*) from pg_indexes
        where schemaname = 'public' and indexname in (
          'qm_session_owner_uniq',
          'qm_session_scope_uniq',
          'qm_session_owner_idx',
          'qm_decision_request_uniq',
          'qm_decision_proposal_uniq',
          'qm_decision_precheck_uniq',
          'qm_decision_session_recorded_idx'
        )
      ) = 7
      and exists (
        select 1 from pg_trigger
        where tgname = 'qm_command_decision_immutable_trg'
          and not tgisinternal
      )
      and (
        select count(*) from pg_class
        where oid in (
          'public.qm_session_binding'::regclass,
          'public.qm_command_decision'::regclass
        ) and relrowsecurity
      ) = 2 as ok
  `;
  assert.equal(
    qmRepository?.ok,
    true,
    "0077 QM session and immutable decision repository is installed exactly.",
  );

  const [qmBrowserBoundary] = await connection<Array<{ ok: boolean }>>`
    select not (
      has_table_privilege('anon', 'public.qm_session_binding', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', 'public.qm_session_binding', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('anon', 'public.qm_command_decision', 'SELECT,INSERT,UPDATE,DELETE')
      or has_table_privilege('authenticated', 'public.qm_command_decision', 'SELECT,INSERT,UPDATE,DELETE')
    ) as ok
  `;
  assert.equal(
    qmBrowserBoundary?.ok,
    true,
    "Browser Data API roles cannot access QM authority records.",
  );

  const [legacyBackfill] = await connection<Array<{ ok: boolean }>>`
    select
      not exists (
        select 1 from public.integration_inbox
        where provider = 'apollo'
          and external_event_id = 'migration-0075-backfill-proof'
      )
      or exists (
        select 1
        from public.integration_inbox inbox
        join public.scheduled_job job
          on job.integration_inbox_id = inbox.integration_inbox_id
        where inbox.provider = 'apollo'
          and inbox.operation = 'people.search.zero-credit'
          and inbox.external_event_id = 'migration-0075-backfill-proof'
          and job.job_key =
            'apollo-people-search:' || inbox.integration_inbox_id::text
          and job.concurrency_key = 'provider:apollo'
      ) as ok
  `;
  assert.equal(
    legacyBackfill?.ok,
    true,
    "Migration 0075 did not link the exact legacy Apollo receipt and job.",
  );

  const oldStyleJobs = await connection<
    Array<{ scheduled_job_id: string; concurrency_key: string | null }>
  >`
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    values
      ('migration-0076-old-style-a', 'apollo_people_search', now(), '{}'::jsonb),
      ('migration-0076-old-style-b', 'apollo_people_search', now(), '{}'::jsonb)
    returning scheduled_job_id, concurrency_key
  `;
  assert.equal(
    oldStyleJobs.length,
    2,
    "Two old-style Apollo jobs were inserted.",
  );
  assert(
    oldStyleJobs.every(
      ({ concurrency_key }) => concurrency_key === "provider:apollo",
    ),
    "The compatibility trigger did not assign the exact Apollo slot key.",
  );
  await connection`
    update public.scheduled_job
    set status = 'running'
    where scheduled_job_id = ${oldStyleJobs[0]!.scheduled_job_id}::uuid
  `;
  await assert.rejects(
    async () => {
      await connection`
        update public.scheduled_job
        set status = 'running'
        where scheduled_job_id = ${oldStyleJobs[1]!.scheduled_job_id}::uuid
      `;
    },
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "23505",
        "The second old-style running job must fail on the unique slot.",
      );
      return true;
    },
  );
  await connection`
    update public.scheduled_job
    set status = 'completed'
    where scheduled_job_id = ${oldStyleJobs[0]!.scheduled_job_id}::uuid
  `;
  await connection`
    update public.scheduled_job
    set status = 'running'
    where scheduled_job_id = ${oldStyleJobs[1]!.scheduled_job_id}::uuid
  `;
  await connection`
    update public.scheduled_job
    set status = 'completed'
    where scheduled_job_id = ${oldStyleJobs[1]!.scheduled_job_id}::uuid
  `;
  const [transitioned] = await connection<
    Array<{ concurrency_key: string | null }>
  >`
    update public.scheduled_job
    set kind = 'apollo_people_match'
    where scheduled_job_id = ${oldStyleJobs[0]!.scheduled_job_id}::uuid
    returning concurrency_key
  `;
  assert.equal(
    transitioned?.concurrency_key,
    null,
    "Changing away from People Search must release only the reserved Apollo key.",
  );
  const [unenrolled] = await connection<
    Array<{ concurrency_key: string | null }>
  >`
    insert into public.scheduled_job (
      job_key, kind, run_at, payload, status, concurrency_key
    )
    values (
      'migration-0076-unenrolled-operation',
      'apollo_people_match', now(), '{}'::jsonb, 'running', 'provider:apollo'
    )
    returning concurrency_key
  `;
  assert.equal(
    unenrolled?.concurrency_key,
    null,
    "0076 must clear the reserved key from paid People Match or other kinds.",
  );
  assert.equal(
    await readApollo0076BackfillViolations(connection, "verify"),
    0,
    "Every Apollo People Search job must carry the exact slot key.",
  );
  assert.equal(
    await readApollo0076DuplicateRunningSlots(connection, "verify"),
    0,
    "No running execution slot may have duplicate holders.",
  );

  const eventId = "migration-proof-event";
  const first = await connection<Array<{ integration_inbox_id: string }>>`
    insert into public.integration_inbox (
      provider, external_event_id, operation, payload_hash, status
    ) values ('proof', ${eventId}, 'proof.receive', repeat('a', 64), 'completed')
    on conflict (provider, external_event_id) do nothing
    returning integration_inbox_id
  `;
  const replay = await connection<Array<{ integration_inbox_id: string }>>`
    insert into public.integration_inbox (
      provider, external_event_id, operation, payload_hash, status
    ) values ('proof', ${eventId}, 'proof.receive', repeat('a', 64), 'completed')
    on conflict (provider, external_event_id) do nothing
    returning integration_inbox_id
  `;
  assert.equal(first.length, 1, "First provider event is claimed.");
  assert.equal(replay.length, 0, "Provider event replay is not re-claimed.");

  const invoiceId = "74000000-0000-4000-8000-000000000001";
  await connection`
    insert into public.invoice (
      invoice_id, contact_name, invoice_type, billing_kind, status,
      amount, currency, trn, trn_status, rule_cited, source_attached
    ) values (
      ${invoiceId}::uuid, 'Migration proof', 'retainer', 'retainer', 'draft',
      100, 'AED', null, 'unknown_held', 'proof', '{"kind":"proof"}'::jsonb
    )
  `;
  const [invoice] = await connection<
    Array<{ trn_status: string; source_kind: string }>
  >`
    select trn_status, source_attached->>'kind' as source_kind
    from public.invoice where invoice_id = ${invoiceId}::uuid
  `;
  assert.deepEqual(invoice, {
    trn_status: "unknown_held",
    source_kind: "proof",
  });
}

async function assertExact0074Preflight(connection: Sql): Promise<void> {
  const [objects] = await connection<
    Array<{ columns: number; constraints: number; indexes: number }>
  >`
    select
      (
        select count(*)::int from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'integration_inbox' and column_name in (
              'owner_employee_id', 'credential_connection_account_id',
              'state_version', 'attempt_token', 'attempt_lease_expires_at'
            ))
            or
            (table_name = 'scheduled_job' and column_name in (
              'integration_inbox_id', 'state_version', 'attempt_token',
              'lease_expires_at'
            ))
          )
      ) as columns,
      (
        select count(*)::int from pg_constraint
        where conname in (
          'integration_inbox_owner_employee_id_employee_fk',
          'integration_inbox_credential_connection_account_fk',
          'scheduled_job_integration_inbox_fk'
        )
      ) as constraints,
      (
        select count(*)::int from pg_indexes
        where schemaname = 'public' and indexname in (
          'scheduled_job_apollo_inbox_uniq',
          'integration_inbox_owner_operation_idx'
        )
      ) as indexes
  `;
  assert.deepEqual(
    objects,
    { columns: 0, constraints: 0, indexes: 0 },
    "The prior-head database is not an exact 0074 preflight shape.",
  );
  await connection`
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    values (
      'apollo-people-search:00000000-0000-4000-8000-000000000075',
      'apollo_people_search', now(), '{}'::jsonb
    )
  `;
  assert.equal(
    await readApollo0075BackfillViolations(connection, "preflight"),
    1,
    "0074 preflight did not reject an orphan legacy Apollo job.",
  );
  await connection`
    delete from public.scheduled_job
    where job_key =
      'apollo-people-search:00000000-0000-4000-8000-000000000075'
  `;
  const [receipt] = await connection<Array<{ integration_inbox_id: string }>>`
    insert into public.integration_inbox (
      provider, external_event_id, operation, payload_hash, status
    ) values (
      'apollo', 'migration-0075-backfill-proof',
      'people.search.zero-credit', repeat('b', 64), 'received'
    )
    returning integration_inbox_id
  `;
  assert(receipt, "Legacy Apollo proof receipt was not inserted.");
  await connection`
    insert into public.scheduled_job (job_key, kind, run_at, payload)
    values (
      ${`apollo-people-search:${receipt.integration_inbox_id}`},
      'apollo_people_search', now(), '{}'::jsonb
    )
  `;
  const { priorContractReady, ...apollo0075Schema } =
    await readApollo0075SchemaState(connection, "preflight");
  assert.equal(
    priorContractReady,
    false,
    "Canonical 0074 must remain distinct from the reconciled production legacy baseline.",
  );
  assert.deepEqual(
    apollo0075Schema,
    {
      namedColumnsPresent: 0,
      correctColumns: 0,
      namedConstraintsPresent: 0,
      correctConstraints: 0,
      namedIndexesPresent: 0,
      correctIndexes: 0,
      securedTables: 2,
      backfillViolations: 0,
    },
    "Canonical 0074 preflight schema or safe legacy backfill contract drifted.",
  );
}

async function assertExact0075Preflight(connection: Sql): Promise<void> {
  const { priorContractReady: prior0075Ready, ...apollo0075Schema } =
    await readApollo0075SchemaState(connection, "verify");
  assert.equal(
    prior0075Ready,
    false,
    "Disposable 0075 must remain distinct from the reconciled production legacy baseline.",
  );
  assert.deepEqual(
    apollo0075Schema,
    {
      namedColumnsPresent: 9,
      correctColumns: 9,
      namedConstraintsPresent: 3,
      correctConstraints: 3,
      namedIndexesPresent: 2,
      correctIndexes: 2,
      securedTables: 2,
      backfillViolations: 0,
    },
    "The prior-head database is not an exact disposable 0075 schema.",
  );

  const { priorContractReady: prior0076Ready, ...apollo0076Schema } =
    await readApollo0076SchemaState(connection, "preflight");
  assert.equal(
    prior0076Ready,
    false,
    "Disposable 0075 must not masquerade as the reconciled production legacy baseline.",
  );
  assert.deepEqual(
    apollo0076Schema,
    {
      namedColumnsPresent: 0,
      correctColumns: 0,
      namedChecksPresent: 0,
      correctChecks: 0,
      namedIndexesPresent: 0,
      correctIndexes: 0,
      namedFunctionsPresent: 0,
      correctFunctions: 0,
      namedTriggersPresent: 0,
      correctTriggers: 0,
      securedTables: 1,
      runningApolloJobs: 0,
      backfillViolations: 0,
      duplicateRunningSlots: 0,
    },
    "The exact 0075 preflight has partial 0076 objects or running Apollo People Search work.",
  );
}

async function assertMigrationRejectsRunningApollo(
  connection: Sql,
): Promise<void> {
  await connection`
    insert into public.scheduled_job (job_key, kind, run_at, payload, status)
    values (
      'migration-0076-running-preflight-proof',
      'apollo_people_search', now(), '{}'::jsonb, 'running'
    )
  `;
  await assert.rejects(
    async () => applyMigration(connection, apolloHead),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "55006",
        "0076 must fail in-transaction when an Apollo People Search job is running.",
      );
      return true;
    },
  );
  const [objects] = await connection<
    Array<{ columns: number; checks: number; indexes: number }>
  >`
    select
      (
        select count(*)::int from information_schema.columns
        where table_schema = 'public' and table_name = 'scheduled_job'
          and column_name = 'concurrency_key'
      ) as columns,
      (
        select count(*)::int from pg_constraint
        where conrelid = 'public.scheduled_job'::regclass
          and conname = 'scheduled_job_apollo_concurrency_key_chk'
      ) as checks,
      (
        select count(*)::int from pg_indexes
        where schemaname = 'public'
          and indexname = 'scheduled_job_running_concurrency_uniq'
      ) as indexes
  `;
  assert.deepEqual(
    objects,
    { columns: 0, checks: 0, indexes: 0 },
    "A rejected 0076 migration must roll back every schema write.",
  );
  await connection`
    delete from public.scheduled_job
    where job_key = 'migration-0076-running-preflight-proof'
  `;
}

let fresh: Sql | undefined;
let upgrade: Sql | undefined;
let upgradeCompetitor: Sql | undefined;
let upgradeBand: Sql | undefined;
let verificationPassed = false;
const retainFreshForProof =
  process.env.MIGRATION_TEST_RETAIN_FRESH_FOR_PROOF === "true";
try {
  for (const name of databaseNames) await recreateDatabase(name);

  fresh = postgres(databaseUrl(databaseNames[0]!), options);
  await prepareSupabaseDatabase(fresh);
  for (const { tag } of journal.entries) await applyMigration(fresh, tag);
  await assertCurrentHead(fresh);

  upgrade = postgres(databaseUrl(databaseNames[1]!), options);
  await prepareSupabaseDatabase(upgrade);
  for (const { tag } of journal.entries.filter(
    ({ tag }) => tag !== apolloPriorHead && tag !== apolloHead && tag !== head,
  )) {
    await applyMigration(upgrade, tag);
  }
  await assertExact0074Preflight(upgrade);
  // Replaying the prior SQL is deliberate: the verifier preserves the
  // repository's additive/idempotent migration contract before asserting the
  // exact 0075 schema that 0076 is allowed to extend.
  await applyMigration(upgrade, apolloPriorHead);
  await applyMigration(upgrade, apolloPriorHead);
  await assertExact0075Preflight(upgrade);

  upgradeCompetitor = postgres(databaseUrl(databaseNames[1]!), options);
  await upgradeCompetitor.unsafe("SET lock_timeout = '250ms'");
  await upgrade.begin(async (transaction) => {
    await transaction.unsafe(
      "LOCK TABLE public.scheduled_job IN SHARE ROW EXCLUSIVE MODE",
    );
    await assert.rejects(
      async () => {
        await upgradeCompetitor!.unsafe(`
          INSERT INTO public.scheduled_job (job_key, kind, run_at, payload)
          VALUES (
            'migration-0076-lock-conflict-proof',
            'proof', now(), '{}'::jsonb
          )
        `);
      },
      (error: unknown) => {
        assert.equal(
          (error as { code?: string }).code,
          "55P03",
          "SHARE ROW EXCLUSIVE must block the ROW EXCLUSIVE lock used by INSERT.",
        );
        return true;
      },
    );
  });
  await upgradeCompetitor.unsafe("RESET lock_timeout");

  await assertMigrationRejectsRunningApollo(upgrade);
  await applyMigration(upgrade, apolloHead);
  await applyMigration(upgrade, apolloHead);
  await applyMigration(upgrade, head);
  await applyMigration(upgrade, head);
  await assertCurrentHead(upgrade);

  upgradeBand = postgres(databaseUrl(databaseNames[2]!), options);
  await prepareSupabaseDatabase(upgradeBand);
  const migrationBandStartIndex = journal.entries.findIndex(
    ({ tag }) => tag === migrationBandStart,
  );
  assert(
    migrationBandStartIndex >= 0,
    "The 0068-0074 migration band start is missing.",
  );
  for (const { tag } of journal.entries.slice(0, migrationBandStartIndex)) {
    await applyMigration(upgradeBand, tag);
  }
  for (const { tag } of journal.entries.slice(migrationBandStartIndex)) {
    await applyMigration(upgradeBand, tag);
  }
  for (const { tag } of journal.entries.slice(migrationBandStartIndex)) {
    await applyMigration(upgradeBand, tag);
  }
  await assertCurrentHead(upgradeBand);

  console.log(
    `Verified ${journal.entries.length} fresh migrations, idempotent prior-head -> ${head}, and idempotent current-schema 0068 -> ${head} additive band.`,
  );
  verificationPassed = true;
} finally {
  await fresh?.end({ timeout: 5 });
  await upgrade?.end({ timeout: 5 });
  await upgradeCompetitor?.end({ timeout: 5 });
  await upgradeBand?.end({ timeout: 5 });
  for (const name of databaseNames) {
    if (
      verificationPassed &&
      retainFreshForProof &&
      name === databaseNames[0]
    ) {
      continue;
    }
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  await admin.end({ timeout: 5 });
}

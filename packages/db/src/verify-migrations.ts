import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import {
  readApollo0075BackfillViolations,
  readApollo0075SchemaState,
} from "./production-migration-0075-discovery";

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
const head = "0075_apollo_search_fencing";
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
      ) as ok
  `;
  assert.equal(
    legacyBackfill?.ok,
    true,
    "Migration 0075 did not link the exact legacy Apollo receipt and job.",
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

let fresh: Sql | undefined;
let upgrade: Sql | undefined;
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
  for (const { tag } of journal.entries.filter(({ tag }) => tag !== head)) {
    await applyMigration(upgrade, tag);
  }
  await assertExact0074Preflight(upgrade);
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

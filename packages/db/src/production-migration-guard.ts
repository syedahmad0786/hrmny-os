import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  HRMNY_PRODUCTION_LEGACY_BASELINE,
  HRMNY_PRODUCTION_MIGRATION_BAND,
  validateProductionMigrationInputs,
  validateProductionMigrationJournal,
} from "./production-migration-contract";

const phase = process.env.PRODUCTION_MIGRATION_PHASE;
assert(
  phase === "preflight" || phase === "verify",
  "PRODUCTION_MIGRATION_PHASE must be preflight or verify.",
);

const target = validateProductionMigrationInputs({
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
const repositoryBand = repositoryJournal.entries
  .filter(
    ({ when }) =>
      BigInt(when) > BigInt(HRMNY_PRODUCTION_LEGACY_BASELINE.createdAt),
  )
  .map(({ tag, when }) => ({ tag, createdAt: String(when) }));
assert.deepEqual(
  repositoryBand,
  HRMNY_PRODUCTION_MIGRATION_BAND,
  "Repository migration journal no longer matches the reviewed 0068-0074 band.",
);
const expectedTailRows = repositoryBand.map(({ tag, createdAt }) => ({
  created_at: createdAt,
  hash: createHash("sha256")
    .update(readFileSync(join(migrationsDirectory, `${tag}.sql`)))
    .digest("hex"),
}));
const expectedTailFingerprint = fingerprint(expectedTailRows);

const db = postgres(target.databaseUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  idle_timeout: 5,
  onnotice: () => undefined,
});

try {
  const [identity] = await db<
    Array<{ database_name: string; journal_exists: boolean; inbox: boolean }>
  >`
    select
      current_database() as database_name,
      to_regclass('drizzle.__drizzle_migrations') is not null as journal_exists,
      to_regclass('public.integration_inbox') is not null as inbox
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
  const tailRows = journalRows.slice(HRMNY_PRODUCTION_LEGACY_BASELINE.count);
  const journal = {
    count: journalRows.length,
    head: journalRows.at(-1)?.created_at ?? null,
    fingerprint: fingerprint(journalRows),
    legacyCount: legacyRows.length,
    legacyFingerprint: fingerprint(legacyRows),
    tailCount: tailRows.length,
    tailFingerprint: fingerprint(tailRows),
    expectedTailFingerprint,
  };

  const [reconciledSchema] = await db<
    Array<{
      crm_quote: boolean;
      inbound_lane: boolean;
      client_onboarding: boolean;
      legacy_readiness: boolean;
    }>
  >`
    select
      to_regclass('public.crm_quote') is not null as crm_quote,
      exists (
        select 1 from pg_enum value
        join pg_type type on type.oid = value.enumtypid
        where type.typname = 'lead_source_lane_enum'
          and value.enumlabel = 'inbound'
      ) as inbound_lane,
      to_regclass('public.client_onboarding') is not null as client_onboarding,
      (
        exists (
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
      ) as legacy_readiness
  `;

  console.log(
    JSON.stringify({
      kind: "production_migration_discovery",
      phase,
      projectRef: target.projectRef,
      targetKind: target.targetKind,
      database: identity?.database_name,
      journal,
      reconciledSchema,
      integrationInbox: identity?.inbox,
    }),
  );

  const journalState = validateProductionMigrationJournal({
    phase,
    count: journal.count,
    head: journal.head,
    inbox: identity?.inbox,
    legacyFingerprint: journal.legacyFingerprint,
    tailCount: journal.tailCount,
    actualTailFingerprint: journal.tailFingerprint,
    expectedTailFingerprint,
    reconciledSchema,
  });

  if (phase === "verify") {
    const [contract] = await db<
      Array<{
        secured_bridge_tables: number;
        work_policy_enabled: boolean;
        outreach_columns: number;
        unique_index: boolean;
        invoice_columns: number;
      }>
    >`
      with expected(table_name) as (
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
          select count(*)::int
          from expected
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
        ) as secured_bridge_tables,
        exists (
          select 1 from public.work_organization_policy
          where organization_key = 'default' and app_policy <> 'disabled'
        ) as work_policy_enabled,
        (
          select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'outreach_items'
            and column_name in (
              'contact_id', 'rework_feedback', 'linkedin_url',
              'cadence_touch', 'accepted_at'
            )
        ) as outreach_columns,
        exists (
          select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'integration_inbox_provider_event_uniq'
        ) as unique_index,
        (
          select count(*)::int from information_schema.columns
          where table_schema = 'public' and table_name = 'invoice'
            and column_name in (
              'contact_name', 'billing_kind', 'trn', 'trn_status',
              'rule_cited', 'source_attached',
              'proposed_by_employee_id', 'approved_by_employee_id'
            )
        ) as invoice_columns
    `;
    assert.equal(
      contract?.secured_bridge_tables,
      17,
      "Not every 0068-0074 bridge table is present, RLS-enabled, and browser-blocked.",
    );
    assert.equal(
      contract?.work_policy_enabled,
      true,
      "Connections app policy is still disabled.",
    );
    assert.equal(
      contract?.outreach_columns,
      5,
      "Sales OS outreach bridge columns are incomplete.",
    );
    assert.equal(
      contract?.unique_index,
      true,
      "Inbox uniqueness contract is missing.",
    );
    assert.equal(
      contract?.invoice_columns,
      8,
      "Invoice gate metadata is incomplete.",
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        phase,
        projectRef: target.projectRef,
        targetKind: target.targetKind,
        database: "postgres",
        backupReceiptConfirmed: true,
        journalState,
        journal,
        integrationInbox: identity?.inbox,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end({ timeout: 5 });
}

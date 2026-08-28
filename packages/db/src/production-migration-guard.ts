import assert from "node:assert/strict";
import postgres from "postgres";
import { validateProductionMigrationInputs } from "./production-migration-contract";

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

const expected =
  phase === "preflight"
    ? { count: 73, head: "1787860800000", inbox: false }
    : { count: 74, head: "1787947200000", inbox: true };
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
  assert.equal(
    identity?.inbox,
    expected.inbox,
    phase === "preflight"
      ? "Migration 0074 already appears present; stop and reconcile before rerunning."
      : "Migration 0074 integration inbox is missing.",
  );

  const [journal] = await db<Array<{ count: number; head: string | null }>>`
    select count(*)::int as count, max(created_at)::text as head
    from drizzle.__drizzle_migrations
  `;
  assert.equal(
    journal?.count,
    expected.count,
    "Migration journal count drifted.",
  );
  assert.equal(journal?.head, expected.head, "Migration journal head drifted.");

  if (phase === "verify") {
    const [contract] = await db<
      Array<{
        unique_index: boolean;
        rls: boolean;
        browser_blocked: boolean;
        invoice_columns: number;
      }>
    >`
      select
        exists (
          select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'integration_inbox_provider_event_uniq'
        ) as unique_index,
        (
          select relrowsecurity from pg_class
          where oid = 'public.integration_inbox'::regclass
        ) as rls,
        not (
          (exists(select 1 from pg_roles where rolname = 'anon')
            and has_table_privilege('anon', 'public.integration_inbox', 'SELECT,INSERT,UPDATE,DELETE'))
          or
          (exists(select 1 from pg_roles where rolname = 'authenticated')
            and has_table_privilege('authenticated', 'public.integration_inbox', 'SELECT,INSERT,UPDATE,DELETE'))
        ) as browser_blocked,
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
      contract?.unique_index,
      true,
      "Inbox uniqueness contract is missing.",
    );
    assert.equal(contract?.rls, true, "Inbox RLS is not enabled.");
    assert.equal(
      contract?.browser_blocked,
      true,
      "Browser roles can access receipts.",
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

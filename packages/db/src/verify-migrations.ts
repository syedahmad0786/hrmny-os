import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";

const adminUrl = new URL(
  process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/postgres",
);
const allowedHosts = new Set(["127.0.0.1", "localhost", "postgres"]);

assert.equal(
  process.env.MIGRATION_TEST_ALLOW_DROP,
  "true",
  "Set MIGRATION_TEST_ALLOW_DROP=true to run destructive test-database checks.",
);
assert(
  allowedHosts.has(adminUrl.hostname),
  `Refusing to create/drop migration-test databases on ${adminUrl.hostname}.`,
);

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
const journal = JSON.parse(
  await readFile(`${migrationsDirectory}meta/_journal.json`, "utf8"),
) as { entries: Array<{ tag: string }> };
const head = "0070_m1_production_readiness";

assert.equal(
  journal.entries.at(-1)?.tag,
  head,
  "Migration journal head drifted.",
);

const options = { max: 1, onnotice: () => undefined } as const;
const admin = postgres(adminUrl.toString(), options);
const databaseNames = ["hrmny_migration_fresh", "hrmny_migration_upgrade"];

function databaseUrl(name: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function recreateDatabase(name: string): Promise<void> {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
}

async function applyMigration(sql: Sql, tag: string): Promise<void> {
  const body = await readFile(`${migrationsDirectory}${tag}.sql`, "utf8");
  await sql.unsafe(body, [], { prepare: false });
}

async function prepareSupabaseDatabase(sql: Sql): Promise<void> {
  const extensions = await sql<
    Array<{ name: string }>
  >`SELECT name FROM pg_available_extensions WHERE name IN ('supabase_vault', 'vector')`;
  assert.deepEqual(
    extensions.map(({ name }) => name).sort(),
    ["supabase_vault", "vector"],
    "The migration test must run on the pinned Supabase PostgreSQL image.",
  );
  await sql.unsafe("CREATE SCHEMA IF NOT EXISTS vault");
}

async function assertDatabaseHead(sql: Sql): Promise<void> {
  const checks = [
    [
      "Work-scoped DAM column is nullable",
      `SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'asset'
          AND column_name = 'work_item_id' AND is_nullable = 'YES'
      ) AS ok`,
    ],
    [
      "Work-scoped DAM foreign key and index exist",
      `SELECT
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_work_item_id_work_item_fk')
        AND EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'asset_work_item_idx') AS ok`,
    ],
    [
      "M1 tables keep RLS enabled",
      `SELECT count(*) = 3 AND bool_and(relrowsecurity) AS ok
       FROM pg_class
       WHERE relnamespace = 'public'::regnamespace
         AND relname IN ('asset', 'employee_role', 'health_signal')`,
    ],
    [
      "Browser Data API roles have no M1 table access",
      `SELECT NOT (
        has_table_privilege('anon', 'public.asset', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.asset', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('anon', 'public.employee_role', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.employee_role', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('anon', 'public.health_signal', 'SELECT,INSERT,UPDATE,DELETE')
        OR has_table_privilege('authenticated', 'public.health_signal', 'SELECT,INSERT,UPDATE,DELETE')
      ) AS ok`,
    ],
    [
      "Audit and asset history remain append-only",
      `SELECT count(*) = 2 AS ok
       FROM pg_trigger
       WHERE tgname IN ('audit_event_immutable', 'asset_version_immutable')
         AND NOT tgisinternal`,
    ],
    [
      "Role membership and health delivery constraints exist",
      `SELECT
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE indexname = 'employee_role_employee_role_uniq'
        ) AND (
          SELECT count(*) = 2
          FROM pg_constraint
          WHERE conname IN (
            'health_signal_delivery_status_check',
            'health_signal_notification_attempts_check'
          )
        ) AS ok`,
    ],
    [
      "Health delivery state is durable",
      `SELECT count(*) = 3 AS ok
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'health_signal'
         AND column_name IN ('delivery_status', 'notification_attempts', 'last_error')`,
    ],
  ] as const;

  for (const [label, query] of checks) {
    const [result] = await sql.unsafe<Array<{ ok: boolean }>>(query);
    assert.equal(result?.ok, true, label);
  }
}

async function assertConcurrentLastPartnerProtection(url: string) {
  const setup = postgres(url, options);
  const partnerRole = await setup<
    Array<{ role_id: string }>
  >`INSERT INTO public.role (key, display_name)
    VALUES ('partner', 'Partner')
    ON CONFLICT (key) DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING role_id`;
  await setup`
    DELETE FROM public.employee_role
    WHERE role_id = ${partnerRole[0]!.role_id}::uuid
  `;
  const employees = [
    "71000000-0000-4000-8000-000000000001",
    "71000000-0000-4000-8000-000000000002",
  ];
  for (const [index, employeeId] of employees.entries()) {
    await setup`
      INSERT INTO public.employee (employee_id, display_name, email)
      VALUES (
        ${employeeId}::uuid,
        ${`Partner proof ${index + 1}`},
        ${`partner-proof-${index + 1}@hrmny.test`}
      )
    `;
    await setup`
      INSERT INTO public.employee_role (employee_id, role_id)
      VALUES (${employeeId}::uuid, ${partnerRole[0]!.role_id}::uuid)
    `;
  }

  const first = postgres(url, options);
  const second = postgres(url, options);
  const revoke = (connection: Sql, employeeId: string) =>
    connection.begin(async (tx) => {
      await tx`
        SELECT employee_role_id FROM public.employee_role
        WHERE employee_id = ${employeeId}::uuid
          AND role_id = ${partnerRole[0]!.role_id}::uuid
        FOR UPDATE
      `;
      await tx`SELECT pg_advisory_xact_lock(hashtext('employee_role:partner'))`;
      const [partners] = await tx<Array<{ count: number }>>`
        SELECT count(distinct membership.employee_id)::int AS count
        FROM public.employee_role membership
        JOIN public.role role ON role.role_id = membership.role_id
        JOIN public.employee employee
          ON employee.employee_id = membership.employee_id
        WHERE role.key = 'partner' AND employee.is_active = true
      `;
      if (Number(partners?.count ?? 0) <= 1) return false;
      await tx`
        DELETE FROM public.employee_role
        WHERE employee_id = ${employeeId}::uuid
          AND role_id = ${partnerRole[0]!.role_id}::uuid
      `;
      return true;
    });
  try {
    const outcomes = await Promise.all([
      revoke(first, employees[0]!),
      revoke(second, employees[1]!),
    ]);
    assert.deepEqual(
      outcomes.sort(),
      [false, true],
      "Concurrent Partner revokes must permit exactly one removal.",
    );
    const [remaining] = await setup<Array<{ count: number }>>`
      SELECT count(*)::int AS count FROM public.employee_role
      WHERE role_id = ${partnerRole[0]!.role_id}::uuid
    `;
    assert.equal(remaining?.count, 1, "Exactly one Partner must remain.");
  } finally {
    await first.end({ timeout: 5 });
    await second.end({ timeout: 5 });
    await setup.end({ timeout: 5 });
  }
}

let fresh: Sql | undefined;
let upgrade: Sql | undefined;

try {
  for (const name of databaseNames) await recreateDatabase(name);

  fresh = postgres(databaseUrl(databaseNames[0]!), options);
  await prepareSupabaseDatabase(fresh);
  for (const { tag } of journal.entries) await applyMigration(fresh, tag);
  await assertDatabaseHead(fresh);
  await assertConcurrentLastPartnerProtection(databaseUrl(databaseNames[0]!));

  upgrade = postgres(databaseUrl(databaseNames[1]!), options);
  await prepareSupabaseDatabase(upgrade);
  for (const { tag } of journal.entries.filter(({ tag }) => tag !== head)) {
    await applyMigration(upgrade, tag);
  }
  await applyMigration(upgrade, head);
  await applyMigration(upgrade, head);
  await assertDatabaseHead(upgrade);

  console.log(
    `Verified ${journal.entries.length} fresh migrations and idempotent 0069 -> 0070 upgrade.`,
  );
} finally {
  await fresh?.end({ timeout: 5 });
  await upgrade?.end({ timeout: 5 });
  for (const name of databaseNames) {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
  await admin.end({ timeout: 5 });
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { validateProduction0075Target } from "./production-migration-0075-contract";

const phase = process.env.PRODUCTION_MIGRATION_PHASE;
assert(["audit", "preflight", "verify"].includes(phase ?? ""));
const target = validateProduction0075Target({
  databaseUrl: process.env.HRMNY_PRODUCTION_DATABASE_URL,
  projectRef: process.env.HRMNY_PRODUCTION_PROJECT_REF,
});
if (phase === "preflight")
  assert.equal(
    process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
    "APPLY MIGRATION 0081 CRM WORKBOOK TO HRMNY PRODUCTION",
  );
const tag = "0081_crm_workbook",
  when = "1788649200000";
const journal = JSON.parse(
  readFileSync(
    new URL("../migrations/meta/_journal.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(journal.entries.at(-1)?.tag, tag);
assert.equal(String(journal.entries.at(-1)?.when), when);
const hashOf = (name: string) =>
  createHash("sha256")
    .update(
      readFileSync(
        new URL(`../migrations/${name}.sql`, import.meta.url),
        "utf8",
      ).replace(/\r\n/g, "\n"),
    )
    .digest("hex");
const hash = hashOf(tag);
const db = postgres(target.databaseUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => undefined,
});
try {
  const rows = await db<
    Array<{ created_at: string; hash: string }>
  >`select created_at::text, hash from drizzle.__drizzle_migrations where created_at >= 1788610200000 order by created_at, id`;
  assert.deepEqual(rows[0], {
    created_at: "1788610200000",
    hash: hashOf("0080_multiple_google_mailboxes"),
  });
  assert(
    rows.length === 1 || rows.length === 2,
    "Unexpected production migration tail",
  );
  const applied = rows.length === 2;
  if (applied) {
    assert.deepEqual(rows[1], { created_at: when, hash });
    const tables = await db<
      Array<{ name: string; rls: boolean; exposed: boolean }>
    >`select relname as name, relrowsecurity as rls,
      has_table_privilege('authenticated', oid, 'select') or has_table_privilege('anon', oid, 'select') as exposed
      from pg_class where oid in ('public.crm_saved_view'::regclass, 'public.client_source_project'::regclass)`;
    assert.equal(tables.length, 2);
    assert(tables.every((t) => t.rls && !t.exposed));
    const [columns] = await db<
      Array<{ count: number }>
    >`select count(*)::int from information_schema.columns
      where table_schema='public' and table_name in ('company','contact') and column_name='owner_employee_id'`;
    assert.equal(columns?.count, 2);
  } else {
    const [existing] =
      await db`select to_regclass('public.crm_saved_view') as views, to_regclass('public.client_source_project') as sources`;
    assert.equal(existing?.views, null);
    assert.equal(existing?.sources, null);
  }
  if (phase === "verify") assert(applied, "0081 is not applied");
  console.log(
    JSON.stringify({
      phase,
      projectRef: target.projectRef,
      state: applied ? "0081" : "0080",
      hash,
      migrationsToApply: applied ? 0 : 1,
    }),
  );
} finally {
  await db.end({ timeout: 5 });
}

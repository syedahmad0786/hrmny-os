import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { validateProduction0075Target } from "./production-migration-0075-contract";
import { HRMNY_PRODUCTION_0078_MIGRATION } from "./production-migration-0078-contract";

const phase = process.env.PRODUCTION_MIGRATION_PHASE;
assert(
  ["audit", "preflight", "verify"].includes(phase ?? ""),
  "Choose audit, preflight or verify.",
);
const target = validateProduction0075Target({
  databaseUrl: process.env.HRMNY_PRODUCTION_DATABASE_URL,
  projectRef: process.env.HRMNY_PRODUCTION_PROJECT_REF,
});
if (phase === "preflight")
  assert.equal(
    process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
    "APPLY MIGRATION 0079 CRM OPERATIONAL TRUTH TO HRMNY PRODUCTION",
  );
const when = "1788602400000";
const tag = "0079_crm_operational_truth";
const journal = JSON.parse(
  readFileSync(
    new URL("../migrations/meta/_journal.json", import.meta.url),
    "utf8",
  ),
);
assert.equal(journal.entries.at(-1)?.tag, tag);
assert.equal(String(journal.entries.at(-1)?.when), when);
const hash = createHash("sha256")
  .update(
    readFileSync(
      new URL(`../migrations/${tag}.sql`, import.meta.url),
      "utf8",
    ).replace(/\r\n/g, "\n"),
  )
  .digest("hex");
// The workflow pins the complete reviewed commit; this additionally binds the journal to its exact SQL bytes.
const db = postgres(target.databaseUrl.toString(), {
  max: 1,
  prepare: false,
  connect_timeout: 15,
  onnotice: () => undefined,
});
try {
  const rows = await db<Array<{ created_at: string; hash: string }>>`
    select created_at::text, hash from drizzle.__drizzle_migrations
    where created_at >= ${HRMNY_PRODUCTION_0078_MIGRATION.createdAt}::bigint order by created_at, id
  `;
  const prior = {
    created_at: HRMNY_PRODUCTION_0078_MIGRATION.createdAt,
    hash: HRMNY_PRODUCTION_0078_MIGRATION.hash,
  };
  assert.deepEqual(
    rows[0],
    prior,
    "Expected the exact previously accepted 0078 migration.",
  );
  assert(rows.length === 1 || rows.length === 2, "Unexpected migration tail.");
  const applied = rows.length === 2;
  if (applied) assert.deepEqual(rows[1], { created_at: when, hash });
  const [columns] = await db<Array<{ count: number }>>`
    select count(*)::int as count from information_schema.columns
    where table_schema='public' and table_name='deal'
      and column_name in ('record_class','classification_reason','opportunity_name','expected_close_date','closed_at','stage_entered_at')
  `;
  assert.equal(
    columns?.count,
    applied ? 6 : 0,
    "Schema and journal disagree; stop for reconciliation.",
  );
  if (phase === "verify") assert(applied, "0079 has not been applied.");
  if (applied) {
    const [triggers] = await db<Array<{ count: number }>>`
      select count(*)::int as count from pg_trigger
      where (tgname='track_deal_commercial_dates' and tgrelid='public.deal'::regclass)
        or (tgname='invalidate_changed_outreach_approval' and tgrelid='public.outreach_items'::regclass)
    `;
    assert.equal(triggers?.count, 2);
    const [fixtures] = await db<Array<{ unclassified: number }>>`
      select count(*)::int as unclassified from public.deal
      where deal_id in ('e0000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000003',
        'e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000005')
        and record_class <> 'synthetic'
    `;
    assert.equal(fixtures?.unclassified, 0);
  }
  console.log(
    JSON.stringify({
      phase,
      projectRef: target.projectRef,
      state: applied ? "0079" : "0078",
      hash,
      migrationsToApply: applied ? 0 : 1,
    }),
  );
} finally {
  await db.end({ timeout: 5 });
}

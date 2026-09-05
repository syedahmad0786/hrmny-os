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
if (phase === "preflight") assert.equal(process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
  "APPLY MIGRATION 0080 MULTIPLE GOOGLE MAILBOXES TO HRMNY PRODUCTION");
const tag = "0080_multiple_google_mailboxes";
const when = "1788610200000";
const journal = JSON.parse(readFileSync(new URL("../migrations/meta/_journal.json", import.meta.url), "utf8"));
assert.equal(journal.entries.at(-1)?.tag, tag);
assert.equal(String(journal.entries.at(-1)?.when), when);
const hashOf = (name: string) => createHash("sha256").update(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8").replace(/\r\n/g, "\n")).digest("hex");
const hash = hashOf(tag);
const db = postgres(target.databaseUrl.toString(), { max: 1, prepare: false, connect_timeout: 15, onnotice: () => undefined });
try {
  const rows = await db<Array<{created_at: string; hash: string}>>`
    select created_at::text, hash from drizzle.__drizzle_migrations where created_at >= 1788602400000 order by created_at, id
  `;
  assert.deepEqual(rows[0], { created_at: "1788602400000", hash: hashOf("0079_crm_operational_truth") }, "Expected the exact accepted 0079 migration.");
  assert(rows.length === 1 || rows.length === 2, "Unexpected migration tail.");
  const applied = rows.length === 2;
  if (applied) assert.deepEqual(rows[1], {created_at: when, hash});
  const indexes = await db<Array<{indexname: string; indexdef: string}>>`
    select indexname, indexdef from pg_indexes where schemaname='public' and tablename='connection_account'
      and indexname in ('connection_account_staff_toolkit_uniq', 'connection_account_staff_provider_uniq', 'connection_account_google_mailbox_uniq')
  `;
  assert.equal(indexes.length, applied ? 2 : 1, "Connection uniqueness and journal disagree.");
  if (applied) {
    assert(!indexes.some(row => row.indexname === "connection_account_staff_toolkit_uniq"));
    for (const name of ["connection_account_staff_provider_uniq", "connection_account_google_mailbox_uniq"]) {
      const definition = indexes.find(row => row.indexname === name)?.indexdef ?? "";
      assert.match(definition, /CREATE UNIQUE INDEX/);
      assert.match(definition, /owner_employee_id/);
      assert.match(definition, /google_workspace/);
      assert.match(definition, /staff/);
      if (name.endsWith("mailbox_uniq")) assert.match(definition, /lower\(btrim\(COALESCE\(external_connection_id/i);
      else assert.match(definition, /NOT/);
    }
  } else assert.equal(indexes[0]?.indexname, "connection_account_staff_toolkit_uniq");
  if (phase === "verify") assert(applied, "0080 is not applied.");
  console.log(JSON.stringify({ phase, projectRef: target.projectRef, state: applied ? "0080" : "0079", hash, migrationsToApply: applied ? 0 : 1 }));
} finally { await db.end({timeout: 5}); }

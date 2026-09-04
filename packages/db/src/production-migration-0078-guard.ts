import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  HRMNY_PRODUCTION_0078_MIGRATION,
  validateProduction0078Inputs,
  validateProduction0078State,
  type Production0078Phase,
} from "./production-migration-0078-contract";
import type { Production0075To0077JournalRow } from "./production-migration-0075-0077-contract";
import { HRMNY_PRODUCTION_0077_MIGRATION } from "./production-migration-0075-0077-contract";

const phase = process.env.PRODUCTION_MIGRATION_PHASE as
  Production0078Phase | undefined;
assert(
  phase === "audit" || phase === "preflight" || phase === "verify",
  "PRODUCTION_MIGRATION_PHASE must be audit, preflight, or verify.",
);

const target = validateProduction0078Inputs({
  phase,
  databaseUrl: process.env.HRMNY_PRODUCTION_DATABASE_URL,
  projectRef: process.env.HRMNY_PRODUCTION_PROJECT_REF,
  confirmation: process.env.HRMNY_PRODUCTION_MIGRATION_CONFIRMATION,
});

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
const journal = JSON.parse(
  readFileSync(join(migrationsDirectory, "meta", "_journal.json"), "utf8"),
) as { entries: Array<{ tag: string; when: number }> };
assert.deepEqual(journal.entries.at(-1), {
  idx: 77,
  version: "7",
  when: Number(HRMNY_PRODUCTION_0078_MIGRATION.createdAt),
  tag: HRMNY_PRODUCTION_0078_MIGRATION.tag,
  breakpoints: true,
});
const migrationHash = createHash("sha256")
  .update(
    readFileSync(
      join(migrationsDirectory, `${HRMNY_PRODUCTION_0078_MIGRATION.tag}.sql`),
      "utf8",
    ).replace(/\r\n/g, "\n"),
  )
  .digest("hex");
assert.equal(
  migrationHash,
  HRMNY_PRODUCTION_0078_MIGRATION.hash,
  "Reviewed 0078 SQL hash drifted.",
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

  const migrationRows = await db<Production0075To0077JournalRow[]>`
    select created_at::text, hash
    from drizzle.__drizzle_migrations
    where created_at >= ${HRMNY_PRODUCTION_0077_MIGRATION.createdAt}::bigint
    order by created_at, id
  `;
  const marketRows = await db<Array<{ value: string }>>`
    select enumlabel as value
    from pg_enum
    join pg_type on pg_type.oid = pg_enum.enumtypid
    join pg_namespace on pg_namespace.oid = pg_type.typnamespace
    where pg_namespace.nspname = 'public'
      and pg_type.typname = 'market_enum'
    order by enumsortorder
  `;
  const state = validateProduction0078State({
    phase,
    migrationRows,
    marketValues: marketRows.map(({ value }) => value),
  });
  console.log(
    JSON.stringify({
      kind: "production_migration_0078_readback",
      phase,
      projectRef: target.projectRef,
      targetKind: target.targetKind,
      ...state,
      marketValues: marketRows.map(({ value }) => value),
      migrationHash,
    }),
  );
} finally {
  await db.end({ timeout: 5 });
}

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

function readMigration(name: string): string {
  return readFileSync(`${migrationsDirectory}${name}`, "utf8");
}

type CreatedTable = { schema: string; name: string };

function createdTables(sql: string): CreatedTable[] {
  return [
    ...sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"?([a-z_]+)"?\.)?"?([a-z_]+)"?/gi,
    ),
  ].map((match) => ({ schema: match[1] ?? "public", name: match[2]! }));
}

function expectPrivateTableLockdown(
  migration: string,
  migrationName: string,
  { schema, name }: CreatedTable,
): void {
  const target = `${schema}.${name}`;
  const apiRoleRevokes = migration.replace(/'\s*\r?\n\s*'/g, "");
  expect(
    migration,
    `${migrationName} does not revoke ${schema} from PUBLIC`,
  ).toMatch(
    new RegExp(
      `REVOKE ALL PRIVILEGES\\s+ON SCHEMA\\s+${schema}\\s+FROM PUBLIC`,
      "i",
    ),
  );
  expect(
    migration,
    `${migrationName} does not revoke ${target} from PUBLIC`,
  ).toMatch(
    new RegExp(
      `REVOKE ALL PRIVILEGES\\s+ON TABLE\\s+${schema}\\.${name}\\s+FROM PUBLIC`,
      "i",
    ),
  );
  expect(
    migration,
    `${migrationName} does not revoke ${schema} functions from PUBLIC`,
  ).toMatch(
    new RegExp(`REVOKE ALL PRIVILEGES\\s+ON FUNCTION\\s+${schema}\\.`, "i"),
  );
  expect(
    migration,
    `${migrationName} does not restrict Supabase API roles`,
  ).toMatch(
    /WHERE rolname IN \('anon', 'authenticated', 'authenticator', 'service_role'\)/,
  );
  expect(
    apiRoleRevokes,
    `${migrationName} does not revoke ${schema} from API roles`,
  ).toMatch(
    new RegExp(
      `REVOKE ALL PRIVILEGES\\s+ON SCHEMA\\s+${schema}\\s+FROM %I`,
      "i",
    ),
  );
  expect(
    apiRoleRevokes,
    `${migrationName} does not revoke ${target} from API roles`,
  ).toMatch(
    new RegExp(
      `REVOKE ALL PRIVILEGES\\s+ON TABLE\\s+${schema}\\.${name}\\s+FROM %I`,
      "i",
    ),
  );
  expect(
    apiRoleRevokes,
    `${migrationName} does not revoke ${schema} functions from API roles`,
  ).toMatch(
    new RegExp(
      `REVOKE ALL PRIVILEGES\\s+ON FUNCTION\\s+${schema}\\..+\\s+FROM %I`,
      "i",
    ),
  );
}

describe("production migration security", () => {
  it("locks every application table away from the browser Data API", () => {
    const tables = new Set(
      [
        "0000_early_morph.sql",
        "0002_crm_entities.sql",
        "0003_pgvector_memory.sql",
        "0004_tickets.sql",
        "0006_connectors_feature_requests.sql",
      ].flatMap((name) =>
        createdTables(readMigration(name)).map(({ name }) => name),
      ),
    );
    const lockdown = readMigration("0005_lock_down_data_api.sql");
    const listedTables = lockdown
      .split("-- BEGIN APP TABLES")[1]!
      .split("-- END APP TABLES")[0]!
      .match(/'([a-z_]+)'/g)!
      .map((value) => value.slice(1, -1));

    expect(new Set(listedTables)).toEqual(tables);
  });

  it("keeps the margin view invoker-secured", () => {
    expect(readMigration("0001_v_client_margin.sql")).toMatch(
      /WITH \(security_invoker = true\)/,
    );
  });

  it("journals every production migration in order", () => {
    const journal = JSON.parse(readMigration("meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    const migrationTags = readdirSync(migrationsDirectory)
      .filter(
        (name) => /^\d{4}_.+\.sql$/.test(name) && name !== "0000_clean.sql",
      )
      .sort()
      .map((name) => name.slice(0, -4));

    expect(journal.entries.map(({ tag }) => tag)).toEqual(migrationTags);
    expect(journal.entries.map(({ idx }) => idx)).toEqual(
      migrationTags.map((_, index) => index),
    );
  });

  it("locks every post-M1 module away from the browser Data API", () => {
    const migrations = readdirSync(migrationsDirectory)
      .filter((name) => /^00(?:0[9]|[1-9]\d)_.+\.sql$/.test(name))
      .sort();
    for (const name of migrations) {
      const migration = readMigration(name);
      const tables = createdTables(migration);
      const publicTables = tables.filter(({ schema }) => schema === "public");
      for (const table of publicTables) {
        expect(migration, `${name} does not list ${table.name}`).toContain(
          `'${table.name}'`,
        );
      }
      for (const table of tables) {
        if (table.schema !== "public") {
          expectPrivateTableLockdown(migration, name, table);
        }
      }
      if (publicTables.length === 0) continue;
      expect(migration, name).toMatch(/ENABLE ROW LEVEL SECURITY/i);
      expect(migration, name).toMatch(/FROM PUBLIC/i);
      expect(migration, name).toMatch(/FROM anon/i);
      expect(migration, name).toMatch(/FROM authenticated/i);
    }
  });
});

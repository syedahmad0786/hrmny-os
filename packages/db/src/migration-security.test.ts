import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationsDirectory = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);

function readMigration(name: string): string {
  return readFileSync(`${migrationsDirectory}${name}`, "utf8");
}

function createdTables(sql: string): string[] {
  return [
    ...sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:public\.)?"?([a-z_]+)"?/gi,
    ),
  ].map((match) => match[1]!);
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
      ].flatMap((name) => createdTables(readMigration(name))),
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

    expect(journal.entries.map(({ tag }) => tag)).toEqual([
      "0000_early_morph",
      "0001_v_client_margin",
      "0002_crm_entities",
      "0003_pgvector_memory",
      "0004_tickets",
      "0005_lock_down_data_api",
      "0006_connectors_feature_requests",
      "0007_m1_production_hardening",
      "0008_employee_directory",
    ]);
    expect(journal.entries.map(({ idx }) => idx)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/0085_discovery_programmes.sql", import.meta.url),
  ),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ tag: string }> };

describe("Discovery programme migration contract", () => {
  it("installs immutable versions, optimistic state, stable bindings, and server-only access", () => {
    expect(journal.entries.map(({ tag }) => tag)).toContain(
      "0085_discovery_programmes",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.research_programme (",
    );
    expect(migration).toContain("version integer NOT NULL DEFAULT 1");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.research_programme_version (",
    );
    expect(migration).toContain(
      "CONSTRAINT research_programme_version_uniq UNIQUE",
    );
    expect(migration).toContain("research_programme_version_immutable_trg");
    expect(migration).toContain("research_programme_version_no_truncate_trg");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.research_programme_source_binding (",
    );
    expect(migration).toContain(
      "CONSTRAINT research_programme_source_uniq UNIQUE",
    );
    expect(migration).toContain(
      "account_reference_id uuid REFERENCES public.connection_account(connection_account_id) ON DELETE SET NULL",
    );
    expect(migration).toContain(
      "research_programme_source_connection_removed_trg",
    );
    expect(migration).toContain(
      "NEW.credential_generation := OLD.credential_generation + 1",
    );
    expect(migration).toContain(
      "NEW.checkpoint_version := OLD.checkpoint_version + 1",
    );
    expect(migration).toContain(
      "checkpoint_version integer NOT NULL DEFAULT 0",
    );
    expect(migration).toContain(
      "ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated",
    );
    expect(migration).toContain(
      "IF app_table = 'research_programme_version' THEN",
    );
    expect(migration).toContain(
      "GRANT SELECT, INSERT ON TABLE public.%I TO service_role",
    );
  });
});

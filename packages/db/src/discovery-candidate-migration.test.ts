import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/0087_discovery_candidates.sql", import.meta.url),
  ),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ tag: string }> };

describe("Discovery candidate migration contract", () => {
  it("installs review candidates, observation relation, and server-only access", () => {
    expect(journal.entries.at(-1)?.tag).toBe("0087_discovery_candidates");
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.discovery_candidate (",
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS public.discovery_observation (",
    );
    expect(migration).toContain("qualification_state = 'not_assessed'");
    expect(migration).toContain("discovery_candidate_open_key_uniq");
    expect(migration).toContain("discovery_observation_content_uniq");
    expect(migration).toContain("discovery_observation_guard_trg");
    expect(migration).toContain(
      "Discovery observations are immutable except redaction",
    );
    expect(migration).toContain(
      "ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY",
    );
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON TABLE public.%I FROM authenticated",
    );
    expect(migration).toContain(
      "never writes BUAF, contacts or deals",
    );
  });
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL("../migrations/0077_qm_control_repository.sql", import.meta.url),
  ),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ idx: number; tag: string }> };

describe("0077 QM control repository migration", () => {
  it("is the additive journal head after the preserved Apollo migrations", () => {
    expect(
      journal.entries.slice(-3).map(({ idx, tag }) => ({ idx, tag })),
    ).toEqual([
      { idx: 74, tag: "0075_apollo_search_fencing" },
      { idx: 75, tag: "0076_apollo_people_search_serialization" },
      { idx: 76, tag: "0077_qm_control_repository" },
    ]);
  });

  it("creates only the session binding and append-only decision ledger", () => {
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(2);
    expect(migration).toContain("public.qm_session_binding");
    expect(migration).toContain("public.qm_command_decision");
    expect(migration).toContain("QM_DECISION_IMMUTABLE");
    expect(migration).not.toMatch(
      /effect_outbox|effect_executor|credential|secret/i,
    );
  });

  it("pins identity, runtime, replay, policy, and browser-role boundaries", () => {
    for (const contract of [
      "qm_session_scope_chk",
      "qm_session_runtime_chk",
      "qm_session_upstream_pin_chk",
      "qm_decision_request_uniq",
      "qm_decision_reason_outcome_chk",
      "qm_decision_session_metadata_chk",
      "qm_decision_work_record_chk",
      ") IS TRUE",
      "ENABLE ROW LEVEL SECURITY",
      "FROM anon",
      "FROM authenticated",
    ]) {
      expect(migration).toContain(contract);
    }
  });
});

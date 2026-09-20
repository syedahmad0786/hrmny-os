import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../migrations/0086_discovery_run_coordinator.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);
const journal = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../migrations/meta/_journal.json", import.meta.url)),
    "utf8",
  ),
) as { entries: Array<{ tag: string }> };

describe("Discovery run coordinator migration contract", () => {
  it("registers programme next-due and exclusive sales_research_run slots", () => {
    expect(journal.entries.map(({ tag }) => tag)).toContain(
      "0086_discovery_run_coordinator",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS next_due_at timestamptz",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS research_programme_id uuid",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS research_programme_version_id uuid",
    );
    expect(migration).toContain(
      "ADD COLUMN IF NOT EXISTS overall_deadline_at timestamptz",
    );
    expect(migration).toContain("scheduled_job_research_programme_fk");
    expect(migration).toContain("scheduled_job_research_programme_version_fk");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS scheduled_job_status_check");
    expect(migration).toContain("'dead_letter'");
    expect(migration).toContain("scheduled_job_discovery_contract_chk");
    expect(migration).toContain("kind <> 'sales_research_run'");
    expect(migration).toContain("scheduled_job_discovery_pending_uniq");
    expect(migration).toContain("scheduled_job_discovery_deferred_uniq");
    expect(migration).toContain("scheduled_job_discovery_active_uniq");
    expect(migration).toContain("status IN ('running', 'cancel_requested')");
    expect(migration).toContain(
      "Heartbeat leases must never extend beyond it.",
    );
  });
});

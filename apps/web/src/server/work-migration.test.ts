import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("work migration compatibility", () => {
  it("upgrades the earlier timesheet project table", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0019_work_management.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0019_work_management.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0019_work_management.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS owner_employee_id/i);
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS source_platform/i);
    expect(migration).toMatch(/ALTER COLUMN code DROP NOT NULL/i);
  });

  it("extends the shared timesheet and project tables for planning", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0023_work_planning.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0023_work_planning.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0023_work_planning.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ALTER TABLE public\.time_entry/i);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.work_goal/i);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_portfolio/i,
    );
    expect(migration).toMatch(/work_timer_employee_active_uniq/i);
  });

  it("persists Asana event cursors for recurring reconciliation", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0024_asana_sync.sql"),
      join(process.cwd(), "../../packages/db/migrations/0024_asana_sync.sql"),
      join(__dirname, "../../../../packages/db/migrations/0024_asana_sync.sql"),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.asana_sync_state/i,
    );
    expect(migration).toMatch(/'dry_run', 'import', 'sync'/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds teams, guest shares, licenses, and organization policy", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0025_work_governance.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0025_work_governance.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0025_work_governance.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.work_team/i);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_project_guest/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_member_license/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_organization_policy/i,
    );
    expect(migration).toMatch(
      /work_team_project[\s\S]*access_level text NOT NULL DEFAULT 'editor'/i,
    );
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds enforced SSO configuration and hashed SCIM credentials", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0026_work_identity.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0026_work_identity.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0026_work_identity.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_sso_configuration/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_scim_token/i,
    );
    expect(migration).toMatch(/token_hash text NOT NULL UNIQUE/i);
    expect(migration).toMatch(/employee_email_lower_uniq/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores signed Asana webhook subscriptions and deduplicated receipts", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0027_asana_webhooks.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0027_asana_webhooks.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0027_asana_webhooks.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.asana_webhook_subscription/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.asana_webhook_receipt/i,
    );
    expect(migration).toMatch(/payload_hash text NOT NULL/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds scoped Work API tokens and a durable signed webhook outbox", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0028_work_api_webhooks.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0028_work_api_webhooks.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0028_work_api_webhooks.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_api_token/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_webhook_delivery/i,
    );
    expect(migration).toMatch(/token_hash text NOT NULL UNIQUE/i);
    expect(migration).toMatch(/queue_work_webhook_event/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds governed AI runs, usage limits, retention, and approved actions", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0029_work_ai.sql"),
      join(process.cwd(), "../../packages/db/migrations/0029_work_ai.sql"),
      join(__dirname, "../../../../packages/db/migrations/0029_work_ai.sql"),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_ai_policy/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_ai_run/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_ai_action_execution/i,
    );
    expect(migration).toMatch(/require_human_approval boolean NOT NULL/i);
    expect(migration).toMatch(/expires_at timestamptz NOT NULL/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds no-code AI Studio workflows and durable executions", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0030_work_ai_studio.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0030_work_ai_studio.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0030_work_ai_studio.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_ai_studio_workflow/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_ai_studio_run/i,
    );
    expect(migration).toMatch(/allowed_action_types text\[\] NOT NULL/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds access-scoped AI Teammates, skills, and task-bound memory", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0031_work_ai_teammates.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0031_work_ai_teammates.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0031_work_ai_teammates.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    for (const table of [
      "work_ai_teammate",
      "work_ai_teammate_member",
      "work_ai_teammate_project_access",
      "work_ai_teammate_skill",
      "work_ai_teammate_memory",
      "work_ai_teammate_run",
    ])
      expect(migration).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"),
      );
    expect(migration).toMatch(/forgotten_at timestamptz/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds approval-backed teammate actions, follow-ups, and interruption", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0032_work_ai_teammate_actions.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0032_work_ai_teammate_actions.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0032_work_ai_teammate_actions.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    for (const action of [
      "create_subtask",
      "set_custom_field",
      "bulk_update_tasks",
      "add_dependency",
      "create_milestone",
      "attach_file",
      "schedule_follow_up",
    ])
      expect(migration).toContain(`'${action}'`);
    expect(migration).toMatch(/'cancelled'/i);
  });

  it("adds explicitly granted AI Teammate connected data", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0033_work_ai_connected_data.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0033_work_ai_connected_data.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0033_work_ai_connected_data.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/allowed_connected_apps text\[\]/i);
    expect(migration).toContain("'google_workspace'");
    expect(migration).toContain("'create_external_file'");
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds idempotent extended Asana planning and governance import fields", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0034_asana_extended_import.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0034_asana_extended_import.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0034_asana_extended_import.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    for (const table of [
      "work_goal",
      "work_goal_link",
      "work_portfolio",
      "work_status_update",
      "work_template",
      "time_entry",
    ]) {
      expect(migration).toMatch(new RegExp(`${table}[^;]+external_id`, "i"));
    }
    expect(migration).toContain("'partial'");
    expect(migration).toContain("'on_hold'");
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

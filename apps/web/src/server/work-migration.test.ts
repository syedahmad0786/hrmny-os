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
    expect(migration).toMatch(/ALTER COLUMN code SET DEFAULT/i);
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

  it("adds source-scoped Asana reconciliation provenance", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0035_asana_reconciliation.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0035_asana_reconciliation.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0035_asana_reconciliation.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/source_workspace_external_id text/i);
    expect(migration).toMatch(/source_connection_external_id text/i);
    for (const table of [
      "work_project_member",
      "work_team_member",
      "work_team_project",
      "work_portfolio_project",
      "work_project_item",
      "work_item_dependency",
      "work_item_follower",
      "work_item_tag",
      "work_custom_field_value",
    ]) {
      expect(migration).toMatch(
        new RegExp(
          `ALTER TABLE public\\.${table}[\\s\\S]+?external_id text`,
          "i",
        ),
      );
    }
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("registers one verified external Work sandbox", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0036_work_sandbox.sql"),
      join(process.cwd(), "../../packages/db/migrations/0036_work_sandbox.sql"),
      join(
        __dirname,
        "../../../../packages/db/migrations/0036_work_sandbox.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_sandbox/i,
    );
    expect(migration).toMatch(/UNIQUE \(organization_key\)/i);
    expect(migration).toMatch(/database_fingerprint text NOT NULL/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("adds durable scheduled and collaborator-triggered Work rules", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0037_work_scheduled_rules.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0037_work_scheduled_rules.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0037_work_scheduled_rules.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS schedule_minutes/i);
    expect(migration).toContain("'collaborator_added'");
    expect(migration).toContain("'scheduled'");
    expect(migration).toMatch(/work_rule_schedule_check/i);
    expect(migration).toMatch(
      /trigger_type = 'scheduled' AND schedule_minutes IS NOT NULL/i,
    );
  });

  it("adds scoped messages, replies, followers, and one-target reactions", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0038_work_messages_likes.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0038_work_messages_likes.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0038_work_messages_likes.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    for (const table of [
      "work_message",
      "work_message_comment",
      "work_message_follower",
      "work_like",
    ])
      expect(migration).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"),
      );
    expect(migration).toMatch(
      /CHECK \(num_nonnulls\(work_project_id, work_team_id\) = 1\)/i,
    );
    expect(migration).toMatch(/work_message_comment_id uuid/i);
    expect(migration).toContain("'message'");
    expect(migration).toContain("'status_update'");
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores normalized proofing pins against actionable subtasks", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0039_work_proofing.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0039_work_proofing.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0039_work_proofing.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_proof_annotation/i,
    );
    expect(migration).toMatch(/work_attachment_id uuid NOT NULL/i);
    expect(migration).toMatch(/work_item_id uuid NOT NULL UNIQUE/i);
    expect(migration).toMatch(/x_position >= 0 AND x_position <= 1/i);
    expect(migration).toMatch(/y_position >= 0 AND y_position <= 1/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores multiple secure out-of-office periods per employee", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0040_work_out_of_office.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0040_work_out_of_office.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0040_work_out_of_office.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_out_of_office/i,
    );
    expect(migration).toMatch(/employee_id uuid NOT NULL/i);
    expect(migration).toMatch(/CHECK \(end_date >= start_date\)/i);
    expect(migration).not.toMatch(/UNIQUE\s*\(employee_id\)/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores secure personal accessibility preferences", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0041_work_accessibility.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0041_work_accessibility.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0041_work_accessibility.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_accessibility_preference/i,
    );
    expect(migration).toMatch(/employee_id uuid PRIMARY KEY/i);
    expect(migration).toMatch(/'system', 'light', 'dark'/i);
    expect(migration).toMatch(/colorblind_mode boolean/i);
    expect(migration).toMatch(/reduced_motion boolean/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores private My Tasks sections and clears them on reassignment", () => {
    const candidates = [
      join(process.cwd(), "packages/db/migrations/0042_work_my_tasks.sql"),
      join(
        process.cwd(),
        "../../packages/db/migrations/0042_work_my_tasks.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0042_work_my_tasks.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_my_tasks_section/i,
    );
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_my_tasks_membership/i,
    );
    expect(migration).toMatch(
      /FOREIGN KEY \(work_my_tasks_section_id, employee_id\)/i,
    );
    expect(migration).toMatch(
      /AFTER UPDATE OF assignee_employee_id ON public\.work_item/i,
    );
    expect(migration).toMatch(/DELETE FROM public\.work_my_tasks_membership/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores secure employee-owned weekly focus history", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0043_work_my_tasks_focus.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0043_work_my_tasks_focus.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0043_work_my_tasks_focus.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_my_tasks_focus/i,
    );
    expect(migration).toMatch(/PRIMARY KEY \(employee_id, week_start\)/i);
    expect(migration).toMatch(/length\(focus_text\) <= 500/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("marks one hidden personal task project per employee", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0044_work_personal_projects.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0044_work_personal_projects.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0044_work_personal_projects.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS project_kind/i);
    expect(migration).toMatch(/'standard', 'personal'/i);
    expect(migration).toMatch(
      /UNIQUE INDEX IF NOT EXISTS work_project_personal_owner_uniq/i,
    );
    expect(migration).toMatch(/WHERE project_kind = 'personal'/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("source-scopes imported Asana My Tasks sections", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0045_asana_my_tasks_import.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0045_asana_my_tasks_import.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0045_asana_my_tasks_import.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS source_platform/i);
    expect(migration).toMatch(/work_my_tasks_section_source_uniq/i);
    expect(migration).toMatch(/source_connection_external_id/i);
    expect(migration).toMatch(/WHERE external_id IS NOT NULL/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores shared custom task types with completion-aware statuses", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0046_work_custom_task_types.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0046_work_custom_task_types.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0046_work_custom_task_types.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    for (const table of [
      "work_custom_task_type",
      "work_custom_task_status_option",
      "work_project_custom_task_type",
    ])
      expect(migration).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"),
      );
    expect(migration).toMatch(/work_custom_task_type_id uuid/i);
    expect(migration).toMatch(/work_custom_task_status_option_id uuid/i);
    expect(migration).toMatch(/'incomplete', 'complete'/i);
    expect(migration).toMatch(/apply_default_custom_task_type/i);
    expect(migration).toMatch(/sync_custom_task_status_completion/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("permits custom task statuses in rules and governed AI", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0047_work_custom_task_type_automation.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0047_work_custom_task_type_automation.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0047_work_custom_task_type_automation.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toContain("'custom_status_changed'");
    expect(migration).toContain("'set_custom_task_status'");
    expect(migration).toMatch(/work_rule_trigger_type_check/i);
    expect(migration).toMatch(/work_ai_studio_workflow_trigger_type_check/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores custom task type defaults and user or team access", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0048_work_custom_task_type_access.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0048_work_custom_task_type_access.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0048_work_custom_task_type_access.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/default_access_level/i);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_custom_task_type_member/i,
    );
    expect(migration).toContain("'admin', 'editor', 'user', 'none'");
    expect(migration).toMatch(/member_type = 'employee'/i);
    expect(migration).toMatch(/member_type = 'team'/i);
    expect(migration).toMatch(/created_by_employee_id, 'admin'/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("stores and locks imported custom field memberships", () => {
    const candidates = [
      join(
        process.cwd(),
        "packages/db/migrations/0054_work_custom_field_access.sql",
      ),
      join(
        process.cwd(),
        "../../packages/db/migrations/0054_work_custom_field_access.sql",
      ),
      join(
        __dirname,
        "../../../../packages/db/migrations/0054_work_custom_field_access.sql",
      ),
    ];
    const path = candidates.find(existsSync);
    expect(path).toBeTruthy();
    const migration = readFileSync(path!, "utf8");
    expect(migration).toMatch(/privacy_setting/i);
    expect(migration).toMatch(/default_access_level/i);
    expect(migration).toMatch(/is_value_read_only/i);
    expect(migration).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.work_custom_field_member/i,
    );
    expect(migration).toMatch(/member_type = 'employee'/i);
    expect(migration).toMatch(/member_type = 'team'/i);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });
});

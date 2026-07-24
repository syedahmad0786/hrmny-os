import { sql, type Db } from "@hrmny/db";
import type {
  AsanaGoal,
  AsanaStatusUpdate,
  AsanaTask,
} from "@hrmny/integrations";
import type { AsanaWorkspaceScan } from "./asana-migration";

type WorkItemType = "task" | "milestone" | "approval";

export function asanaItemType(resourceSubtype?: string): WorkItemType {
  if (resourceSubtype === "milestone") return "milestone";
  if (resourceSubtype === "approval") return "approval";
  return "task";
}

export function asanaDueAt(task: AsanaTask): string | null {
  if (task.due_at) return task.due_at;
  return task.due_on ? `${task.due_on}T23:59:59.999Z` : null;
}

function completedAt(task: AsanaTask): string | null {
  if (!task.completed) return null;
  return (
    task.completed_at ??
    task.modified_at ??
    task.created_at ??
    new Date().toISOString()
  );
}

function fieldType(field: Record<string, unknown>): string {
  const type = String(field.resource_subtype ?? field.type ?? "text");
  if (type.includes("multi_enum")) return "multi_select";
  if (type.includes("enum")) return "single_select";
  if (type.includes("number")) return "number";
  if (type.includes("date")) return "date";
  if (type.includes("people")) return "people";
  return "text";
}

function limited(value: string, length: number): string {
  return value.trim().slice(0, length) || "Untitled";
}

function textArray(values: readonly string[]) {
  return values.length
    ? sql`array[${sql.join(
        values.map((value) => sql`${value}`),
        sql.raw(", "),
      )}]::text[]`
    : sql`array[]::text[]`;
}

const ASANA_COLORS: Record<string, string> = {
  "dark-blue": "#2A5CAA",
  "dark-brown": "#765548",
  "dark-green": "#2E7D5B",
  "dark-orange": "#B85C24",
  "dark-pink": "#A83E78",
  "dark-purple": "#6B4AA5",
  "dark-red": "#A83A3A",
  "dark-teal": "#237C7C",
  "dark-warm-gray": "#68615D",
  "light-blue": "#5B8DEF",
  "light-brown": "#A98274",
  "light-green": "#5DAE78",
  "light-orange": "#E59A4A",
  "light-pink": "#D979A8",
  "light-purple": "#9674D4",
  "light-red": "#D96B6B",
  "light-teal": "#55AFAF",
  "light-warm-gray": "#9B938E",
};

export function asanaColor(color?: string): string {
  return color ? (ASANA_COLORS[color] ?? "#C7702E") : "#C7702E";
}

export function asanaGoalStatus(status?: string): string {
  return (
    {
      green: "on_track",
      yellow: "at_risk",
      red: "off_track",
    }[status ?? ""] ??
    ([
      "on_track",
      "at_risk",
      "off_track",
      "achieved",
      "partial",
      "missed",
      "dropped",
    ].includes(status ?? "")
      ? status!
      : "on_track")
  );
}

export function asanaGoalProgress(goal: AsanaGoal): number {
  const initial = goal.metric?.initial_number_value;
  const target = goal.metric?.target_number_value;
  const current = goal.metric?.current_number_value;
  if (
    typeof initial !== "number" ||
    typeof target !== "number" ||
    typeof current !== "number" ||
    initial === target
  ) {
    return goal.status === "achieved" ? 100 : 0;
  }
  return Math.min(
    100,
    Math.max(0, ((current - initial) / (target - initial)) * 100),
  );
}

function asanaStatusHealth(status: AsanaStatusUpdate): string {
  const value = status.status_type;
  if (
    [
      "on_track",
      "at_risk",
      "off_track",
      "on_hold",
      "complete",
      "achieved",
      "partial",
      "missed",
      "dropped",
    ].includes(value ?? "")
  ) {
    return value!;
  }
  return asanaGoalStatus(value);
}

function privateInAsana(value?: string): "private" | "organization" {
  return value?.includes("private") || value === "members_only"
    ? "private"
    : "organization";
}

function teamPrivacy(value?: string): "public" | "request" | "private" {
  if (value === "public") return "public";
  if (value === "secret" || value === "private") return "private";
  return "request";
}

function accessLevel(
  value?: string,
): "admin" | "editor" | "commenter" | "viewer" {
  return value === "admin" || value === "commenter" || value === "viewer"
    ? value
    : "editor";
}

export type AsanaImportSummary = {
  teams: number;
  teamMemberships: number;
  projects: number;
  projectMemberships: number;
  sections: number;
  myTaskSections: number;
  myTasks: number;
  tasks: number;
  projectTaskLinks: number;
  dependencies: number;
  followers: number;
  tags: number;
  customTaskTypes: number;
  customTaskStatuses: number;
  projectCustomTaskTypes: number;
  customFieldValues: number;
  comments: number;
  attachments: number;
  timeTrackingEntries: number;
  goals: number;
  goalRelationships: number;
  portfolios: number;
  portfolioItems: number;
  templates: number;
  statusUpdates: number;
};

export async function importAsanaWorkspace(input: {
  db: Db;
  scan: AsanaWorkspaceScan;
  workspaceGid: string;
  workspaceName: string;
  connectedAccountId: string;
  actorEmployeeId: string;
  mode?: "import" | "sync";
}): Promise<{ runId: string; summary: AsanaImportSummary }> {
  const { db, scan, actorEmployeeId } = input;
  if (scan.depth !== "full") {
    throw new Error(
      "Asana import requires a full scan for safe reconciliation",
    );
  }
  const [run] = await db.execute(sql<{ run_id: string }>`
    insert into public.work_migration_run (
      source_platform, workspace_external_id, workspace_name, mode, status,
      requested_by_employee_id
    ) values (
      'asana', ${input.workspaceGid}, ${input.workspaceName},
      ${input.mode ?? "import"}, 'running',
      ${actorEmployeeId}::uuid
    )
    returning work_migration_run_id as run_id
  `);
  const runId = String(run!.run_id);

  try {
    // ponytail: one transaction keeps imports atomic; batch by project if a measured
    // workspace size exceeds the database transaction timeout.
    const summary = await db.transaction(async (tx) => {
      const employeeRows = await tx.execute(
        sql<{ employee_id: string; email: string }>`
          select employee_id, lower(email) as email
          from public.employee
          where is_active = true
        `,
      );
      const employees = new Map(
        employeeRows.map((row) => [String(row.email), String(row.employee_id)]),
      );
      const employeeFor = (email?: string) =>
        email ? (employees.get(email.toLowerCase()) ?? null) : null;
      const employeeByAsanaGid = new Map(
        scan.users
          .map((user) => [user.gid, employeeFor(user.email)] as const)
          .filter((entry): entry is readonly [string, string] =>
            Boolean(entry[1]),
          ),
      );
      const employeeForUser = (
        user?: { gid?: string; email?: string } | null,
      ) =>
        employeeFor(user?.email) ??
        (user?.gid ? (employeeByAsanaGid.get(user.gid) ?? null) : null);

      const teamIds = new Map<string, string>();
      for (const team of scan.teams) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_team (
            name, description, privacy, source_platform, external_id,
            source_workspace_external_id, source_connection_external_id,
            created_by_employee_id
          ) values (
            ${limited(team.name, 160)},
            ${team.description ?? team.html_description ?? ""},
            ${teamPrivacy(team.visibility)}, 'asana', ${team.gid},
            ${input.workspaceGid}, ${input.connectedAccountId},
            ${actorEmployeeId}::uuid
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set name = excluded.name, description = excluded.description,
            privacy = excluded.privacy, archived_at = null,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            updated_at = now()
          returning work_team_id as id
        `);
        teamIds.set(team.gid, String(row!.id));
      }

      let teamMemberships = 0;
      const teamMembershipExternalIds: string[] = [];
      for (const entry of scan.teamMemberships) {
        const teamId = teamIds.get(entry.teamGid);
        const employeeId = employeeForUser(entry.membership.user);
        if (!teamId || !employeeId) continue;
        await tx.execute(sql`
          insert into public.work_team_member (
            work_team_id, employee_id, role, source_platform, external_id
          )
          values (
            ${teamId}::uuid, ${employeeId}::uuid,
            ${entry.membership.is_admin ? "admin" : "member"}, 'asana',
            ${entry.membership.gid}
          )
          on conflict (work_team_id, employee_id) do update set
            role = excluded.role, source_platform = excluded.source_platform,
            external_id = excluded.external_id, updated_at = now()
        `);
        teamMembershipExternalIds.push(entry.membership.gid);
        teamMemberships++;
      }

      const projectIds = new Map<string, string>();
      for (const project of scan.projects) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_project (
            name, description, color, privacy, owner_employee_id,
            created_by_employee_id, source_platform, external_id, archived_at,
            start_date, due_date, source_workspace_external_id,
            source_connection_external_id
          ) values (
            ${limited(project.name, 160)}, ${project.notes ?? ""}, ${asanaColor(project.color)},
            ${privateInAsana(project.privacy_setting)},
            ${employeeForUser(project.owner)}::uuid,
            ${actorEmployeeId}::uuid, 'asana', ${project.gid},
            ${project.archived ? (project.modified_at ?? project.created_at ?? new Date().toISOString()) : null}::timestamptz,
            ${project.start_on ?? null}::date, ${project.due_on ?? null}::date,
            ${input.workspaceGid}, ${input.connectedAccountId}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set
            name = excluded.name,
            description = excluded.description,
            color = excluded.color,
            privacy = excluded.privacy,
            owner_employee_id = excluded.owner_employee_id,
            archived_at = excluded.archived_at,
            start_date = excluded.start_date,
            due_date = excluded.due_date,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            updated_at = now()
          returning work_project_id as id
        `);
        projectIds.set(project.gid, String(row!.id));
      }

      let projectMemberships = 0;
      const projectMembershipExternalIds: string[] = [];
      const teamProjectExternalIds: string[] = [];
      for (const project of scan.projects) {
        const teamId = project.team?.gid ? teamIds.get(project.team.gid) : null;
        const projectId = projectIds.get(project.gid);
        if (!teamId || !projectId) continue;
        await tx.execute(sql`
          insert into public.work_team_project (
            work_team_id, work_project_id, access_level, source_platform,
            external_id
          ) values (
            ${teamId}::uuid, ${projectId}::uuid, 'editor', 'asana',
            ${`project-team:${project.gid}:${project.team!.gid}`}
          )
          on conflict (work_team_id, work_project_id) do update set
            source_platform = excluded.source_platform,
            external_id = excluded.external_id
        `);
        teamProjectExternalIds.push(
          `project-team:${project.gid}:${project.team!.gid}`,
        );
      }
      for (const entry of scan.projectMemberships) {
        const projectId = projectIds.get(entry.projectGid);
        if (!projectId) continue;
        const level = accessLevel(entry.membership.access_level);
        if (
          entry.membership.member.resource_type === "team" ||
          teamIds.has(entry.membership.member.gid)
        ) {
          const teamId = teamIds.get(entry.membership.member.gid);
          if (!teamId) continue;
          await tx.execute(sql`
            insert into public.work_team_project (
              work_team_id, work_project_id, access_level, source_platform,
              external_id
            ) values (
              ${teamId}::uuid, ${projectId}::uuid,
              ${level === "admin" ? "editor" : level}, 'asana',
              ${entry.membership.gid}
            )
            on conflict (work_team_id, work_project_id) do update set
              access_level = excluded.access_level,
              source_platform = excluded.source_platform,
              external_id = excluded.external_id
          `);
          teamProjectExternalIds.push(entry.membership.gid);
        } else {
          const employeeId = employeeForUser(entry.membership.member);
          if (!employeeId) continue;
          await tx.execute(sql`
            insert into public.work_project_member (
              work_project_id, employee_id, access_level, source_platform,
              external_id
            ) values (
              ${projectId}::uuid, ${employeeId}::uuid, ${level}, 'asana',
              ${entry.membership.gid}
            )
            on conflict (work_project_id, employee_id) do update set
              access_level = excluded.access_level,
              source_platform = excluded.source_platform,
              external_id = excluded.external_id, updated_at = now()
          `);
          projectMembershipExternalIds.push(entry.membership.gid);
        }
        projectMemberships++;
      }

      const sectionIds = new Map<string, string>();
      for (const section of scan.sections) {
        const projectId = projectIds.get(section.projectGid);
        if (!projectId) continue;
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_section (
            work_project_id, name, source_platform, external_id
          ) values (
            ${projectId}::uuid, ${limited(section.name, 120)}, 'asana', ${section.gid}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set
            work_project_id = excluded.work_project_id,
            name = excluded.name,
            updated_at = now()
          returning work_section_id as id
        `);
        sectionIds.set(section.gid, String(row!.id));
      }

      const myTasksEmployeeId = employeeForUser(scan.myTaskList.owner);
      if (
        !myTasksEmployeeId &&
        (scan.myTaskSections.length > 0 || scan.myTasks.length > 0)
      ) {
        throw new Error(
          "The connected Asana My Tasks owner must map to an active employee",
        );
      }
      const myTaskSectionIds = new Map<string, string>();
      for (const [position, section] of scan.myTaskSections.entries()) {
        if (!myTasksEmployeeId) continue;
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_my_tasks_section (
            employee_id, name, position, source_platform, external_id,
            source_workspace_external_id, source_connection_external_id
          ) values (
            ${myTasksEmployeeId}::uuid, ${limited(section.name, 120)},
            ${position}, 'asana', ${section.gid}, ${input.workspaceGid},
            ${input.connectedAccountId}
          )
          on conflict (
            source_platform, source_connection_external_id, external_id
          ) where external_id is not null
          do update set employee_id = excluded.employee_id,
            name = excluded.name, position = excluded.position,
            source_workspace_external_id = excluded.source_workspace_external_id,
            updated_at = now()
          returning work_my_tasks_section_id as id
        `);
        myTaskSectionIds.set(section.gid, String(row!.id));
      }

      let personalProjectId: string | null = null;
      if (myTasksEmployeeId) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_project (
            name, description, color, privacy, owner_employee_id,
            created_by_employee_id, project_kind
          ) values (
            'Private tasks', 'Private tasks created from My Tasks.',
            '#C7702E', 'private', ${myTasksEmployeeId}::uuid,
            ${actorEmployeeId}::uuid, 'personal'
          ) on conflict (owner_employee_id) where project_kind = 'personal'
          do update set archived_at = null, updated_at = now()
          returning work_project_id as id
        `);
        personalProjectId = String(row!.id);
        await tx.execute(sql`
          insert into public.work_project_member (
            work_project_id, employee_id, access_level
          ) values (
            ${personalProjectId}::uuid, ${myTasksEmployeeId}::uuid, 'admin'
          ) on conflict (work_project_id, employee_id) do update set
            access_level = 'admin', updated_at = now()
        `);
      }

      const customTaskTypeIds = new Map<string, string>();
      const customTaskStatusIds = new Map<string, string>();
      const customTaskTypeExternalIds: string[] = [];
      const customTaskStatusExternalIds: string[] = [];
      const projectCustomTaskTypeExternalIds: string[] = [];
      const projectGidsByCustomType = new Map<string, string[]>();
      for (const link of scan.projectCustomTaskTypes) {
        const gids = projectGidsByCustomType.get(link.customTaskTypeGid) ?? [];
        gids.push(link.projectGid);
        projectGidsByCustomType.set(link.customTaskTypeGid, gids);
      }
      for (const type of scan.customTaskTypes) {
        const linkedProjectGids = projectGidsByCustomType.get(type.gid) ?? [];
        const usedByProjectlessTask = scan.tasks.some(
          (task) =>
            task.custom_type?.gid === type.gid &&
            scan.myTasks.some(
              (myTask) => myTask.taskGid === task.gid && myTask.projectless,
            ),
        );
        const ownerProjectId =
          projectIds.get(linkedProjectGids[0] ?? "") ??
          (usedByProjectlessTask ? personalProjectId : null);
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_custom_task_type (
            owner_work_project_id, name, created_by_employee_id,
            source_platform, external_id, source_workspace_external_id,
            source_connection_external_id, source_data
          ) values (
            ${ownerProjectId}::uuid, ${limited(type.name, 120)},
            ${actorEmployeeId}::uuid, 'asana', ${type.gid},
            ${input.workspaceGid}, ${input.connectedAccountId},
            ${JSON.stringify(type)}::jsonb
          ) on conflict (
            source_platform, source_connection_external_id, external_id
          ) where external_id is not null
          do update set owner_work_project_id = excluded.owner_work_project_id,
            name = excluded.name, source_data = excluded.source_data,
            archived_at = null, updated_at = now()
          returning work_custom_task_type_id as id
        `);
        customTaskTypeIds.set(type.gid, String(row!.id));
        customTaskTypeExternalIds.push(type.gid);
        for (const [position, status] of type.status_options.entries()) {
          const [statusRow] = await tx.execute(sql<{ id: string }>`
            insert into public.work_custom_task_status_option (
              work_custom_task_type_id, name, color, completion_state,
              enabled, position, source_platform, external_id
            ) values (
              ${row!.id}::uuid, ${limited(status.name, 120)},
              ${asanaColor(status.color)}, ${status.completion_state},
              ${status.enabled !== false}, ${position}, 'asana', ${status.gid}
            ) on conflict (source_platform, external_id)
              where external_id is not null
            do update set work_custom_task_type_id = excluded.work_custom_task_type_id,
              name = excluded.name, color = excluded.color,
              completion_state = excluded.completion_state,
              enabled = excluded.enabled, position = excluded.position,
              updated_at = now()
            returning work_custom_task_status_option_id as id
          `);
          customTaskStatusIds.set(status.gid, String(statusRow!.id));
          customTaskStatusExternalIds.push(status.gid);
        }
      }
      for (const link of scan.projectCustomTaskTypes) {
        const projectId = projectIds.get(link.projectGid);
        const typeId = customTaskTypeIds.get(link.customTaskTypeGid);
        if (!projectId || !typeId) continue;
        const externalId = `${link.projectGid}:${link.customTaskTypeGid}`;
        await tx.execute(sql`
          insert into public.work_project_custom_task_type (
            work_project_id, work_custom_task_type_id, source_platform, external_id
          ) values (
            ${projectId}::uuid, ${typeId}::uuid, 'asana', ${externalId}
          ) on conflict (work_project_id, work_custom_task_type_id) do update set
            source_platform = excluded.source_platform,
            external_id = excluded.external_id, updated_at = now()
        `);
        projectCustomTaskTypeExternalIds.push(externalId);
      }
      if (personalProjectId) {
        for (const type of scan.customTaskTypes) {
          const usedByProjectlessTask = scan.tasks.some(
            (task) =>
              task.custom_type?.gid === type.gid &&
              scan.myTasks.some(
                (myTask) => myTask.taskGid === task.gid && myTask.projectless,
              ),
          );
          const typeId = customTaskTypeIds.get(type.gid);
          if (!usedByProjectlessTask || !typeId) continue;
          const externalId = `my-tasks:${type.gid}`;
          await tx.execute(sql`
            insert into public.work_project_custom_task_type (
              work_project_id, work_custom_task_type_id, source_platform, external_id
            ) values (
              ${personalProjectId}::uuid, ${typeId}::uuid, 'asana', ${externalId}
            ) on conflict (work_project_id, work_custom_task_type_id) do update set
              source_platform = excluded.source_platform,
              external_id = excluded.external_id, updated_at = now()
          `);
          projectCustomTaskTypeExternalIds.push(externalId);
        }
      }

      const itemIds = new Map<string, string>();
      for (const task of scan.tasks) {
        const customTaskTypeId = task.custom_type?.gid
          ? customTaskTypeIds.get(task.custom_type.gid)
          : null;
        const customTaskStatusId = task.custom_type_status_option?.gid
          ? customTaskStatusIds.get(task.custom_type_status_option.gid)
          : null;
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_item (
            title, description, item_type, assignee_employee_id,
            created_by_employee_id, start_date, due_at, completed_at,
            estimated_minutes, work_custom_task_type_id,
            work_custom_task_status_option_id,
            source_platform, external_id, source_workspace_external_id,
            source_connection_external_id
          ) values (
            ${limited(task.name, 500)}, ${task.notes ?? ""},
            ${asanaItemType(task.resource_subtype)},
            ${employeeForUser(task.assignee)}::uuid,
            ${actorEmployeeId}::uuid, ${task.start_on ?? null}::date,
            ${asanaDueAt(task)}::timestamptz, ${completedAt(task)}::timestamptz,
            ${task.estimated_minutes ?? null},
            ${customTaskTypeId && customTaskStatusId ? customTaskTypeId : null}::uuid,
            ${customTaskTypeId && customTaskStatusId ? customTaskStatusId : null}::uuid,
            'asana', ${task.gid}, ${input.workspaceGid},
            ${input.connectedAccountId}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set
            title = excluded.title,
            description = excluded.description,
            item_type = excluded.item_type,
            assignee_employee_id = excluded.assignee_employee_id,
            start_date = excluded.start_date,
            due_at = excluded.due_at,
            completed_at = excluded.completed_at,
            estimated_minutes = excluded.estimated_minutes,
            work_custom_task_type_id = excluded.work_custom_task_type_id,
            work_custom_task_status_option_id = excluded.work_custom_task_status_option_id,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            archived_at = null,
            updated_at = now()
          returning work_item_id as id
        `);
        itemIds.set(task.gid, String(row!.id));
      }

      for (const task of scan.tasks) {
        const itemId = itemIds.get(task.gid);
        const parentId = task.parent?.gid
          ? itemIds.get(task.parent.gid)
          : undefined;
        if (!itemId) continue;
        await tx.execute(sql`
          update public.work_item
          set parent_work_item_id = ${parentId ?? null}::uuid, updated_at = now()
          where work_item_id = ${itemId}::uuid
        `);
      }

      let position = 0;
      const projectItemExternalIds: string[] = [];
      for (const link of scan.projectTasks) {
        const projectId = projectIds.get(link.projectGid);
        const itemId = itemIds.get(link.taskGid);
        if (!projectId || !itemId) continue;
        const sectionId = link.sectionGid
          ? (sectionIds.get(link.sectionGid) ?? null)
          : null;
        await tx.execute(sql`
          insert into public.work_project_item (
            work_project_id, work_item_id, work_section_id, position,
            source_platform, external_id
          ) values (
            ${projectId}::uuid, ${itemId}::uuid, ${sectionId}::uuid, ${position++},
            'asana', ${`${link.projectGid}:${link.taskGid}`}
          )
          on conflict (work_project_id, work_item_id)
          do update set
            work_section_id = excluded.work_section_id,
            position = excluded.position,
            source_platform = excluded.source_platform,
            external_id = excluded.external_id,
            updated_at = now()
        `);
        projectItemExternalIds.push(`${link.projectGid}:${link.taskGid}`);
      }

      const personalProjectItemExternalIds: string[] = [];
      if (personalProjectId) {
        for (const task of scan.myTasks) {
          if (!task.projectless) continue;
          const itemId = itemIds.get(task.taskGid);
          if (!itemId) continue;
          const externalId = `my-tasks:${task.taskGid}`;
          await tx.execute(sql`
            insert into public.work_project_item (
              work_project_id, work_item_id, position, source_platform,
              external_id
            ) values (
              ${personalProjectId}::uuid, ${itemId}::uuid, ${task.position},
              'asana', ${externalId}
            ) on conflict (work_project_id, work_item_id) do update set
              position = excluded.position, source_platform = excluded.source_platform,
              external_id = excluded.external_id, updated_at = now()
          `);
          personalProjectItemExternalIds.push(externalId);
        }
      }

      const myTaskMembershipExternalIds: string[] = [];
      if (myTasksEmployeeId) {
        for (const task of scan.myTasks) {
          const itemId = itemIds.get(task.taskGid);
          const myTaskSectionId = task.sectionGid
            ? myTaskSectionIds.get(task.sectionGid)
            : null;
          if (!itemId || !myTaskSectionId) continue;
          await tx.execute(sql`
            insert into public.work_my_tasks_membership (
              employee_id, work_item_id, work_my_tasks_section_id, position
            ) values (
              ${myTasksEmployeeId}::uuid, ${itemId}::uuid,
              ${myTaskSectionId}::uuid, ${task.position}
            ) on conflict (employee_id, work_item_id) do update set
              work_my_tasks_section_id = excluded.work_my_tasks_section_id,
              position = excluded.position, updated_at = now()
          `);
          myTaskMembershipExternalIds.push(task.taskGid);
        }
      }

      let dependencies = 0;
      let followers = 0;
      let tags = 0;
      let customFieldValues = 0;
      const dependencyExternalIds: string[] = [];
      const followerExternalIds: string[] = [];
      const itemTagExternalIds: string[] = [];
      const customFieldValueExternalIds: string[] = [];
      for (const task of scan.tasks) {
        const itemId = itemIds.get(task.gid);
        if (!itemId) continue;
        for (const dependency of task.dependencies ?? []) {
          const dependencyId = itemIds.get(dependency.gid);
          if (!dependencyId) continue;
          await tx.execute(sql`
            insert into public.work_item_dependency (
              work_item_id, depends_on_work_item_id, created_by_employee_id,
              source_platform, external_id
            ) values (
              ${itemId}::uuid, ${dependencyId}::uuid, ${actorEmployeeId}::uuid,
              'asana', ${`${task.gid}:${dependency.gid}`}
            ) on conflict (work_item_id, depends_on_work_item_id) do update set
              source_platform = excluded.source_platform,
              external_id = excluded.external_id
          `);
          dependencyExternalIds.push(`${task.gid}:${dependency.gid}`);
          dependencies++;
        }
        for (const follower of task.followers ?? []) {
          const employeeId = employeeFor(follower.email);
          if (!employeeId) continue;
          await tx.execute(sql`
            insert into public.work_item_follower (
              work_item_id, employee_id, source_platform, external_id
            ) values (
              ${itemId}::uuid, ${employeeId}::uuid, 'asana',
              ${`${task.gid}:${follower.gid}`}
            )
            on conflict (work_item_id, employee_id) do update set
              source_platform = excluded.source_platform,
              external_id = excluded.external_id
          `);
          followerExternalIds.push(`${task.gid}:${follower.gid}`);
          followers++;
        }
        for (const tag of task.tags ?? []) {
          const [tagRow] = await tx.execute(sql<{ id: string }>`
            insert into public.work_tag (name)
            values (${limited(tag.name, 80)})
            on conflict (name) do update set updated_at = now()
            returning work_tag_id as id
          `);
          await tx.execute(sql`
            insert into public.work_item_tag (
              work_item_id, work_tag_id, source_platform, external_id
            ) values (
              ${itemId}::uuid, ${String(tagRow!.id)}::uuid, 'asana',
              ${`${task.gid}:${tag.gid}`}
            )
            on conflict (work_item_id, work_tag_id) do update set
              source_platform = excluded.source_platform,
              external_id = excluded.external_id
          `);
          itemTagExternalIds.push(`${task.gid}:${tag.gid}`);
          tags++;
        }

        const projectGids = scan.projectTasks
          .filter((link) => link.taskGid === task.gid)
          .map((link) => link.projectGid);
        for (const projectGid of projectGids) {
          const projectId = projectIds.get(projectGid);
          if (!projectId) continue;
          for (const field of task.custom_fields ?? []) {
            const [fieldRow] = await tx.execute(sql<{ id: string }>`
              insert into public.work_custom_field (
                work_project_id, name, field_type, source_platform, external_id
              ) values (
                ${projectId}::uuid, ${limited(field.name, 120)},
                ${fieldType(field)}, 'asana', ${field.gid}
              )
              on conflict (work_project_id, source_platform, external_id)
                where external_id is not null
              do update set
                name = excluded.name,
                field_type = excluded.field_type,
                updated_at = now()
              returning work_custom_field_id as id
            `);
            await tx.execute(sql`
              insert into public.work_custom_field_value (
                work_item_id, work_custom_field_id, value, source_platform,
                external_id
              ) values (
                ${itemId}::uuid, ${String(fieldRow!.id)}::uuid,
                ${JSON.stringify(field)}::jsonb, 'asana',
                ${`${task.gid}:${projectGid}:${field.gid}`}
              )
              on conflict (work_item_id, work_custom_field_id)
              do update set value = excluded.value,
                source_platform = excluded.source_platform,
                external_id = excluded.external_id, updated_at = now()
            `);
            customFieldValueExternalIds.push(
              `${task.gid}:${projectGid}:${field.gid}`,
            );
            customFieldValues++;
          }
        }
      }

      let comments = 0;
      const commentExternalIds: string[] = [];
      for (const entry of scan.stories ?? []) {
        const { story } = entry;
        if (
          story.type !== "comment" &&
          story.resource_subtype !== "comment_added"
        ) {
          continue;
        }
        const itemId = itemIds.get(entry.taskGid);
        const body = (story.text ?? story.html_text ?? "")
          .trim()
          .slice(0, 20_000);
        if (!itemId || !body) continue;
        await tx.execute(sql`
          insert into public.work_comment (
            work_item_id, author_employee_id, body, source_platform,
            external_id, created_at
          ) values (
            ${itemId}::uuid,
            ${employeeForUser(story.created_by) ?? actorEmployeeId}::uuid,
            ${body}, 'asana', ${story.gid},
            ${story.created_at ?? new Date().toISOString()}::timestamptz
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set body = excluded.body, edited_at = now(),
            deleted_at = null, updated_at = now()
        `);
        commentExternalIds.push(story.gid);
        comments++;
      }

      let attachments = 0;
      const attachmentExternalIds: string[] = [];
      for (const entry of scan.attachments ?? []) {
        const itemId = itemIds.get(entry.taskGid);
        const attachment = entry.attachment;
        const url =
          attachment.permanent_url ??
          attachment.view_url ??
          attachment.download_url;
        if (!itemId || !url) continue;
        await tx.execute(sql`
          insert into public.work_attachment (
            work_item_id, name, external_url, uploaded_by_employee_id,
            source_platform, external_id
          ) values (
            ${itemId}::uuid, ${limited(attachment.name, 255)}, ${url},
            ${actorEmployeeId}::uuid, 'asana', ${attachment.gid}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set
            work_item_id = excluded.work_item_id,
            name = excluded.name,
            external_url = excluded.external_url,
            updated_at = now()
        `);
        attachmentExternalIds.push(attachment.gid);
        attachments++;
      }

      const goalIds = new Map<string, string>();
      for (const goal of scan.goals) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_goal (
            name, description, scope, owner_employee_id, status, progress,
            start_date, due_date, privacy, created_by_employee_id,
            source_platform, external_id, source_data, created_at,
            source_workspace_external_id, source_connection_external_id
          ) values (
            ${limited(goal.name, 300)}, ${goal.notes ?? ""},
            ${goal.is_workspace_level ? "company" : goal.team ? "team" : "individual"},
            ${employeeForUser(goal.owner)}::uuid, ${asanaGoalStatus(goal.status)},
            ${asanaGoalProgress(goal)}, ${goal.start_on ?? null}::date,
            ${goal.due_on ?? null}::date, ${privateInAsana(goal.privacy_setting)},
            ${actorEmployeeId}::uuid, 'asana', ${goal.gid},
            ${JSON.stringify(goal)}::jsonb,
            ${goal.created_at ?? new Date().toISOString()}::timestamptz,
            ${input.workspaceGid}, ${input.connectedAccountId}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set name = excluded.name, description = excluded.description,
            scope = excluded.scope, owner_employee_id = excluded.owner_employee_id,
            status = excluded.status, progress = excluded.progress,
            start_date = excluded.start_date, due_date = excluded.due_date,
            privacy = excluded.privacy, source_data = excluded.source_data,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            archived_at = null, updated_at = now()
          returning work_goal_id as id
        `);
        goalIds.set(goal.gid, String(row!.id));
      }

      const portfolioIds = new Map<string, string>();
      for (const portfolio of scan.portfolios) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_portfolio (
            name, description, color, privacy, owner_employee_id,
            created_by_employee_id, start_date, due_date, source_platform,
            external_id, source_data, archived_at, created_at,
            source_workspace_external_id, source_connection_external_id
          ) values (
            ${limited(portfolio.name, 200)}, '', ${asanaColor(portfolio.color)},
            ${privateInAsana(portfolio.privacy_setting)},
            ${employeeForUser(portfolio.owner)}::uuid, ${actorEmployeeId}::uuid,
            ${portfolio.start_on ?? null}::date, ${portfolio.due_on ?? null}::date,
            'asana', ${portfolio.gid}, ${JSON.stringify(portfolio)}::jsonb,
            ${portfolio.archived ? (portfolio.created_at ?? new Date().toISOString()) : null}::timestamptz,
            ${portfolio.created_at ?? new Date().toISOString()}::timestamptz,
            ${input.workspaceGid}, ${input.connectedAccountId}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set name = excluded.name, color = excluded.color,
            privacy = excluded.privacy, owner_employee_id = excluded.owner_employee_id,
            start_date = excluded.start_date, due_date = excluded.due_date,
            source_data = excluded.source_data, archived_at = excluded.archived_at,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            updated_at = now()
          returning work_portfolio_id as id
        `);
        portfolioIds.set(portfolio.gid, String(row!.id));
      }

      let portfolioItems = 0;
      const portfolioProjectExternalIds: string[] = [];
      for (const [position, item] of scan.portfolioItems.entries()) {
        const portfolioId = portfolioIds.get(item.portfolioGid);
        const projectId = projectIds.get(item.projectGid);
        if (!portfolioId || !projectId) continue;
        await tx.execute(sql`
          insert into public.work_portfolio_project (
            work_portfolio_id, work_project_id, position, source_platform,
            external_id
          ) values (
            ${portfolioId}::uuid, ${projectId}::uuid, ${position}, 'asana',
            ${`${item.portfolioGid}:${item.projectGid}`}
          )
          on conflict (work_portfolio_id, work_project_id) do update set
            position = excluded.position,
            source_platform = excluded.source_platform,
            external_id = excluded.external_id
        `);
        portfolioProjectExternalIds.push(
          `${item.portfolioGid}:${item.projectGid}`,
        );
        portfolioItems++;
      }

      await tx.execute(sql`
        update public.work_goal set parent_work_goal_id = null, updated_at = now()
        where source_platform = 'asana'
          and source_workspace_external_id = ${input.workspaceGid}
          and source_connection_external_id = ${input.connectedAccountId}
          and parent_work_goal_id is not null
      `);
      let goalRelationships = 0;
      const goalLinkExternalIds: string[] = [];
      for (const entry of scan.goalRelationships) {
        const goalId = goalIds.get(entry.goalGid);
        const resource = entry.relationship.supporting_resource;
        if (!goalId) continue;
        if (
          entry.relationship.resource_subtype === "subgoal" &&
          resource.resource_type === "goal"
        ) {
          const childId = goalIds.get(resource.gid);
          if (!childId) continue;
          await tx.execute(sql`
            update public.work_goal set parent_work_goal_id = ${goalId}::uuid,
              updated_at = now()
            where work_goal_id = ${childId}::uuid
          `);
          goalRelationships++;
          continue;
        }
        const projectId =
          resource.resource_type === "project"
            ? projectIds.get(resource.gid)
            : null;
        const itemId =
          resource.resource_type === "task" ? itemIds.get(resource.gid) : null;
        const portfolioId =
          resource.resource_type === "portfolio"
            ? portfolioIds.get(resource.gid)
            : null;
        const supportingGoalId =
          resource.resource_type === "goal" ? goalIds.get(resource.gid) : null;
        if (!projectId && !itemId && !portfolioId && !supportingGoalId)
          continue;
        await tx.execute(sql`
          insert into public.work_goal_link (
            work_goal_id, work_project_id, work_item_id, work_portfolio_id,
            supporting_work_goal_id, weight, source_platform, external_id
          ) values (
            ${goalId}::uuid, ${projectId ?? null}::uuid, ${itemId ?? null}::uuid,
            ${portfolioId ?? null}::uuid, ${supportingGoalId ?? null}::uuid,
            ${entry.relationship.contribution_weight ?? 1}, 'asana',
            ${entry.relationship.gid}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set work_goal_id = excluded.work_goal_id,
            work_project_id = excluded.work_project_id,
            work_item_id = excluded.work_item_id,
            work_portfolio_id = excluded.work_portfolio_id,
            supporting_work_goal_id = excluded.supporting_work_goal_id,
            weight = excluded.weight
        `);
        goalLinkExternalIds.push(entry.relationship.gid);
        goalRelationships++;
      }

      let templates = 0;
      for (const template of scan.projectTemplates) {
        await tx.execute(sql`
          insert into public.work_template (
            name, template_type, blueprint, created_by_employee_id,
            source_platform, external_id, source_workspace_external_id,
            source_connection_external_id
          ) values (
            ${limited(template.name, 160)}, 'project',
            ${JSON.stringify(template)}::jsonb, ${actorEmployeeId}::uuid,
            'asana', ${template.gid}, ${input.workspaceGid},
            ${input.connectedAccountId}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set name = excluded.name, blueprint = excluded.blueprint,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            archived_at = null, updated_at = now()
        `);
        templates++;
      }
      for (const template of scan.taskTemplates) {
        const projectId = template.project?.gid
          ? (projectIds.get(template.project.gid) ?? null)
          : null;
        await tx.execute(sql`
          insert into public.work_template (
            work_project_id, name, template_type, blueprint,
            created_by_employee_id, source_platform, external_id,
            source_workspace_external_id, source_connection_external_id
          ) values (
            ${projectId}::uuid, ${limited(template.name, 160)}, 'task',
            ${JSON.stringify(template)}::jsonb, ${actorEmployeeId}::uuid,
            'asana', ${template.gid}, ${input.workspaceGid},
            ${input.connectedAccountId}
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set work_project_id = excluded.work_project_id,
            name = excluded.name, blueprint = excluded.blueprint,
            source_workspace_external_id = excluded.source_workspace_external_id,
            source_connection_external_id = excluded.source_connection_external_id,
            archived_at = null, updated_at = now()
        `);
        templates++;
      }

      let statusUpdates = 0;
      const statusExternalIds: string[] = [];
      for (const entry of scan.statusUpdates ?? []) {
        const projectId =
          entry.parentType === "project"
            ? projectIds.get(entry.parentGid)
            : null;
        const portfolioId =
          entry.parentType === "portfolio"
            ? portfolioIds.get(entry.parentGid)
            : null;
        const goalId =
          entry.parentType === "goal" ? goalIds.get(entry.parentGid) : null;
        if (!projectId && !portfolioId && !goalId) continue;
        await tx.execute(sql`
          insert into public.work_status_update (
            work_project_id, work_portfolio_id, work_goal_id, health, title,
            body, created_by_employee_id, source_platform, external_id,
            source_data, created_at
          ) values (
            ${projectId ?? null}::uuid, ${portfolioId ?? null}::uuid,
            ${goalId ?? null}::uuid, ${asanaStatusHealth(entry.status)},
            ${limited(entry.status.title, 300)},
            ${(entry.status.text ?? entry.status.html_text ?? "").slice(0, 50_000)},
            ${employeeForUser(entry.status.author) ?? actorEmployeeId}::uuid,
            'asana', ${entry.status.gid}, ${JSON.stringify(entry.status)}::jsonb,
            ${entry.status.created_at ?? new Date().toISOString()}::timestamptz
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set health = excluded.health, title = excluded.title,
            body = excluded.body, source_data = excluded.source_data
        `);
        statusExternalIds.push(entry.status.gid);
        statusUpdates++;
      }

      let timeTrackingEntries = 0;
      const timeEntryExternalIds: string[] = [];
      for (const row of scan.timeTrackingEntries ?? []) {
        const employeeId = employeeForUser(row.entry.created_by);
        const itemId = itemIds.get(row.taskGid);
        const fallbackProjectGid = scan.projectTasks.find(
          (link) => link.taskGid === row.taskGid,
        )?.projectGid;
        const projectId = projectIds.get(
          row.entry.attributable_to?.gid ?? fallbackProjectGid ?? "",
        );
        if (
          !employeeId ||
          !itemId ||
          !projectId ||
          row.entry.duration_minutes < 1
        )
          continue;
        const status = (row.entry.approval_status ?? "DRAFT").toLowerCase();
        await tx.execute(sql`
          insert into public.time_entry (
            employee_id, work_project_id, work_item_id, work_date, minutes,
            is_billable, description, status, submitted_at,
            decided_by_employee_id, decided_at, created_by_employee_id,
            source_platform, external_id, source_data, created_at
          ) values (
            ${employeeId}::uuid, ${projectId}::uuid, ${itemId}::uuid,
            ${row.entry.entered_on}::date, ${Math.round(row.entry.duration_minutes)},
            ${row.entry.billable_status === "billable"}, ${row.entry.description ?? null},
            ${status}, ${status === "draft" ? null : (row.entry.created_at ?? new Date().toISOString())}::timestamptz,
            ${status === "approved" || status === "rejected" ? employeeId : null}::uuid,
            ${status === "approved" || status === "rejected" ? (row.entry.created_at ?? new Date().toISOString()) : null}::timestamptz,
            ${employeeId}::uuid, 'asana', ${row.entry.gid},
            ${JSON.stringify(row.entry)}::jsonb,
            ${row.entry.created_at ?? new Date().toISOString()}::timestamptz
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set employee_id = excluded.employee_id,
            work_project_id = excluded.work_project_id,
            work_item_id = excluded.work_item_id, work_date = excluded.work_date,
            minutes = excluded.minutes, is_billable = excluded.is_billable,
            description = excluded.description, status = excluded.status,
            submitted_at = excluded.submitted_at,
            decided_by_employee_id = excluded.decided_by_employee_id,
            decided_at = excluded.decided_at, source_data = excluded.source_data,
            updated_at = now()
        `);
        timeEntryExternalIds.push(row.entry.gid);
        timeTrackingEntries++;
      }

      const projectExternalIds = scan.projects.map((value) => value.gid);
      const taskExternalIds = scan.tasks.map((value) => value.gid);
      const teamExternalIds = scan.teams.map((value) => value.gid);
      const goalExternalIds = scan.goals.map((value) => value.gid);
      const portfolioExternalIds = scan.portfolios.map((value) => value.gid);
      const templateExternalIds = [
        ...scan.projectTemplates,
        ...scan.taskTemplates,
      ].map((value) => value.gid);

      for (const [table, ids] of [
        ["work_project", projectExternalIds],
        ["work_item", taskExternalIds],
        ["work_team", teamExternalIds],
        ["work_goal", goalExternalIds],
        ["work_portfolio", portfolioExternalIds],
        ["work_template", templateExternalIds],
        ["work_custom_task_type", customTaskTypeExternalIds],
      ] as const) {
        await tx.execute(sql`
          update public.${sql.raw(table)}
          set archived_at = coalesce(archived_at, now()), updated_at = now()
          where source_platform = 'asana'
            and source_workspace_external_id = ${input.workspaceGid}
            and source_connection_external_id = ${input.connectedAccountId}
            and coalesce(external_id, '') <> all(${textArray(ids)})
        `);
      }

      await tx.execute(sql`
        delete from public.work_team_member member
        using public.work_team team
        where member.work_team_id = team.work_team_id
          and team.source_platform = 'asana'
          and team.source_workspace_external_id = ${input.workspaceGid}
          and team.source_connection_external_id = ${input.connectedAccountId}
          and member.source_platform = 'asana'
          and coalesce(member.external_id, '') <>
            all(${textArray(teamMembershipExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_project_member member
        using public.work_project project
        where member.work_project_id = project.work_project_id
          and project.source_platform = 'asana'
          and project.source_workspace_external_id = ${input.workspaceGid}
          and project.source_connection_external_id = ${input.connectedAccountId}
          and member.source_platform = 'asana'
          and coalesce(member.external_id, '') <>
            all(${textArray(projectMembershipExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_team_project link
        using public.work_project project
        where link.work_project_id = project.work_project_id
          and project.source_platform = 'asana'
          and project.source_workspace_external_id = ${input.workspaceGid}
          and project.source_connection_external_id = ${input.connectedAccountId}
          and link.source_platform = 'asana'
          and coalesce(link.external_id, '') <>
            all(${textArray(teamProjectExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_portfolio_project link
        using public.work_portfolio portfolio
        where link.work_portfolio_id = portfolio.work_portfolio_id
          and portfolio.source_platform = 'asana'
          and portfolio.source_workspace_external_id = ${input.workspaceGid}
          and portfolio.source_connection_external_id = ${input.connectedAccountId}
          and link.source_platform = 'asana'
          and coalesce(link.external_id, '') <>
            all(${textArray(portfolioProjectExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_goal_link link
        using public.work_goal goal
        where link.work_goal_id = goal.work_goal_id
          and goal.source_platform = 'asana'
          and goal.source_workspace_external_id = ${input.workspaceGid}
          and goal.source_connection_external_id = ${input.connectedAccountId}
          and link.source_platform = 'asana'
          and coalesce(link.external_id, '') <>
            all(${textArray(goalLinkExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_section section
        using public.work_project project
        where section.work_project_id = project.work_project_id
          and project.source_platform = 'asana'
          and project.source_workspace_external_id = ${input.workspaceGid}
          and project.source_connection_external_id = ${input.connectedAccountId}
          and section.source_platform = 'asana'
          and coalesce(section.external_id, '') <>
            all(${textArray(scan.sections.map((value) => value.gid))})
      `);
      await tx.execute(sql`
        delete from public.work_project_item link
        using public.work_project project
        where link.work_project_id = project.work_project_id
          and project.source_platform = 'asana'
          and project.source_workspace_external_id = ${input.workspaceGid}
          and project.source_connection_external_id = ${input.connectedAccountId}
          and link.source_platform = 'asana'
          and coalesce(link.external_id, '') <>
            all(${textArray(projectItemExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_project_custom_task_type association
        using public.work_custom_task_type type
        where association.work_custom_task_type_id = type.work_custom_task_type_id
          and type.source_platform = 'asana'
          and type.source_workspace_external_id = ${input.workspaceGid}
          and type.source_connection_external_id = ${input.connectedAccountId}
          and association.source_platform = 'asana'
          and coalesce(association.external_id, '') <>
            all(${textArray(projectCustomTaskTypeExternalIds)})
      `);
      await tx.execute(sql`
        update public.work_custom_task_status_option status set enabled = false,
          updated_at = now()
        from public.work_custom_task_type type
        where status.work_custom_task_type_id = type.work_custom_task_type_id
          and type.source_platform = 'asana'
          and type.source_workspace_external_id = ${input.workspaceGid}
          and type.source_connection_external_id = ${input.connectedAccountId}
          and status.source_platform = 'asana'
          and coalesce(status.external_id, '') <>
            all(${textArray(customTaskStatusExternalIds)})
      `);
      if (personalProjectId && myTasksEmployeeId) {
        await tx.execute(sql`
          delete from public.work_my_tasks_membership membership
          using public.work_item item
          where membership.work_item_id = item.work_item_id
            and membership.employee_id = ${myTasksEmployeeId}::uuid
            and item.source_platform = 'asana'
            and item.source_workspace_external_id = ${input.workspaceGid}
            and item.source_connection_external_id = ${input.connectedAccountId}
            and coalesce(item.external_id, '') <>
              all(${textArray(myTaskMembershipExternalIds)})
        `);
        await tx.execute(sql`
          delete from public.work_my_tasks_section
          where employee_id = ${myTasksEmployeeId}::uuid
            and source_platform = 'asana'
            and source_workspace_external_id = ${input.workspaceGid}
            and source_connection_external_id = ${input.connectedAccountId}
            and coalesce(external_id, '') <>
              all(${textArray(scan.myTaskSections.map((section) => section.gid))})
        `);
        await tx.execute(sql`
          delete from public.work_project_item link
          using public.work_item item
          where link.work_item_id = item.work_item_id
            and link.work_project_id = ${personalProjectId}::uuid
            and link.source_platform = 'asana'
            and item.source_platform = 'asana'
            and item.source_workspace_external_id = ${input.workspaceGid}
            and item.source_connection_external_id = ${input.connectedAccountId}
            and coalesce(link.external_id, '') <>
              all(${textArray(personalProjectItemExternalIds)})
        `);
      }
      await tx.execute(sql`
        delete from public.work_item_dependency dependency
        using public.work_item item
        where dependency.work_item_id = item.work_item_id
          and item.source_platform = 'asana'
          and item.source_workspace_external_id = ${input.workspaceGid}
          and item.source_connection_external_id = ${input.connectedAccountId}
          and dependency.source_platform = 'asana'
          and coalesce(dependency.external_id, '') <>
            all(${textArray(dependencyExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_item_follower follower
        using public.work_item item
        where follower.work_item_id = item.work_item_id
          and item.source_platform = 'asana'
          and item.source_workspace_external_id = ${input.workspaceGid}
          and item.source_connection_external_id = ${input.connectedAccountId}
          and follower.source_platform = 'asana'
          and coalesce(follower.external_id, '') <>
            all(${textArray(followerExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_item_tag link
        using public.work_item item
        where link.work_item_id = item.work_item_id
          and item.source_platform = 'asana'
          and item.source_workspace_external_id = ${input.workspaceGid}
          and item.source_connection_external_id = ${input.connectedAccountId}
          and link.source_platform = 'asana'
          and coalesce(link.external_id, '') <>
            all(${textArray(itemTagExternalIds)})
      `);
      await tx.execute(sql`
        delete from public.work_custom_field_value value
        using public.work_item item
        where value.work_item_id = item.work_item_id
          and item.source_platform = 'asana'
          and item.source_workspace_external_id = ${input.workspaceGid}
          and item.source_connection_external_id = ${input.connectedAccountId}
          and value.source_platform = 'asana'
          and coalesce(value.external_id, '') <>
            all(${textArray(customFieldValueExternalIds)})
      `);

      for (const project of scan.projects) {
        const fieldExternalIds = new Set<string>();
        for (const link of scan.projectTasks) {
          if (link.projectGid !== project.gid) continue;
          const task = scan.tasks.find((value) => value.gid === link.taskGid);
          for (const field of task?.custom_fields ?? [])
            fieldExternalIds.add(field.gid);
        }
        const projectId = projectIds.get(project.gid);
        if (!projectId) continue;
        await tx.execute(sql`
          delete from public.work_custom_field
          where work_project_id = ${projectId}::uuid
            and source_platform = 'asana'
            and coalesce(external_id, '') <>
              all(${textArray([...fieldExternalIds])})
        `);
      }

      if (scan.stories !== null) {
        await tx.execute(sql`
          update public.work_comment comment set deleted_at = coalesce(deleted_at, now()),
            updated_at = now()
          from public.work_item item
          where comment.work_item_id = item.work_item_id
            and item.source_platform = 'asana'
            and item.source_workspace_external_id = ${input.workspaceGid}
            and item.source_connection_external_id = ${input.connectedAccountId}
            and comment.source_platform = 'asana'
            and coalesce(comment.external_id, '') <>
              all(${textArray(commentExternalIds)})
        `);
      }
      if (scan.attachments !== null) {
        await tx.execute(sql`
          delete from public.work_attachment attachment
          using public.work_item item
          where attachment.work_item_id = item.work_item_id
            and item.source_platform = 'asana'
            and item.source_workspace_external_id = ${input.workspaceGid}
            and item.source_connection_external_id = ${input.connectedAccountId}
            and attachment.source_platform = 'asana'
            and coalesce(attachment.external_id, '') <>
              all(${textArray(attachmentExternalIds)})
        `);
      }
      if (scan.statusUpdates !== null) {
        await tx.execute(sql`
          delete from public.work_status_update status
          where status.source_platform = 'asana'
            and (
              status.work_project_id in (
                select work_project_id from public.work_project
                where source_platform = 'asana'
                  and source_workspace_external_id = ${input.workspaceGid}
                  and source_connection_external_id = ${input.connectedAccountId}
              )
              or status.work_portfolio_id in (
                select work_portfolio_id from public.work_portfolio
                where source_platform = 'asana'
                  and source_workspace_external_id = ${input.workspaceGid}
                  and source_connection_external_id = ${input.connectedAccountId}
              )
              or status.work_goal_id in (
                select work_goal_id from public.work_goal
                where source_platform = 'asana'
                  and source_workspace_external_id = ${input.workspaceGid}
                  and source_connection_external_id = ${input.connectedAccountId}
              )
            )
            and coalesce(status.external_id, '') <>
              all(${textArray(statusExternalIds)})
        `);
      }
      if (scan.timeTrackingEntries !== null) {
        await tx.execute(sql`
          delete from public.time_entry entry
          using public.work_item item
          where entry.work_item_id = item.work_item_id
            and item.source_platform = 'asana'
            and item.source_workspace_external_id = ${input.workspaceGid}
            and item.source_connection_external_id = ${input.connectedAccountId}
            and entry.source_platform = 'asana'
            and coalesce(entry.external_id, '') <>
              all(${textArray(timeEntryExternalIds)})
        `);
      }

      return {
        teams: teamIds.size,
        teamMemberships,
        projects: projectIds.size,
        projectMemberships,
        sections: sectionIds.size,
        myTaskSections: myTaskSectionIds.size,
        myTasks: scan.myTasks.length,
        tasks: itemIds.size,
        projectTaskLinks: scan.projectTasks.length,
        dependencies,
        followers,
        tags,
        customTaskTypes: customTaskTypeIds.size,
        customTaskStatuses: customTaskStatusIds.size,
        projectCustomTaskTypes: projectCustomTaskTypeExternalIds.length,
        customFieldValues,
        comments,
        attachments,
        timeTrackingEntries,
        goals: goalIds.size,
        goalRelationships,
        portfolios: portfolioIds.size,
        portfolioItems,
        templates,
        statusUpdates,
      };
    });

    await db.execute(sql`
      update public.work_migration_run
      set status = 'completed', summary = ${JSON.stringify(summary)}::jsonb,
          completed_at = now(), updated_at = now()
      where work_migration_run_id = ${runId}::uuid
    `);
    return { runId, summary };
  } catch (error) {
    await db.execute(sql`
      update public.work_migration_run
      set status = 'failed', error_message = ${
        error instanceof Error ? error.message.slice(0, 2000) : "Import failed"
      }, completed_at = now(), updated_at = now()
      where work_migration_run_id = ${runId}::uuid
    `);
    throw error;
  }
}

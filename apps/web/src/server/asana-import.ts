import { sql, type Db } from "@hrmny/db";
import type { AsanaTask } from "@hrmny/integrations";
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

export type AsanaImportSummary = {
  projects: number;
  sections: number;
  tasks: number;
  projectTaskLinks: number;
  dependencies: number;
  followers: number;
  tags: number;
  customFieldValues: number;
  comments: number;
  attachments: number;
};

export async function importAsanaWorkspace(input: {
  db: Db;
  scan: AsanaWorkspaceScan;
  workspaceGid: string;
  workspaceName: string;
  actorEmployeeId: string;
  mode?: "import" | "sync";
}): Promise<{ runId: string; summary: AsanaImportSummary }> {
  const { db, scan, actorEmployeeId } = input;
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

      const projectIds = new Map<string, string>();
      for (const project of scan.projects) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_project (
            name, description, privacy, owner_employee_id,
            created_by_employee_id, source_platform, external_id, archived_at
          ) values (
            ${limited(project.name, 160)}, ${project.notes ?? ""},
            ${project.privacy_setting?.includes("private") ? "private" : "organization"},
            ${employeeFor(project.owner?.email)}::uuid,
            ${actorEmployeeId}::uuid, 'asana', ${project.gid},
            ${project.archived ? (project.modified_at ?? project.created_at ?? new Date().toISOString()) : null}::timestamptz
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set
            name = excluded.name,
            description = excluded.description,
            privacy = excluded.privacy,
            owner_employee_id = excluded.owner_employee_id,
            archived_at = excluded.archived_at,
            updated_at = now()
          returning work_project_id as id
        `);
        projectIds.set(project.gid, String(row!.id));
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

      const itemIds = new Map<string, string>();
      for (const task of scan.tasks) {
        const [row] = await tx.execute(sql<{ id: string }>`
          insert into public.work_item (
            title, description, item_type, assignee_employee_id,
            created_by_employee_id, start_date, due_at, completed_at,
            source_platform, external_id
          ) values (
            ${limited(task.name, 500)}, ${task.notes ?? ""},
            ${asanaItemType(task.resource_subtype)},
            ${employeeFor(task.assignee?.email)}::uuid,
            ${actorEmployeeId}::uuid, ${task.start_on ?? null}::date,
            ${asanaDueAt(task)}::timestamptz, ${completedAt(task)}::timestamptz,
            'asana', ${task.gid}
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
      for (const link of scan.projectTasks) {
        const projectId = projectIds.get(link.projectGid);
        const itemId = itemIds.get(link.taskGid);
        if (!projectId || !itemId) continue;
        const sectionId = link.sectionGid
          ? (sectionIds.get(link.sectionGid) ?? null)
          : null;
        await tx.execute(sql`
          insert into public.work_project_item (
            work_project_id, work_item_id, work_section_id, position
          ) values (
            ${projectId}::uuid, ${itemId}::uuid, ${sectionId}::uuid, ${position++}
          )
          on conflict (work_project_id, work_item_id)
          do update set
            work_section_id = excluded.work_section_id,
            position = excluded.position,
            updated_at = now()
        `);
      }

      let dependencies = 0;
      let followers = 0;
      let tags = 0;
      let customFieldValues = 0;
      for (const task of scan.tasks) {
        const itemId = itemIds.get(task.gid);
        if (!itemId) continue;
        for (const dependency of task.dependencies ?? []) {
          const dependencyId = itemIds.get(dependency.gid);
          if (!dependencyId) continue;
          await tx.execute(sql`
            insert into public.work_item_dependency (
              work_item_id, depends_on_work_item_id, created_by_employee_id
            ) values (
              ${itemId}::uuid, ${dependencyId}::uuid, ${actorEmployeeId}::uuid
            ) on conflict (work_item_id, depends_on_work_item_id) do nothing
          `);
          dependencies++;
        }
        for (const follower of task.followers ?? []) {
          const employeeId = employeeFor(follower.email);
          if (!employeeId) continue;
          await tx.execute(sql`
            insert into public.work_item_follower (work_item_id, employee_id)
            values (${itemId}::uuid, ${employeeId}::uuid)
            on conflict (work_item_id, employee_id) do nothing
          `);
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
            insert into public.work_item_tag (work_item_id, work_tag_id)
            values (${itemId}::uuid, ${String(tagRow!.id)}::uuid)
            on conflict (work_item_id, work_tag_id) do nothing
          `);
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
                work_item_id, work_custom_field_id, value
              ) values (
                ${itemId}::uuid, ${String(fieldRow!.id)}::uuid,
                ${JSON.stringify(field)}::jsonb
              )
              on conflict (work_item_id, work_custom_field_id)
              do update set value = excluded.value, updated_at = now()
            `);
            customFieldValues++;
          }
        }
      }

      let comments = 0;
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
            ${employeeFor(story.created_by?.email) ?? actorEmployeeId}::uuid,
            ${body}, 'asana', ${story.gid},
            ${story.created_at ?? new Date().toISOString()}::timestamptz
          )
          on conflict (source_platform, external_id)
            where external_id is not null
          do update set body = excluded.body, edited_at = now(), updated_at = now()
        `);
        comments++;
      }

      let attachments = 0;
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
        attachments++;
      }

      return {
        projects: projectIds.size,
        sections: sectionIds.size,
        tasks: itemIds.size,
        projectTaskLinks: scan.projectTasks.length,
        dependencies,
        followers,
        tags,
        customFieldValues,
        comments,
        attachments,
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

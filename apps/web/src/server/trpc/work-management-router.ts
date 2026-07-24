import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { featureEnabled } from "../features";
import { writeAudit } from "../m1-persistence";
import {
  nextRecurrenceDate,
  normalizeCustomFieldValue,
  type WorkCustomFieldType,
  type WorkRecurrence,
} from "../work-daily";
import { router, staffProcedure, type TrpcContext } from "./trpc";

type AccessLevel = "admin" | "editor" | "commenter" | "viewer";
type WorkProject = {
  projectId: string;
  name: string;
  description: string;
  color: string;
  privacy: "organization" | "private";
  clientId: string | null;
  ownerEmployeeId: string | null;
  sourcePlatform: "native" | "asana";
  accessLevel: AccessLevel;
  createdAt: string;
};
type WorkSection = {
  sectionId: string;
  projectId: string;
  name: string;
  position: number;
};
type WorkItem = {
  itemId: string;
  parentItemId: string | null;
  title: string;
  description: string;
  itemType: "task" | "milestone" | "approval";
  priority: "low" | "medium" | "high" | "urgent" | null;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  startDate: string | null;
  dueAt: string | null;
  completedAt: string | null;
  sectionId: string | null;
  position: number;
  projectId: string;
  recurrence?: WorkRecurrence | null;
};
type WorkComment = {
  commentId: string;
  itemId: string;
  authorEmployeeId: string;
  authorName: string;
  body: string;
  createdAt: string;
};
type WorkTag = { tagId: string; name: string; color: string };
type WorkCustomField = {
  customFieldId: string;
  projectId: string;
  name: string;
  fieldType: WorkCustomFieldType;
  options: string[];
  isRequired: boolean;
  position: number;
};
type WorkAttachment = {
  attachmentId: string;
  itemId: string;
  name: string;
  storagePath: string | null;
  externalUrl: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};
type WorkNotification = {
  notificationId: string;
  itemId: string | null;
  projectId: string | null;
  eventType: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};
type WorkSavedSearch = {
  savedSearchId: string;
  ownerEmployeeId: string;
  name: string;
  query: Record<string, unknown>;
};

type DemoWork = {
  projects: Map<string, WorkProject>;
  sections: Map<string, WorkSection>;
  items: Map<string, WorkItem>;
  comments: Map<string, WorkComment>;
  dependencies: Map<string, Set<string>>;
  followers: Map<string, Set<string>>;
  tags: Map<string, WorkTag>;
  itemTags: Map<string, Set<string>>;
  customFields: Map<string, WorkCustomField>;
  customFieldValues: Map<string, unknown>;
  attachments: Map<string, WorkAttachment>;
  notifications: Map<
    string,
    WorkNotification & { recipientEmployeeId: string }
  >;
  savedSearches: Map<string, WorkSavedSearch>;
};

const DEMO_PROJECT_ID = "a1000000-0000-4000-8000-000000000001";
const DEMO_SECTION_TODO = "a2000000-0000-4000-8000-000000000001";
const DEMO_SECTION_DOING = "a2000000-0000-4000-8000-000000000002";
let demoWork: DemoWork | undefined;

function getDemoWork(): DemoWork {
  if (demoWork) return demoWork;
  const createdAt = new Date().toISOString();
  const projects = new Map<string, WorkProject>([
    [
      DEMO_PROJECT_ID,
      {
        projectId: DEMO_PROJECT_ID,
        name: "Asana migration pilot",
        description:
          "Validate the hrmny work graph before importing the live workspace.",
        color: "#C7702E",
        privacy: "organization",
        clientId: null,
        ownerEmployeeId: "c0000000-0000-4000-8000-000000000001",
        sourcePlatform: "native",
        accessLevel: "admin",
        createdAt,
      },
    ],
  ]);
  const sections = new Map<string, WorkSection>([
    [
      DEMO_SECTION_TODO,
      {
        sectionId: DEMO_SECTION_TODO,
        projectId: DEMO_PROJECT_ID,
        name: "To do",
        position: 0,
      },
    ],
    [
      DEMO_SECTION_DOING,
      {
        sectionId: DEMO_SECTION_DOING,
        projectId: DEMO_PROJECT_ID,
        name: "In progress",
        position: 1,
      },
    ],
  ]);
  const firstItem = "a3000000-0000-4000-8000-000000000001";
  const items = new Map<string, WorkItem>([
    [
      firstItem,
      {
        itemId: firstItem,
        parentItemId: null,
        title: "Confirm Asana workspace connection",
        description:
          "Connection must be observed and tested before import is enabled.",
        itemType: "task",
        priority: "high",
        assigneeEmployeeId: "c0000000-0000-4000-8000-000000000001",
        assigneeName: "Dev Partner",
        startDate: null,
        dueAt: null,
        completedAt: null,
        recurrence: null,
        sectionId: DEMO_SECTION_TODO,
        position: 0,
        projectId: DEMO_PROJECT_ID,
      },
    ],
  ]);
  demoWork = {
    projects,
    sections,
    items,
    comments: new Map(),
    dependencies: new Map(),
    followers: new Map(),
    tags: new Map(),
    itemTags: new Map(),
    customFields: new Map(),
    customFieldValues: new Map(),
    attachments: new Map(),
    notifications: new Map(),
    savedSearches: new Map(),
  };
  return demoWork;
}

const accessRank: Record<AccessLevel, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
};
const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const recurrenceSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365),
  endDate: z.string().date().optional(),
});

function actor(ctx: TrpcContext): string {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

async function audit(
  ctx: TrpcContext,
  action: string,
  entityType: string,
  entityId: string,
  after: Record<string, unknown>,
) {
  await writeAudit({
    actorEmployeeId: actor(ctx),
    action,
    entityType,
    entityId,
    before: null,
    after,
    reason: null,
  });
}

async function requireProjectAccess(
  ctx: TrpcContext,
  projectId: string,
  minimum: AccessLevel = "viewer",
) {
  const employeeId = actor(ctx);
  const db = getDb();
  if (!db) {
    const project = getDemoWork().projects.get(projectId);
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    return project;
  }
  const rows = await db.execute<WorkProject>(sql`
    select project.work_project_id as "projectId", project.name,
      project.description, project.color, project.privacy,
      project.client_id as "clientId",
      project.owner_employee_id as "ownerEmployeeId",
      project.source_platform as "sourcePlatform",
      case
        when project.created_by_employee_id = ${employeeId}::uuid
          or project.owner_employee_id = ${employeeId}::uuid then 'admin'
        when member.access_level is not null then member.access_level
        else 'viewer'
      end as "accessLevel",
      project.created_at as "createdAt"
    from public.work_project project
    left join public.work_project_member member
      on member.work_project_id = project.work_project_id
      and member.employee_id = ${employeeId}::uuid
    where project.work_project_id = ${projectId}::uuid
      and project.archived_at is null
      and (
        project.privacy = 'organization'
        or project.created_by_employee_id = ${employeeId}::uuid
        or project.owner_employee_id = ${employeeId}::uuid
        or member.employee_id is not null
      )
    limit 1
  `);
  const project = rows[0];
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  if (accessRank[project.accessLevel] < accessRank[minimum]) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${minimum} project access required`,
    });
  }
  return { ...project, createdAt: new Date(project.createdAt).toISOString() };
}

async function requireItemAccess(
  ctx: TrpcContext,
  itemId: string,
  minimum: AccessLevel = "viewer",
) {
  const db = getDb();
  if (!db) {
    const item = getDemoWork().items.get(itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND" });
    await requireProjectAccess(ctx, item.projectId, minimum);
    return item;
  }
  const rows = await db.execute<{ projectId: string }>(sql`
    select membership.work_project_id as "projectId"
    from public.work_project_item membership
    where membership.work_item_id = ${itemId}::uuid
  `);
  for (const row of rows) {
    try {
      await requireProjectAccess(ctx, row.projectId, minimum);
      return row;
    } catch (error) {
      if (error instanceof TRPCError && error.code === "NOT_FOUND") continue;
      if (error instanceof TRPCError && error.code === "FORBIDDEN") continue;
      throw error;
    }
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

type NotificationEvent =
  "assigned" | "updated" | "completed" | "commented" | "followed" | "due_soon";

async function notifyItem(
  ctx: TrpcContext,
  itemId: string,
  eventType: NotificationEvent,
  message: string,
) {
  const employeeId = actor(ctx);
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const item = store.items.get(itemId);
    const recipients = new Set(store.followers.get(itemId) ?? []);
    if (item?.assigneeEmployeeId) recipients.add(item.assigneeEmployeeId);
    recipients.delete(employeeId);
    for (const recipientEmployeeId of recipients) {
      const notificationId = randomUUID();
      store.notifications.set(notificationId, {
        notificationId,
        recipientEmployeeId,
        itemId,
        projectId: item?.projectId ?? null,
        eventType,
        message,
        readAt: null,
        createdAt: new Date().toISOString(),
      });
    }
    return;
  }
  await db.execute(sql`
    insert into public.work_notification (
      recipient_employee_id, actor_employee_id, work_item_id,
      work_project_id, event_type, message
    )
    select distinct recipient.employee_id, ${employeeId}::uuid,
      ${itemId}::uuid,
      (select min(project_item.work_project_id)
       from public.work_project_item project_item
       where project_item.work_item_id = ${itemId}::uuid),
      ${eventType}, ${message}
    from lateral (
      select item.assignee_employee_id as employee_id
      from public.work_item item
      where item.work_item_id = ${itemId}::uuid
      union
      select follower.employee_id
      from public.work_item_follower follower
      where follower.work_item_id = ${itemId}::uuid
    ) recipient
    where recipient.employee_id is not null
      and recipient.employee_id <> ${employeeId}::uuid
  `);
}

async function generateNextOccurrence(
  ctx: TrpcContext,
  itemId: string,
): Promise<string | null> {
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const source = store.items.get(itemId);
    const parsed = recurrenceSchema.safeParse(source?.recurrence);
    if (!source || !parsed.success) return null;
    const dueAt = nextRecurrenceDate(source.dueAt ?? new Date(), parsed.data);
    if (!dueAt) return null;
    const duplicate = [...store.items.values()].find(
      (item) =>
        item.title === source.title &&
        item.projectId === source.projectId &&
        item.dueAt === dueAt &&
        !item.completedAt,
    );
    if (duplicate) return duplicate.itemId;
    const generated = {
      ...source,
      itemId: randomUUID(),
      dueAt,
      completedAt: null,
    };
    store.items.set(generated.itemId, generated);
    store.followers.set(
      generated.itemId,
      new Set(store.followers.get(itemId) ?? []),
    );
    store.itemTags.set(
      generated.itemId,
      new Set(store.itemTags.get(itemId) ?? []),
    );
    for (const field of store.customFields.values()) {
      const sourceKey = `${itemId}:${field.customFieldId}`;
      if (store.customFieldValues.has(sourceKey))
        store.customFieldValues.set(
          `${generated.itemId}:${field.customFieldId}`,
          store.customFieldValues.get(sourceKey),
        );
    }
    return generated.itemId;
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${itemId}))`);
    const [source] = await tx.execute<{
      title: string;
      description: string;
      itemType: WorkItem["itemType"];
      priority: WorkItem["priority"];
      assigneeEmployeeId: string | null;
      createdByEmployeeId: string;
      parentItemId: string | null;
      startDate: string | null;
      dueAt: Date | string | null;
      recurrence: unknown;
    }>(sql`
      select title, description, item_type as "itemType", priority,
        assignee_employee_id as "assigneeEmployeeId",
        created_by_employee_id as "createdByEmployeeId",
        parent_work_item_id as "parentItemId", start_date as "startDate",
        due_at as "dueAt", recurrence
      from public.work_item
      where work_item_id = ${itemId}::uuid and archived_at is null
      for update
    `);
    const parsed = recurrenceSchema.safeParse(source?.recurrence);
    if (!source || !parsed.success) return null;
    const dueAt = nextRecurrenceDate(source.dueAt ?? new Date(), parsed.data);
    if (!dueAt) return null;
    const [existing] = await tx.execute<{ id: string }>(sql`
      select generated_work_item_id as id
      from public.work_recurrence_occurrence
      where source_work_item_id = ${itemId}::uuid
        and scheduled_for = ${dueAt.slice(0, 10)}::date
      limit 1
    `);
    if (existing) return existing.id;

    const [created] = await tx.execute<{ id: string }>(sql`
      insert into public.work_item (
        parent_work_item_id, title, description, item_type, priority,
        assignee_employee_id, created_by_employee_id, start_date, due_at,
        recurrence
      ) values (
        ${source.parentItemId}::uuid, ${source.title}, ${source.description},
        ${source.itemType}, ${source.priority}, ${source.assigneeEmployeeId}::uuid,
        ${source.createdByEmployeeId}::uuid,
        case
          when ${source.startDate}::date is not null and ${source.dueAt}::timestamptz is not null
          then ${source.startDate}::date + (${dueAt}::date - ${source.dueAt}::date)
          else null
        end,
        ${dueAt}::timestamptz, ${JSON.stringify(parsed.data)}::jsonb
      )
      returning work_item_id as id
    `);
    const generatedId = String(created!.id);
    await tx.execute(sql`
      insert into public.work_project_item (
        work_project_id, work_item_id, work_section_id, position
      )
      select membership.work_project_id, ${generatedId}::uuid,
        membership.work_section_id,
        (select coalesce(max(sibling.position), -1) + 1
         from public.work_project_item sibling
         where sibling.work_project_id = membership.work_project_id)
      from public.work_project_item membership
      where membership.work_item_id = ${itemId}::uuid
    `);
    await tx.execute(sql`
      insert into public.work_item_follower (work_item_id, employee_id)
      select ${generatedId}::uuid, employee_id
      from public.work_item_follower where work_item_id = ${itemId}::uuid
      on conflict (work_item_id, employee_id) do nothing
    `);
    await tx.execute(sql`
      insert into public.work_item_tag (work_item_id, work_tag_id)
      select ${generatedId}::uuid, work_tag_id
      from public.work_item_tag where work_item_id = ${itemId}::uuid
      on conflict (work_item_id, work_tag_id) do nothing
    `);
    await tx.execute(sql`
      insert into public.work_custom_field_value (
        work_item_id, work_custom_field_id, value
      )
      select ${generatedId}::uuid, work_custom_field_id, value
      from public.work_custom_field_value where work_item_id = ${itemId}::uuid
      on conflict (work_item_id, work_custom_field_id) do nothing
    `);
    await tx.execute(sql`
      insert into public.work_recurrence_occurrence (
        source_work_item_id, generated_work_item_id, scheduled_for
      ) values (${itemId}::uuid, ${generatedId}::uuid, ${dueAt.slice(0, 10)}::date)
    `);
    return generatedId;
  });
}

export const workManagementRouter = router({
  projects: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db) return [...getDemoWork().projects.values()];
      const rows = await db.execute<WorkProject>(sql`
        select project.work_project_id as "projectId", project.name,
          project.description, project.color, project.privacy,
          project.client_id as "clientId",
          project.owner_employee_id as "ownerEmployeeId",
          project.source_platform as "sourcePlatform",
          case
            when project.created_by_employee_id = ${employeeId}::uuid
              or project.owner_employee_id = ${employeeId}::uuid then 'admin'
            when member.access_level is not null then member.access_level
            else 'viewer'
          end as "accessLevel",
          project.created_at as "createdAt"
        from public.work_project project
        left join public.work_project_member member
          on member.work_project_id = project.work_project_id
          and member.employee_id = ${employeeId}::uuid
        where project.archived_at is null
          and (
            project.privacy = 'organization'
            or project.created_by_employee_id = ${employeeId}::uuid
            or project.owner_employee_id = ${employeeId}::uuid
            or member.employee_id is not null
          )
        order by lower(project.name)
      `);
      return rows.map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
      }));
    }),

    get: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        const project = await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        const subject = { userId: ctx.employeeId, roles: ctx.roles };
        const [showSections, showTasks, showDependencies] = await Promise.all([
          featureEnabled("work.sections", subject),
          featureEnabled("work.tasks", subject),
          featureEnabled("work.dependencies", subject),
        ]);
        if (!db) {
          const store = getDemoWork();
          return {
            project,
            sections: showSections
              ? [...store.sections.values()]
                  .filter((item) => item.projectId === input.projectId)
                  .sort((a, b) => a.position - b.position)
              : [],
            items: showTasks
              ? [...store.items.values()]
                  .filter((item) => item.projectId === input.projectId)
                  .sort((a, b) => a.position - b.position)
              : [],
            dependencies: showDependencies
              ? [...store.dependencies.entries()].flatMap(
                  ([itemId, dependencies]) =>
                    [...dependencies].map((dependsOnItemId) => ({
                      itemId,
                      dependsOnItemId,
                    })),
                )
              : [],
          };
        }
        const [sections, items, dependencies] = await Promise.all([
          showSections
            ? db.execute<WorkSection>(sql`
              select work_section_id as "sectionId", work_project_id as "projectId",
                name, position
              from public.work_section
              where work_project_id = ${input.projectId}::uuid
              order by position, created_at
            `)
            : [],
          showTasks
            ? db.execute<
                WorkItem & {
                  dueAt: Date | string | null;
                  completedAt: Date | string | null;
                }
              >(sql`
              select item.work_item_id as "itemId",
                item.parent_work_item_id as "parentItemId", item.title,
                item.description, item.item_type as "itemType", item.priority,
                item.recurrence,
                item.assignee_employee_id as "assigneeEmployeeId",
                assignee.display_name as "assigneeName", item.start_date as "startDate",
                item.due_at as "dueAt", item.completed_at as "completedAt",
                membership.work_section_id as "sectionId", membership.position,
                membership.work_project_id as "projectId"
              from public.work_project_item membership
              join public.work_item item on item.work_item_id = membership.work_item_id
              left join public.employee assignee on assignee.employee_id = item.assignee_employee_id
              where membership.work_project_id = ${input.projectId}::uuid
                and item.archived_at is null
              order by membership.position, item.created_at
            `)
            : [],
          showDependencies
            ? db.execute<{ itemId: string; dependsOnItemId: string }>(sql`
              select dependency.work_item_id as "itemId",
                dependency.depends_on_work_item_id as "dependsOnItemId"
              from public.work_item_dependency dependency
              join public.work_project_item membership
                on membership.work_item_id = dependency.work_item_id
              where membership.work_project_id = ${input.projectId}::uuid
            `)
            : [],
        ]);
        return {
          project,
          sections,
          items: items.map((item) => ({
            ...item,
            startDate: item.startDate ? String(item.startDate) : null,
            dueAt: iso(item.dueAt),
            completedAt: iso(item.completedAt),
          })),
          dependencies,
        };
      }),

    create: staffProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(20_000).default(""),
          privacy: z.enum(["organization", "private"]).default("organization"),
          clientId: nullableUuid.optional(),
          color: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .default("#C7702E"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        let project: WorkProject;
        if (!db) {
          project = {
            projectId: randomUUID(),
            name: input.name,
            description: input.description,
            color: input.color,
            privacy: input.privacy,
            clientId: input.clientId ?? null,
            ownerEmployeeId: employeeId,
            sourcePlatform: "native",
            accessLevel: "admin",
            createdAt: new Date().toISOString(),
          };
          const store = getDemoWork();
          store.projects.set(project.projectId, project);
          for (const [position, name] of [
            "To do",
            "In progress",
            "Done",
          ].entries()) {
            const sectionId = randomUUID();
            store.sections.set(sectionId, {
              sectionId,
              projectId: project.projectId,
              name,
              position,
            });
          }
        } else {
          project = await db.transaction(async (tx) => {
            const rows = await tx.execute<WorkProject>(sql`
              insert into public.work_project (
                name, description, color, privacy, client_id,
                owner_employee_id, created_by_employee_id
              ) values (
                ${input.name}, ${input.description}, ${input.color}, ${input.privacy},
                ${input.clientId ?? null}::uuid, ${employeeId}::uuid, ${employeeId}::uuid
              )
              returning work_project_id as "projectId", name, description, color,
                privacy, client_id as "clientId", owner_employee_id as "ownerEmployeeId",
                source_platform as "sourcePlatform", created_at as "createdAt"
            `);
            const created = rows[0]!;
            await tx.execute(sql`
              insert into public.work_project_member (
                work_project_id, employee_id, access_level
              ) values (${created.projectId}::uuid, ${employeeId}::uuid, 'admin')
            `);
            await tx.execute(sql`
              insert into public.work_section (work_project_id, name, position)
              values
                (${created.projectId}::uuid, 'To do', 0),
                (${created.projectId}::uuid, 'In progress', 1),
                (${created.projectId}::uuid, 'Done', 2)
            `);
            return {
              ...created,
              accessLevel: "admin",
              createdAt: new Date(created.createdAt).toISOString(),
            };
          });
        }
        await audit(
          ctx,
          "work.project.create",
          "work_project",
          project.projectId,
          { name: project.name, privacy: project.privacy },
        );
        return project;
      }),

    archive: staffProcedure
      .input(z.object({ projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "admin");
        const db = getDb();
        if (!db) getDemoWork().projects.delete(input.projectId);
        else
          await db.execute(
            sql`update public.work_project set archived_at = now(), updated_at = now() where work_project_id = ${input.projectId}::uuid`,
          );
        await audit(
          ctx,
          "work.project.archive",
          "work_project",
          input.projectId,
          { archived: true },
        );
        return { ok: true as const };
      }),
  }),

  sections: router({
    create: staffProcedure
      .input(
        z.object({ projectId: uuid, name: z.string().trim().min(1).max(120) }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        let section: WorkSection;
        if (!db) {
          const store = getDemoWork();
          section = {
            sectionId: randomUUID(),
            projectId: input.projectId,
            name: input.name,
            position: [...store.sections.values()].filter(
              (item) => item.projectId === input.projectId,
            ).length,
          };
          store.sections.set(section.sectionId, section);
        } else {
          const rows = await db.execute<WorkSection>(sql`
          insert into public.work_section (work_project_id, name, position)
          values (
            ${input.projectId}::uuid, ${input.name},
            (select coalesce(max(position), -1) + 1 from public.work_section where work_project_id = ${input.projectId}::uuid)
          )
          returning work_section_id as "sectionId", work_project_id as "projectId", name, position
        `);
          section = rows[0]!;
        }
        await audit(
          ctx,
          "work.section.create",
          "work_section",
          section.sectionId,
          { projectId: input.projectId, name: input.name },
        );
        return section;
      }),
  }),

  tasks: router({
    create: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          sectionId: nullableUuid.optional(),
          parentItemId: nullableUuid.optional(),
          title: z.string().trim().min(1).max(500),
          description: z.string().trim().max(20_000).default(""),
          itemType: z.enum(["task", "milestone", "approval"]).default("task"),
          priority: z
            .enum(["low", "medium", "high", "urgent"])
            .nullable()
            .optional(),
          assigneeEmployeeId: nullableUuid.optional(),
          startDate: z.string().date().nullable().optional(),
          dueAt: z.string().datetime().nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireProjectAccess(ctx, input.projectId, "editor");
        if (input.parentItemId)
          await requireItemAccess(ctx, input.parentItemId, "editor");
        const db = getDb();
        let item: WorkItem;
        if (!db) {
          const store = getDemoWork();
          item = {
            itemId: randomUUID(),
            parentItemId: input.parentItemId ?? null,
            title: input.title,
            description: input.description,
            itemType: input.itemType,
            priority: input.priority ?? null,
            assigneeEmployeeId: input.assigneeEmployeeId ?? null,
            assigneeName: input.assigneeEmployeeId ? "Assigned user" : null,
            startDate: input.startDate ?? null,
            dueAt: input.dueAt ?? null,
            completedAt: null,
            sectionId: input.sectionId ?? null,
            position: [...store.items.values()].filter(
              (candidate) => candidate.projectId === input.projectId,
            ).length,
            projectId: input.projectId,
            recurrence: null,
          };
          store.items.set(item.itemId, item);
        } else {
          item = await db.transaction(async (tx) => {
            if (input.sectionId) {
              const section = await tx.execute(sql`
                select 1 from public.work_section
                where work_section_id = ${input.sectionId}::uuid
                  and work_project_id = ${input.projectId}::uuid
                limit 1
              `);
              if (!section[0])
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Section does not belong to project",
                });
            }
            const rows = await tx.execute<WorkItem>(sql`
              insert into public.work_item (
                parent_work_item_id, title, description, item_type, priority,
                assignee_employee_id, created_by_employee_id, start_date, due_at
              ) values (
                ${input.parentItemId ?? null}::uuid, ${input.title}, ${input.description},
                ${input.itemType}, ${input.priority ?? null},
                ${input.assigneeEmployeeId ?? null}::uuid, ${employeeId}::uuid,
                ${input.startDate ?? null}::date, ${input.dueAt ?? null}::timestamptz
              )
              returning work_item_id as "itemId", parent_work_item_id as "parentItemId",
                title, description, item_type as "itemType", priority,
                recurrence,
                assignee_employee_id as "assigneeEmployeeId", start_date as "startDate",
                due_at as "dueAt", completed_at as "completedAt"
            `);
            const created = rows[0]!;
            const memberships = await tx.execute<{ position: number }>(sql`
              insert into public.work_project_item (
                work_project_id, work_item_id, work_section_id, position
              ) values (
                ${input.projectId}::uuid, ${created.itemId}::uuid,
                ${input.sectionId ?? null}::uuid,
                (select coalesce(max(position), -1) + 1 from public.work_project_item where work_project_id = ${input.projectId}::uuid)
              ) returning position
            `);
            let assigneeName: string | null = null;
            if (created.assigneeEmployeeId) {
              const assignees = await tx.execute<{ name: string }>(sql`
                select display_name as name from public.employee
                where employee_id = ${created.assigneeEmployeeId}::uuid limit 1
              `);
              assigneeName = assignees[0]?.name ?? null;
            }
            return {
              ...created,
              assigneeName,
              startDate: created.startDate ? String(created.startDate) : null,
              dueAt: iso(created.dueAt),
              completedAt: iso(created.completedAt),
              sectionId: input.sectionId ?? null,
              position: memberships[0]!.position,
              projectId: input.projectId,
            };
          });
        }
        await audit(ctx, "work.task.create", "work_item", item.itemId, {
          projectId: input.projectId,
          title: item.title,
          itemType: item.itemType,
        });
        if (item.assigneeEmployeeId) {
          await notifyItem(
            ctx,
            item.itemId,
            "assigned",
            `Assigned: ${item.title}`,
          );
        }
        return item;
      }),

    update: staffProcedure
      .input(
        z.object({
          itemId: uuid,
          title: z.string().trim().min(1).max(500).optional(),
          description: z.string().trim().max(20_000).optional(),
          priority: z
            .enum(["low", "medium", "high", "urgent"])
            .nullable()
            .optional(),
          assigneeEmployeeId: nullableUuid.optional(),
          startDate: z.string().date().nullable().optional(),
          dueAt: z.string().datetime().nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db) {
          const item = getDemoWork().items.get(input.itemId)!;
          Object.assign(item, {
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined
              ? { description: input.description }
              : {}),
            ...(input.priority !== undefined
              ? { priority: input.priority }
              : {}),
            ...(input.assigneeEmployeeId !== undefined
              ? {
                  assigneeEmployeeId: input.assigneeEmployeeId,
                  assigneeName: input.assigneeEmployeeId
                    ? "Assigned user"
                    : null,
                }
              : {}),
            ...(input.startDate !== undefined
              ? { startDate: input.startDate }
              : {}),
            ...(input.dueAt !== undefined ? { dueAt: input.dueAt } : {}),
          });
          await audit(ctx, "work.task.update", "work_item", input.itemId, {
            fields: Object.keys(input).filter((key) => key !== "itemId"),
          });
          await notifyItem(
            ctx,
            input.itemId,
            "updated",
            "A followed task was updated",
          );
          return item;
        }
        const rows = await db.execute<WorkItem>(sql`
          update public.work_item set
            title = coalesce(${input.title ?? null}, title),
            description = coalesce(${input.description ?? null}, description),
            priority = case when ${input.priority !== undefined} then ${input.priority ?? null} else priority end,
            assignee_employee_id = case when ${input.assigneeEmployeeId !== undefined} then ${input.assigneeEmployeeId ?? null}::uuid else assignee_employee_id end,
            start_date = case when ${input.startDate !== undefined} then ${input.startDate ?? null}::date else start_date end,
            due_at = case when ${input.dueAt !== undefined} then ${input.dueAt ?? null}::timestamptz else due_at end,
            updated_at = now()
          where work_item_id = ${input.itemId}::uuid and archived_at is null
          returning work_item_id as "itemId", parent_work_item_id as "parentItemId",
            title, description, item_type as "itemType", priority,
            recurrence,
            assignee_employee_id as "assigneeEmployeeId", start_date as "startDate",
            due_at as "dueAt", completed_at as "completedAt"
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(ctx, "work.task.update", "work_item", input.itemId, {
          fields: Object.keys(input).filter((key) => key !== "itemId"),
        });
        await notifyItem(
          ctx,
          input.itemId,
          "updated",
          "A followed task was updated",
        );
        return rows[0];
      }),

    complete: staffProcedure
      .input(z.object({ itemId: uuid, completed: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db)
          getDemoWork().items.get(input.itemId)!.completedAt = input.completed
            ? new Date().toISOString()
            : null;
        else
          await db.execute(
            sql`update public.work_item set completed_at = ${input.completed ? new Date() : null}, updated_at = now() where work_item_id = ${input.itemId}::uuid`,
          );
        const recurrenceEnabled = await featureEnabled("work.recurring_tasks", {
          userId: ctx.employeeId,
          roles: ctx.roles,
        });
        const generatedItemId =
          input.completed && recurrenceEnabled
            ? await generateNextOccurrence(ctx, input.itemId)
            : null;
        await audit(ctx, "work.task.complete", "work_item", input.itemId, {
          completed: input.completed,
          generatedItemId,
        });
        await notifyItem(
          ctx,
          input.itemId,
          input.completed ? "completed" : "updated",
          input.completed
            ? "A followed task was completed"
            : "A task was reopened",
        );
        return {
          ok: true as const,
          completedAt: input.completed ? new Date().toISOString() : null,
          generatedItemId,
        };
      }),

    move: staffProcedure
      .input(
        z.object({
          itemId: uuid,
          projectId: uuid,
          sectionId: nullableUuid,
          position: z.number().int().min(0).max(1_000_000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        if (!db) {
          const item = getDemoWork().items.get(input.itemId)!;
          item.sectionId = input.sectionId;
          item.position = input.position;
        } else {
          await db.execute(sql`
          update public.work_project_item
          set work_section_id = ${input.sectionId}::uuid, position = ${input.position}, updated_at = now()
          where work_project_id = ${input.projectId}::uuid and work_item_id = ${input.itemId}::uuid
        `);
        }
        await audit(ctx, "work.task.move", "work_item", input.itemId, {
          projectId: input.projectId,
          sectionId: input.sectionId,
          position: input.position,
        });
        return { ok: true as const };
      }),

    addToProject: staffProcedure
      .input(
        z.object({
          itemId: uuid,
          projectId: uuid,
          sectionId: nullableUuid.optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        if (!db)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Multi-home demo requires DATABASE_URL",
          });
        await db.execute(sql`
        insert into public.work_project_item (work_project_id, work_item_id, work_section_id, position)
        values (
          ${input.projectId}::uuid, ${input.itemId}::uuid, ${input.sectionId ?? null}::uuid,
          (select coalesce(max(position), -1) + 1 from public.work_project_item where work_project_id = ${input.projectId}::uuid)
        ) on conflict (work_project_id, work_item_id) do nothing
      `);
        await audit(ctx, "work.task.multiHome", "work_item", input.itemId, {
          projectId: input.projectId,
        });
        return { ok: true as const };
      }),
  }),

  comments: router({
    list: staffProcedure
      .input(z.object({ itemId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().comments.values()]
            .filter((item) => item.itemId === input.itemId)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        const rows = await db.execute<
          WorkComment & { createdAt: Date | string }
        >(sql`
        select comment.work_comment_id as "commentId", comment.work_item_id as "itemId",
          comment.author_employee_id as "authorEmployeeId", author.display_name as "authorName",
          comment.body, comment.created_at as "createdAt"
        from public.work_comment comment
        join public.employee author on author.employee_id = comment.author_employee_id
        where comment.work_item_id = ${input.itemId}::uuid and comment.deleted_at is null
        order by comment.created_at
      `);
        return rows.map((item) => ({
          ...item,
          createdAt: new Date(item.createdAt).toISOString(),
        }));
      }),
    create: staffProcedure
      .input(
        z.object({ itemId: uuid, body: z.string().trim().min(1).max(20_000) }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireItemAccess(ctx, input.itemId, "commenter");
        const db = getDb();
        let comment: WorkComment;
        if (!db) {
          comment = {
            commentId: randomUUID(),
            itemId: input.itemId,
            authorEmployeeId: employeeId,
            authorName: ctx.user?.displayName ?? "Staff",
            body: input.body,
            createdAt: new Date().toISOString(),
          };
          getDemoWork().comments.set(comment.commentId, comment);
        } else {
          const rows = await db.execute<
            WorkComment & { createdAt: Date | string }
          >(sql`
          insert into public.work_comment (work_item_id, author_employee_id, body)
          values (${input.itemId}::uuid, ${employeeId}::uuid, ${input.body})
          returning work_comment_id as "commentId", work_item_id as "itemId",
            author_employee_id as "authorEmployeeId", ${ctx.user?.displayName ?? "Staff"}::text as "authorName",
            body, created_at as "createdAt"
        `);
          comment = {
            ...rows[0]!,
            createdAt: new Date(rows[0]!.createdAt).toISOString(),
          };
        }
        await audit(
          ctx,
          "work.comment.create",
          "work_comment",
          comment.commentId,
          { itemId: input.itemId },
        );
        await notifyItem(
          ctx,
          input.itemId,
          "commented",
          "New comment on a followed task",
        );
        return comment;
      }),
  }),

  dependencies: router({
    add: staffProcedure
      .input(z.object({ itemId: uuid, dependsOnItemId: uuid }))
      .mutation(async ({ input, ctx }) => {
        if (input.itemId === input.dependsOnItemId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A task cannot depend on itself",
          });
        await requireItemAccess(ctx, input.itemId, "editor");
        await requireItemAccess(ctx, input.dependsOnItemId, "viewer");
        const db = getDb();
        if (!db) {
          const dependencies =
            getDemoWork().dependencies.get(input.itemId) ?? new Set<string>();
          dependencies.add(input.dependsOnItemId);
          getDemoWork().dependencies.set(input.itemId, dependencies);
        } else {
          await db.execute(sql`
          insert into public.work_item_dependency (
            work_item_id, depends_on_work_item_id, created_by_employee_id
          ) values (
            ${input.itemId}::uuid, ${input.dependsOnItemId}::uuid, ${actor(ctx)}::uuid
          ) on conflict (work_item_id, depends_on_work_item_id) do nothing
        `);
        }
        await audit(ctx, "work.dependency.add", "work_item", input.itemId, {
          dependsOnItemId: input.dependsOnItemId,
        });
        return { ok: true as const };
      }),
    remove: staffProcedure
      .input(z.object({ itemId: uuid, dependsOnItemId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db)
          getDemoWork()
            .dependencies.get(input.itemId)
            ?.delete(input.dependsOnItemId);
        else
          await db.execute(
            sql`delete from public.work_item_dependency where work_item_id = ${input.itemId}::uuid and depends_on_work_item_id = ${input.dependsOnItemId}::uuid`,
          );
        await audit(ctx, "work.dependency.remove", "work_item", input.itemId, {
          dependsOnItemId: input.dependsOnItemId,
        });
        return { ok: true as const };
      }),
  }),

  followers: router({
    list: staffProcedure
      .input(z.object({ itemId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId);
        const db = getDb();
        if (!db) {
          const ids = getDemoWork().followers.get(input.itemId) ?? new Set();
          return [...ids].map((employeeId) => ({
            employeeId,
            displayName:
              employeeId === ctx.employeeId
                ? (ctx.user?.displayName ?? "You")
                : "Follower",
          }));
        }
        return db.execute<{ employeeId: string; displayName: string }>(sql`
          select employee.employee_id as "employeeId",
            employee.display_name as "displayName"
          from public.work_item_follower follower
          join public.employee employee on employee.employee_id = follower.employee_id
          where follower.work_item_id = ${input.itemId}::uuid
          order by lower(employee.display_name)
        `);
      }),
    follow: staffProcedure
      .input(z.object({ itemId: uuid, employeeId: uuid.optional() }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = input.employeeId ?? actor(ctx);
        await requireItemAccess(
          ctx,
          input.itemId,
          employeeId === ctx.employeeId ? "viewer" : "editor",
        );
        const db = getDb();
        if (!db) {
          const followers =
            getDemoWork().followers.get(input.itemId) ?? new Set();
          followers.add(employeeId);
          getDemoWork().followers.set(input.itemId, followers);
        } else {
          const rows = await db.execute(sql`
            insert into public.work_item_follower (work_item_id, employee_id)
            select ${input.itemId}::uuid, employee_id
            from public.employee
            where employee_id = ${employeeId}::uuid and is_active = true
            on conflict (work_item_id, employee_id) do nothing
            returning work_item_follower_id
          `);
          if (!rows[0]) {
            const exists = await db.execute(sql`
              select 1 from public.work_item_follower
              where work_item_id = ${input.itemId}::uuid
                and employee_id = ${employeeId}::uuid
            `);
            if (!exists[0])
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Employee not found",
              });
          }
        }
        await audit(ctx, "work.follower.add", "work_item", input.itemId, {
          employeeId,
        });
        return { ok: true as const };
      }),
    unfollow: staffProcedure
      .input(z.object({ itemId: uuid, employeeId: uuid.optional() }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = input.employeeId ?? actor(ctx);
        await requireItemAccess(
          ctx,
          input.itemId,
          employeeId === ctx.employeeId ? "viewer" : "editor",
        );
        const db = getDb();
        if (!db) getDemoWork().followers.get(input.itemId)?.delete(employeeId);
        else
          await db.execute(sql`
            delete from public.work_item_follower
            where work_item_id = ${input.itemId}::uuid
              and employee_id = ${employeeId}::uuid
          `);
        await audit(ctx, "work.follower.remove", "work_item", input.itemId, {
          employeeId,
        });
        return { ok: true as const };
      }),
  }),

  tags: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) return [...getDemoWork().tags.values()];
        return db.execute<WorkTag>(sql`
          select distinct tag.work_tag_id as "tagId", tag.name, tag.color
          from public.work_tag tag
          left join public.work_item_tag item_tag on item_tag.work_tag_id = tag.work_tag_id
          left join public.work_project_item project_item
            on project_item.work_item_id = item_tag.work_item_id
          where project_item.work_project_id = ${input.projectId}::uuid
             or project_item.work_project_id is null
          order by lower(tag.name)
        `);
      }),
    create: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(80),
          color: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .default("#6B7280"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        let tag: WorkTag;
        if (!db) {
          tag = { tagId: randomUUID(), name: input.name, color: input.color };
          getDemoWork().tags.set(tag.tagId, tag);
        } else {
          const [row] = await db.execute<WorkTag>(sql`
            insert into public.work_tag (name, color)
            values (${input.name}, ${input.color})
            on conflict (name) do update set color = excluded.color, updated_at = now()
            returning work_tag_id as "tagId", name, color
          `);
          tag = row!;
        }
        await audit(ctx, "work.tag.create", "work_tag", tag.tagId, {
          name: tag.name,
        });
        return tag;
      }),
    setForTask: staffProcedure
      .input(z.object({ itemId: uuid, tagIds: z.array(uuid).max(50) }))
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const tagIds = [...new Set(input.tagIds)];
        const db = getDb();
        if (!db) {
          if (tagIds.some((tagId) => !getDemoWork().tags.has(tagId)))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Unknown tag",
            });
          getDemoWork().itemTags.set(input.itemId, new Set(tagIds));
        } else {
          await db.transaction(async (tx) => {
            const valid = tagIds.length
              ? await tx.execute<{ id: string }>(sql`
                  select work_tag_id as id from public.work_tag
                  where work_tag_id in ${sql`(${sql.join(
                    tagIds.map((id) => sql`${id}::uuid`),
                    sql`, `,
                  )})`}
                `)
              : [];
            if (valid.length !== tagIds.length)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Unknown tag",
              });
            await tx.execute(
              sql`delete from public.work_item_tag where work_item_id = ${input.itemId}::uuid`,
            );
            for (const tagId of tagIds) {
              await tx.execute(sql`
                insert into public.work_item_tag (work_item_id, work_tag_id)
                values (${input.itemId}::uuid, ${tagId}::uuid)
              `);
            }
          });
        }
        await audit(ctx, "work.tag.set", "work_item", input.itemId, { tagIds });
        return { ok: true as const, tagIds };
      }),
    forTask: staffProcedure
      .input(z.object({ itemId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId);
        const db = getDb();
        if (!db) {
          return [...(getDemoWork().itemTags.get(input.itemId) ?? [])].flatMap(
            (tagId) => {
              const tag = getDemoWork().tags.get(tagId);
              return tag ? [tag] : [];
            },
          );
        }
        return db.execute<WorkTag>(sql`
          select tag.work_tag_id as "tagId", tag.name, tag.color
          from public.work_item_tag item_tag
          join public.work_tag tag on tag.work_tag_id = item_tag.work_tag_id
          where item_tag.work_item_id = ${input.itemId}::uuid
          order by lower(tag.name)
        `);
      }),
  }),

  customFields: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().customFields.values()]
            .filter((field) => field.projectId === input.projectId)
            .sort((a, b) => a.position - b.position);
        const rows = await db.execute<
          WorkCustomField & { options: unknown }
        >(sql`
          select work_custom_field_id as "customFieldId",
            work_project_id as "projectId", name, field_type as "fieldType",
            options, is_required as "isRequired", position
          from public.work_custom_field
          where work_project_id = ${input.projectId}::uuid
          order by position, created_at
        `);
        return rows.map((row) => ({
          ...row,
          options: Array.isArray(row.options)
            ? row.options.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
        }));
      }),
    create: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(120),
          fieldType: z.enum([
            "text",
            "number",
            "date",
            "boolean",
            "single_select",
            "multi_select",
            "people",
          ]),
          options: z
            .array(z.string().trim().min(1).max(120))
            .max(100)
            .default([]),
          isRequired: z.boolean().default(false),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const options = [...new Set(input.options)];
        if (
          ["single_select", "multi_select"].includes(input.fieldType) &&
          !options.length
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Select fields need at least one option",
          });
        }
        const db = getDb();
        let field: WorkCustomField;
        if (!db) {
          field = {
            customFieldId: randomUUID(),
            projectId: input.projectId,
            name: input.name,
            fieldType: input.fieldType,
            options,
            isRequired: input.isRequired,
            position: [...getDemoWork().customFields.values()].filter(
              (candidate) => candidate.projectId === input.projectId,
            ).length,
          };
          getDemoWork().customFields.set(field.customFieldId, field);
        } else {
          const [row] = await db.execute<WorkCustomField>(sql`
            insert into public.work_custom_field (
              work_project_id, name, field_type, options, is_required, position
            ) values (
              ${input.projectId}::uuid, ${input.name}, ${input.fieldType},
              ${JSON.stringify(options)}::jsonb, ${input.isRequired},
              (select coalesce(max(position), -1) + 1 from public.work_custom_field
               where work_project_id = ${input.projectId}::uuid)
            )
            returning work_custom_field_id as "customFieldId",
              work_project_id as "projectId", name, field_type as "fieldType",
              options, is_required as "isRequired", position
          `);
          field = { ...row!, options };
        }
        await audit(
          ctx,
          "work.customField.create",
          "work_custom_field",
          field.customFieldId,
          {
            projectId: input.projectId,
            name: input.name,
            fieldType: input.fieldType,
          },
        );
        return field;
      }),
    values: staffProcedure
      .input(z.object({ itemId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId);
        const db = getDb();
        if (!db) {
          return [...getDemoWork().customFields.values()].flatMap((field) => {
            const key = `${input.itemId}:${field.customFieldId}`;
            return getDemoWork().customFieldValues.has(key)
              ? [
                  {
                    customFieldId: field.customFieldId,
                    value: getDemoWork().customFieldValues.get(key),
                  },
                ]
              : [];
          });
        }
        return db.execute<{ customFieldId: string; value: unknown }>(sql`
          select work_custom_field_id as "customFieldId", value
          from public.work_custom_field_value
          where work_item_id = ${input.itemId}::uuid
        `);
      }),
    setValue: staffProcedure
      .input(
        z.object({ itemId: uuid, customFieldId: uuid, value: z.unknown() }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db) {
          const field = getDemoWork().customFields.get(input.customFieldId);
          if (!field)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Field not found",
            });
          let value: unknown;
          try {
            value = normalizeCustomFieldValue(
              field.fieldType,
              input.value,
              field.options,
            );
          } catch (error) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                error instanceof Error ? error.message : "Invalid field value",
            });
          }
          getDemoWork().customFieldValues.set(
            `${input.itemId}:${input.customFieldId}`,
            value,
          );
          return { customFieldId: input.customFieldId, value };
        }
        const [field] = await db.execute<{
          fieldType: WorkCustomFieldType;
          options: unknown;
        }>(sql`
          select field_type as "fieldType", options
          from public.work_custom_field field
          where field.work_custom_field_id = ${input.customFieldId}::uuid
            and exists (
              select 1 from public.work_project_item project_item
              where project_item.work_item_id = ${input.itemId}::uuid
                and project_item.work_project_id = field.work_project_id
            )
          limit 1
        `);
        if (!field)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Field not found",
          });
        const options = Array.isArray(field.options)
          ? field.options.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        let value: unknown;
        try {
          value = normalizeCustomFieldValue(
            field.fieldType,
            input.value,
            options,
          );
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error ? error.message : "Invalid field value",
          });
        }
        if (value === null) {
          await db.execute(sql`
            delete from public.work_custom_field_value
            where work_item_id = ${input.itemId}::uuid
              and work_custom_field_id = ${input.customFieldId}::uuid
          `);
        } else {
          await db.execute(sql`
            insert into public.work_custom_field_value (
              work_item_id, work_custom_field_id, value
            ) values (
              ${input.itemId}::uuid, ${input.customFieldId}::uuid,
              ${JSON.stringify(value)}::jsonb
            )
            on conflict (work_item_id, work_custom_field_id)
            do update set value = excluded.value, updated_at = now()
          `);
        }
        await audit(ctx, "work.customField.set", "work_item", input.itemId, {
          customFieldId: input.customFieldId,
        });
        return { customFieldId: input.customFieldId, value };
      }),
  }),

  attachments: router({
    list: staffProcedure
      .input(z.object({ itemId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().attachments.values()].filter(
            (attachment) => attachment.itemId === input.itemId,
          );
        const rows = await db.execute<
          WorkAttachment & {
            sizeBytes: string | number | null;
            createdAt: Date | string;
          }
        >(sql`
          select work_attachment_id as "attachmentId", work_item_id as "itemId",
            name, storage_path as "storagePath", external_url as "externalUrl",
            content_type as "contentType", size_bytes as "sizeBytes",
            created_at as "createdAt"
          from public.work_attachment
          where work_item_id = ${input.itemId}::uuid
          order by created_at desc
        `);
        return rows.map((row) => ({
          ...row,
          sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      }),
    listProject: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) {
          const itemIds = new Set(
            [...getDemoWork().items.values()]
              .filter((item) => item.projectId === input.projectId)
              .map((item) => item.itemId),
          );
          return [...getDemoWork().attachments.values()].filter((attachment) =>
            itemIds.has(attachment.itemId),
          );
        }
        return db.execute<WorkAttachment & { taskTitle: string }>(sql`
          select attachment.work_attachment_id as "attachmentId",
            attachment.work_item_id as "itemId", attachment.name,
            attachment.storage_path as "storagePath",
            attachment.external_url as "externalUrl",
            attachment.content_type as "contentType",
            attachment.size_bytes::int as "sizeBytes",
            attachment.created_at as "createdAt", item.title as "taskTitle"
          from public.work_attachment attachment
          join public.work_item item on item.work_item_id = attachment.work_item_id
          join public.work_project_item project_item
            on project_item.work_item_id = item.work_item_id
          where project_item.work_project_id = ${input.projectId}::uuid
          order by attachment.created_at desc
        `);
      }),
    addLink: staffProcedure
      .input(
        z.object({
          itemId: uuid,
          name: z.string().trim().min(1).max(255),
          url: z.string().url().max(4096),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const attachmentId = randomUUID();
        const attachment: WorkAttachment = {
          attachmentId,
          itemId: input.itemId,
          name: input.name,
          storagePath: null,
          externalUrl: input.url,
          contentType: null,
          sizeBytes: null,
          createdAt: new Date().toISOString(),
        };
        const db = getDb();
        if (!db) getDemoWork().attachments.set(attachmentId, attachment);
        else
          await db.execute(sql`
            insert into public.work_attachment (
              work_attachment_id, work_item_id, name, external_url,
              uploaded_by_employee_id, source_platform
            ) values (
              ${attachmentId}::uuid, ${input.itemId}::uuid, ${input.name},
              ${input.url}, ${actor(ctx)}::uuid, 'external'
            )
          `);
        await audit(
          ctx,
          "work.attachment.link",
          "work_attachment",
          attachmentId,
          {
            itemId: input.itemId,
          },
        );
        return attachment;
      }),
    upload: staffProcedure
      .input(
        z.object({
          itemId: uuid,
          fileName: z.string().trim().min(1).max(255),
          contentType: z.string().trim().min(1).max(160),
          contentBase64: z
            .string()
            .min(1)
            .max(14_000_000)
            .regex(
              /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            ),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const body = Buffer.from(input.contentBase64, "base64");
        if (body.byteLength > 10_000_000)
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: "Files are limited to 10 MB",
          });
        const attachmentId = randomUUID();
        const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
        const storagePath = `work/${input.itemId}/${attachmentId}-${safeName}`;
        await getDemoStore().objectStore.put({
          path: storagePath,
          body: new Uint8Array(body),
          contentType: input.contentType,
        });
        const attachment: WorkAttachment = {
          attachmentId,
          itemId: input.itemId,
          name: input.fileName,
          storagePath,
          externalUrl: null,
          contentType: input.contentType,
          sizeBytes: body.byteLength,
          createdAt: new Date().toISOString(),
        };
        const db = getDb();
        try {
          if (!db) getDemoWork().attachments.set(attachmentId, attachment);
          else
            await db.execute(sql`
              insert into public.work_attachment (
                work_attachment_id, work_item_id, name, storage_path,
                content_type, size_bytes, uploaded_by_employee_id
              ) values (
                ${attachmentId}::uuid, ${input.itemId}::uuid, ${input.fileName},
                ${storagePath}, ${input.contentType}, ${body.byteLength},
                ${actor(ctx)}::uuid
              )
            `);
        } catch (error) {
          await getDemoStore().objectStore.remove?.(storagePath);
          throw error;
        }
        await audit(
          ctx,
          "work.attachment.upload",
          "work_attachment",
          attachmentId,
          {
            itemId: input.itemId,
            sizeBytes: body.byteLength,
          },
        );
        return attachment;
      }),
    open: staffProcedure
      .input(z.object({ attachmentId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const attachment = !db
          ? getDemoWork().attachments.get(input.attachmentId)
          : (
              await db.execute<{
                itemId: string;
                storagePath: string | null;
                externalUrl: string | null;
              }>(sql`
                select work_item_id as "itemId", storage_path as "storagePath",
                  external_url as "externalUrl"
                from public.work_attachment
                where work_attachment_id = ${input.attachmentId}::uuid
              `)
            )[0];
        if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
        await requireItemAccess(ctx, attachment.itemId);
        if (attachment.externalUrl)
          return { url: attachment.externalUrl, expiresAt: null };
        if (!attachment.storagePath) throw new TRPCError({ code: "NOT_FOUND" });
        return getDemoStore().objectStore.signedUrl(
          attachment.storagePath,
          300,
        );
      }),
    remove: staffProcedure
      .input(z.object({ attachmentId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const attachment = !db
          ? getDemoWork().attachments.get(input.attachmentId)
          : (
              await db.execute<{
                itemId: string;
                storagePath: string | null;
              }>(sql`
                select work_item_id as "itemId", storage_path as "storagePath"
                from public.work_attachment
                where work_attachment_id = ${input.attachmentId}::uuid
              `)
            )[0];
        if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
        await requireItemAccess(ctx, attachment.itemId, "editor");
        if (!db) getDemoWork().attachments.delete(input.attachmentId);
        else
          await db.execute(
            sql`delete from public.work_attachment where work_attachment_id = ${input.attachmentId}::uuid`,
          );
        if (attachment.storagePath)
          await getDemoStore().objectStore.remove?.(attachment.storagePath);
        await audit(
          ctx,
          "work.attachment.remove",
          "work_attachment",
          input.attachmentId,
          {
            itemId: attachment.itemId,
          },
        );
        return { ok: true as const };
      }),
  }),

  recurrence: router({
    set: staffProcedure
      .input(
        z.object({ itemId: uuid, recurrence: recurrenceSchema.nullable() }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db)
          getDemoWork().items.get(input.itemId)!.recurrence = input.recurrence;
        else
          await db.execute(sql`
            update public.work_item
            set recurrence = ${
              input.recurrence ? JSON.stringify(input.recurrence) : null
            }::jsonb, updated_at = now()
            where work_item_id = ${input.itemId}::uuid
          `);
        await audit(ctx, "work.recurrence.set", "work_item", input.itemId, {
          recurrence: input.recurrence,
        });
        return { itemId: input.itemId, recurrence: input.recurrence };
      }),
  }),

  personal: router({
    myTasks: staffProcedure
      .input(
        z
          .object({
            includeCompleted: z.boolean().default(false),
            query: z.string().trim().max(200).optional(),
          })
          .optional(),
      )
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db)
          return [...getDemoWork().items.values()].filter(
            (item) =>
              item.assigneeEmployeeId === employeeId &&
              (input?.includeCompleted || !item.completedAt) &&
              (!input?.query ||
                item.title.toLowerCase().includes(input.query.toLowerCase())),
          );
        const pattern = `%${input?.query ?? ""}%`;
        const rows = await db.execute<WorkItem & { projectName: string }>(sql`
          select item.work_item_id as "itemId",
            item.parent_work_item_id as "parentItemId", item.title,
            item.description, item.item_type as "itemType", item.priority,
            item.assignee_employee_id as "assigneeEmployeeId",
            assignee.display_name as "assigneeName", item.start_date as "startDate",
            item.due_at as "dueAt", item.completed_at as "completedAt",
            project_item.work_section_id as "sectionId", project_item.position,
            project.work_project_id as "projectId", project.name as "projectName",
            item.recurrence
          from public.work_item item
          join public.work_project_item project_item
            on project_item.work_item_id = item.work_item_id
          join public.work_project project
            on project.work_project_id = project_item.work_project_id
          left join public.work_project_member member
            on member.work_project_id = project.work_project_id
            and member.employee_id = ${employeeId}::uuid
          left join public.employee assignee
            on assignee.employee_id = item.assignee_employee_id
          where item.assignee_employee_id = ${employeeId}::uuid
            and item.archived_at is null and project.archived_at is null
            and (${input?.includeCompleted ?? false} or item.completed_at is null)
            and lower(item.title) like lower(${pattern})
            and (
              project.privacy = 'organization'
              or project.created_by_employee_id = ${employeeId}::uuid
              or project.owner_employee_id = ${employeeId}::uuid
              or member.employee_id is not null
            )
          order by item.completed_at nulls first, item.due_at nulls last, lower(item.title)
        `);
        return rows.map((item) => ({
          ...item,
          startDate: item.startDate ? String(item.startDate) : null,
          dueAt: iso(item.dueAt),
          completedAt: iso(item.completedAt),
        }));
      }),
    inbox: staffProcedure
      .input(z.object({ unreadOnly: z.boolean().default(false) }).optional())
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db)
          return [...getDemoWork().notifications.values()]
            .filter(
              (notification) =>
                notification.recipientEmployeeId === employeeId &&
                (!input?.unreadOnly || !notification.readAt),
            )
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const rows = await db.execute<
          WorkNotification & {
            createdAt: Date | string;
            readAt: Date | string | null;
          }
        >(sql`
          select notification.work_notification_id as "notificationId",
            notification.work_item_id as "itemId",
            notification.work_project_id as "projectId",
            notification.event_type as "eventType", notification.message,
            notification.read_at as "readAt", notification.created_at as "createdAt"
          from public.work_notification notification
          where notification.recipient_employee_id = ${employeeId}::uuid
            and notification.dismissed_at is null
            and (${input?.unreadOnly ?? false} = false or notification.read_at is null)
            and (
              notification.work_item_id is null
              or exists (
                select 1
                from public.work_project_item project_item
                join public.work_project project
                  on project.work_project_id = project_item.work_project_id
                left join public.work_project_member member
                  on member.work_project_id = project.work_project_id
                  and member.employee_id = ${employeeId}::uuid
                where project_item.work_item_id = notification.work_item_id
                  and project.archived_at is null
                  and (
                    project.privacy = 'organization'
                    or project.created_by_employee_id = ${employeeId}::uuid
                    or project.owner_employee_id = ${employeeId}::uuid
                    or member.employee_id is not null
                  )
              )
            )
          order by notification.created_at desc
          limit 200
        `);
        return rows.map((row) => ({
          ...row,
          readAt: iso(row.readAt),
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      }),
    markNotification: staffProcedure
      .input(
        z.object({
          notificationId: uuid,
          read: z.boolean(),
          dismissed: z.boolean().default(false),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const row = getDemoWork().notifications.get(input.notificationId);
          if (!row || row.recipientEmployeeId !== employeeId)
            throw new TRPCError({ code: "NOT_FOUND" });
          if (input.dismissed)
            getDemoWork().notifications.delete(input.notificationId);
          else row.readAt = input.read ? new Date().toISOString() : null;
        } else {
          const rows = await db.execute(sql`
            update public.work_notification
            set read_at = ${input.read ? new Date() : null},
              dismissed_at = ${input.dismissed ? new Date() : null}
            where work_notification_id = ${input.notificationId}::uuid
              and recipient_employee_id = ${employeeId}::uuid
            returning work_notification_id
          `);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true as const };
      }),
    search: staffProcedure
      .input(
        z.object({
          query: z.string().trim().min(1).max(200),
          projectId: uuid.optional(),
          includeCompleted: z.boolean().default(true),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      )
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        if (input.projectId) await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().items.values()]
            .filter(
              (item) =>
                (!input.projectId || item.projectId === input.projectId) &&
                (input.includeCompleted || !item.completedAt) &&
                `${item.title} ${item.description}`
                  .toLowerCase()
                  .includes(input.query.toLowerCase()),
            )
            .slice(0, input.limit);
        const pattern = `%${input.query}%`;
        return db.execute<WorkItem & { projectName: string }>(sql`
          select distinct on (item.work_item_id)
            item.work_item_id as "itemId", item.parent_work_item_id as "parentItemId",
            item.title, item.description, item.item_type as "itemType", item.priority,
            item.assignee_employee_id as "assigneeEmployeeId",
            assignee.display_name as "assigneeName", item.start_date as "startDate",
            item.due_at as "dueAt", item.completed_at as "completedAt",
            project_item.work_section_id as "sectionId", project_item.position,
            project.work_project_id as "projectId", project.name as "projectName",
            item.recurrence
          from public.work_item item
          join public.work_project_item project_item
            on project_item.work_item_id = item.work_item_id
          join public.work_project project
            on project.work_project_id = project_item.work_project_id
          left join public.work_project_member member
            on member.work_project_id = project.work_project_id
            and member.employee_id = ${employeeId}::uuid
          left join public.employee assignee
            on assignee.employee_id = item.assignee_employee_id
          where item.archived_at is null and project.archived_at is null
            and (${input.projectId ?? null}::uuid is null
              or project.work_project_id = ${input.projectId ?? null}::uuid)
            and (${input.includeCompleted} or item.completed_at is null)
            and (lower(item.title) like lower(${pattern})
              or lower(item.description) like lower(${pattern}))
            and (
              project.privacy = 'organization'
              or project.created_by_employee_id = ${employeeId}::uuid
              or project.owner_employee_id = ${employeeId}::uuid
              or member.employee_id is not null
            )
          order by item.work_item_id, item.updated_at desc
          limit ${input.limit}
        `);
      }),
    savedSearches: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db)
        return [...getDemoWork().savedSearches.values()].filter(
          (search) => search.ownerEmployeeId === employeeId,
        );
      return db.execute<WorkSavedSearch>(sql`
        select work_saved_search_id as "savedSearchId",
          owner_employee_id as "ownerEmployeeId", name, query
        from public.work_saved_search
        where owner_employee_id = ${employeeId}::uuid
        order by lower(name)
      `);
    }),
    saveSearch: staffProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          query: z.object({
            text: z.string().trim().min(1).max(200),
            projectId: uuid.optional(),
            includeCompleted: z.boolean().default(true),
          }),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        let search: WorkSavedSearch;
        if (!db) {
          const existing = [...getDemoWork().savedSearches.values()].find(
            (candidate) =>
              candidate.ownerEmployeeId === employeeId &&
              candidate.name === input.name,
          );
          search = {
            savedSearchId: existing?.savedSearchId ?? randomUUID(),
            ownerEmployeeId: employeeId,
            name: input.name,
            query: input.query,
          };
          getDemoWork().savedSearches.set(search.savedSearchId, search);
        } else {
          const [row] = await db.execute<WorkSavedSearch>(sql`
            insert into public.work_saved_search (owner_employee_id, name, query)
            values (
              ${employeeId}::uuid, ${input.name}, ${JSON.stringify(input.query)}::jsonb
            )
            on conflict (owner_employee_id, name)
            do update set query = excluded.query, updated_at = now()
            returning work_saved_search_id as "savedSearchId",
              owner_employee_id as "ownerEmployeeId", name, query
          `);
          search = row!;
        }
        await audit(
          ctx,
          "work.search.save",
          "work_saved_search",
          search.savedSearchId,
          {
            name: search.name,
          },
        );
        return search;
      }),
    deleteSearch: staffProcedure
      .input(z.object({ savedSearchId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const search = getDemoWork().savedSearches.get(input.savedSearchId);
          if (!search || search.ownerEmployeeId !== employeeId)
            throw new TRPCError({ code: "NOT_FOUND" });
          getDemoWork().savedSearches.delete(input.savedSearchId);
        } else {
          const rows = await db.execute(sql`
            delete from public.work_saved_search
            where work_saved_search_id = ${input.savedSearchId}::uuid
              and owner_employee_id = ${employeeId}::uuid
            returning work_saved_search_id
          `);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        return { ok: true as const };
      }),
  }),

  members: router({
    listEmployees: staffProcedure.query(async () => {
      const db = getDb();
      if (!db)
        return [
          {
            employeeId: "c0000000-0000-4000-8000-000000000001",
            displayName: "Dev Partner",
          },
        ];
      return db.execute<{ employeeId: string; displayName: string }>(sql`
        select employee_id as "employeeId", display_name as "displayName"
        from public.employee where is_active = true order by lower(display_name)
      `);
    }),
    upsert: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          employeeId: uuid,
          accessLevel: z.enum(["admin", "editor", "commenter", "viewer"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "admin");
        const db = getDb();
        if (!db) return { ...input };
        await db.execute(sql`
        insert into public.work_project_member (work_project_id, employee_id, access_level)
        values (${input.projectId}::uuid, ${input.employeeId}::uuid, ${input.accessLevel})
        on conflict (work_project_id, employee_id)
        do update set access_level = excluded.access_level, updated_at = now()
      `);
        await audit(
          ctx,
          "work.project.member",
          "work_project",
          input.projectId,
          { employeeId: input.employeeId, accessLevel: input.accessLevel },
        );
        return input;
      }),
  }),
});

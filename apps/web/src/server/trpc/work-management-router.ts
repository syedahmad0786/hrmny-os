import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { featureEnabled } from "../features";
import { writeAudit } from "../m1-persistence";
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
};
type WorkComment = {
  commentId: string;
  itemId: string;
  authorEmployeeId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

type DemoWork = {
  projects: Map<string, WorkProject>;
  sections: Map<string, WorkSection>;
  items: Map<string, WorkItem>;
  comments: Map<string, WorkComment>;
  dependencies: Map<string, Set<string>>;
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
            assignee_employee_id as "assigneeEmployeeId", start_date as "startDate",
            due_at as "dueAt", completed_at as "completedAt"
        `);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(ctx, "work.task.update", "work_item", input.itemId, {
          fields: Object.keys(input).filter((key) => key !== "itemId"),
        });
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
        await audit(ctx, "work.task.complete", "work_item", input.itemId, {
          completed: input.completed,
        });
        return {
          ok: true as const,
          completedAt: input.completed ? new Date().toISOString() : null,
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

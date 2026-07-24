import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { featureEnabled } from "../features";
import { getWorkOrganizationPolicy } from "../work-governance";
import { writeAudit } from "../m1-persistence";
import {
  nextRecurrenceDate,
  normalizeCustomFieldValue,
  type WorkCustomFieldType,
  type WorkRecurrence,
} from "../work-daily";
import {
  normalizeFormAnswers,
  relativeDate,
  ruleBranchMatches,
  type WorkFormQuestion,
  type WorkRuleAction,
  type WorkRuleBranch,
} from "../work-workflows";
import {
  budgetSummary,
  capacityUtilization,
  criticalPath,
  splitTimerByUtcDay,
  weightedProgress,
} from "../work-planning";
import { validateDailyMinutes } from "../shifts-timesheets";
import { queueWorkAiStudioEvent } from "../work-ai-studio-events";
import {
  queueAssignedWorkAiTeammate,
  queueMentionedWorkAiTeammates,
} from "../work-ai-teammate-events";
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
  budgetAmount?: number | null;
  budgetCurrency?: string;
  hourlyCostRate?: number | null;
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
  estimatedMinutes?: number | null;
};
type WorkComment = {
  commentId: string;
  itemId: string;
  authorEmployeeId: string | null;
  authorPortalUserId?: string | null;
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
type WorkForm = {
  formId: string;
  projectId: string;
  sectionId: string | null;
  name: string;
  description: string;
  titleQuestionKey: string;
  questions: WorkFormQuestion[];
  defaultAssigneeEmployeeId: string | null;
  confirmationMessage: string;
  isActive: boolean;
};
type WorkRule = {
  ruleId: string;
  projectId: string;
  name: string;
  triggerType:
    | "task_added"
    | "task_completed"
    | "task_moved"
    | "priority_changed"
    | "due_date_set"
    | "approval_decided";
  branches: WorkRuleBranch[];
  isEnabled: boolean;
};
type WorkRuleRun = {
  ruleRunId: string;
  ruleId: string;
  itemId: string;
  triggerType: WorkRule["triggerType"];
  status: "succeeded" | "skipped" | "failed";
  output: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
};
type WorkTemplate = {
  templateId: string;
  projectId: string | null;
  name: string;
  templateType: "task" | "project";
  blueprint: Record<string, unknown>;
  createdByEmployeeId: string;
};
type WorkBundle = {
  bundleId: string;
  name: string;
  description: string;
  visibility: "organization" | "limited";
  version: number;
  blueprint: Record<string, unknown>;
  createdByEmployeeId: string;
};
type WorkApprovalDecision = {
  decisionId: string;
  itemId: string;
  decision: "approved" | "changes_requested" | "rejected";
  note: string;
  decidedByEmployeeId: string;
  decidedAt: string;
};
type WorkGoal = {
  goalId: string;
  parentGoalId: string | null;
  name: string;
  description: string;
  scope: "company" | "team" | "individual";
  ownerEmployeeId: string | null;
  status: "on_track" | "at_risk" | "off_track" | "achieved" | "dropped";
  progress: number;
  startDate: string | null;
  dueDate: string | null;
  privacy: "organization" | "private";
  createdByEmployeeId: string;
  createdAt: string;
};
type WorkGoalLink = {
  goalLinkId: string;
  goalId: string;
  projectId: string | null;
  itemId: string | null;
  weight: number;
};
type WorkPortfolio = {
  portfolioId: string;
  name: string;
  description: string;
  color: string;
  privacy: "organization" | "private";
  ownerEmployeeId: string | null;
  createdByEmployeeId: string;
  createdAt: string;
};
type WorkStatusUpdate = {
  statusUpdateId: string;
  projectId: string | null;
  portfolioId: string | null;
  goalId: string | null;
  health: "on_track" | "at_risk" | "off_track" | "complete";
  progress: number | null;
  title: string;
  body: string;
  createdByEmployeeId: string;
  createdAt: string;
};
type WorkCapacityAllocation = {
  allocationId: string;
  employeeId: string;
  projectId: string;
  weekStart: string;
  allocatedMinutes: number;
  roleName: string | null;
};
type WorkTimer = {
  timerId: string;
  employeeId: string;
  projectId: string;
  itemId: string | null;
  description: string | null;
  startedAt: string;
  stoppedAt: string | null;
};
type WorkTimeEntry = {
  timeEntryId: string;
  employeeId: string;
  projectId: string;
  itemId: string | null;
  workDate: string;
  minutes: number;
  isBillable: boolean;
  description: string | null;
  status: "draft" | "submitted" | "approved" | "rejected";
};
type WorkDashboard = {
  dashboardId: string;
  ownerEmployeeId: string;
  name: string;
  config: Record<string, unknown>;
};
type WorkBaseline = {
  baselineId: string;
  projectId: string;
  itemId: string;
  startDate: string | null;
  dueAt: string | null;
  capturedAt: string;
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
  forms: Map<string, WorkForm>;
  formSubmissions: Map<
    string,
    { formId: string; itemId: string; answers: Record<string, unknown> }
  >;
  rules: Map<string, WorkRule>;
  ruleRuns: Map<string, WorkRuleRun>;
  templates: Map<string, WorkTemplate>;
  bundles: Map<string, WorkBundle>;
  projectBundles: Map<string, { version: number; appliedAt: string }>;
  approvalDecisions: Map<string, WorkApprovalDecision[]>;
  goals: Map<string, WorkGoal>;
  goalLinks: Map<string, WorkGoalLink>;
  portfolios: Map<string, WorkPortfolio>;
  portfolioProjects: Map<string, Set<string>>;
  statusUpdates: Map<string, WorkStatusUpdate>;
  allocations: Map<string, WorkCapacityAllocation>;
  timers: Map<string, WorkTimer>;
  timeEntries: Map<string, WorkTimeEntry>;
  dashboards: Map<string, WorkDashboard>;
  baselines: Map<string, WorkBaseline>;
};

const DEMO_PROJECT_ID = "a1000000-0000-4000-8000-000000000001";
const DEMO_SECTION_TODO = "a2000000-0000-4000-8000-000000000001";
const DEMO_SECTION_DOING = "a2000000-0000-4000-8000-000000000002";
let demoWork: DemoWork | undefined;

export function getDemoWork(): DemoWork {
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
        budgetAmount: 25_000,
        budgetCurrency: "AED",
        hourlyCostRate: 200,
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
        estimatedMinutes: 480,
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
    forms: new Map(),
    formSubmissions: new Map(),
    rules: new Map(),
    ruleRuns: new Map(),
    templates: new Map(),
    bundles: new Map(),
    projectBundles: new Map(),
    approvalDecisions: new Map(),
    goals: new Map(),
    goalLinks: new Map(),
    portfolios: new Map(),
    portfolioProjects: new Map(),
    statusUpdates: new Map(),
    allocations: new Map(),
    timers: new Map(),
    timeEntries: new Map(),
    dashboards: new Map(),
    baselines: new Map(),
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
const formQuestionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().trim().min(1).max(200),
  type: z.enum([
    "text",
    "textarea",
    "single_select",
    "multi_select",
    "date",
    "number",
    "checkbox",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  showWhen: z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      equals: z.union([z.string().max(200), z.boolean()]),
    })
    .optional(),
});
const ruleConditionSchema = z.object({
  field: z.enum(["title", "priority", "completed", "sectionId", "itemType"]),
  operator: z.enum([
    "equals",
    "not_equals",
    "contains",
    "is_empty",
    "is_not_empty",
  ]),
  value: z.union([z.string().max(500), z.boolean(), z.null()]).optional(),
});
const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_priority"),
    value: z.enum(["low", "medium", "high", "urgent"]).nullable(),
  }),
  z.object({ type: z.literal("move_section"), sectionId: uuid }),
  z.object({ type: z.literal("assign"), employeeId: nullableUuid }),
  z.object({ type: z.literal("complete") }),
  z.object({ type: z.literal("add_tag"), tagId: uuid }),
  z.object({
    type: z.literal("create_subtask"),
    title: z.string().trim().min(1).max(500),
    dueInDays: z.number().int().min(-3650).max(3650).optional(),
  }),
]);
const ruleBranchSchema = z.object({
  mode: z.enum(["all", "any"]),
  conditions: z.array(ruleConditionSchema).max(20),
  actions: z.array(ruleActionSchema).min(1).max(20),
});
const taskTemplateBlueprintSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(20_000).default(""),
  itemType: z.enum(["task", "milestone", "approval"]).default("task"),
  priority: z
    .enum(["low", "medium", "high", "urgent"])
    .nullable()
    .default(null),
  assigneeEmployeeId: nullableUuid.optional(),
  dueInDays: z.number().int().min(-3650).max(3650).optional(),
  subtasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        description: z.string().trim().max(20_000).default(""),
        dueInDays: z.number().int().min(-3650).max(3650).optional(),
      }),
    )
    .max(100)
    .default([]),
});
const projectTemplateBlueprintSchema = z.object({
  description: z.string().max(20_000).default(""),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  privacy: z.enum(["organization", "private"]),
  sections: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        position: z.number().int().min(0).max(100_000),
      }),
    )
    .max(200),
  tasks: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        description: z.string().max(20_000).default(""),
        itemType: z.enum(["task", "milestone", "approval"]),
        priority: z.enum(["low", "medium", "high", "urgent"]).nullable(),
        sectionName: z.string().max(120).nullable(),
        dueOffsetDays: z.number().int().min(-3650).max(3650).nullable(),
      }),
    )
    .max(5000),
});
const bundleBlueprintSchema = z.object({
  sections: z
    .array(z.object({ name: z.string().trim().min(1).max(120) }))
    .max(200),
  sectionRefs: z.record(uuid, z.string().trim().min(1).max(120)),
  customFields: z
    .array(
      z.object({
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
        options: z.array(z.string().max(120)).max(100),
        isRequired: z.boolean(),
      }),
    )
    .max(200),
  rules: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        triggerType: z.enum([
          "task_added",
          "task_completed",
          "task_moved",
          "priority_changed",
          "due_date_set",
          "approval_decided",
        ]),
        branches: z.array(ruleBranchSchema).min(1).max(20),
      }),
    )
    .max(200),
  taskTemplates: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(160),
        blueprint: taskTemplateBlueprintSchema,
      }),
    )
    .max(200),
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

async function requireWorkTypeFeature(
  ctx: TrpcContext,
  itemType: WorkItem["itemType"],
) {
  const featureKey =
    itemType === "approval"
      ? "work.approvals"
      : itemType === "milestone"
        ? "work.milestones"
        : null;
  if (
    featureKey &&
    !(await featureEnabled(featureKey, {
      userId: ctx.employeeId,
      roles: ctx.roles,
    }))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `FEATURE_DISABLED:${featureKey}`,
    });
  }
}

async function requireWorkFeature(ctx: TrpcContext, featureKey: string) {
  if (
    !(await featureEnabled(featureKey, {
      userId: ctx.employeeId,
      clientId: ctx.clientId,
      roles: ctx.roles,
    }))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `FEATURE_DISABLED:${featureKey}`,
    });
}

export async function requireProjectAccess(
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
        when team_access.access_level is not null then team_access.access_level
        else 'viewer'
      end as "accessLevel",
      project.created_at as "createdAt"
    from public.work_project project
    left join public.work_project_member member
      on member.work_project_id = project.work_project_id
      and member.employee_id = ${employeeId}::uuid
    left join lateral (
      select team_project.access_level
      from public.work_team_project team_project
      join public.work_team_member team_member
        on team_member.work_team_id = team_project.work_team_id
      where team_project.work_project_id = project.work_project_id
        and team_member.employee_id = ${employeeId}::uuid
      order by case team_project.access_level
        when 'editor' then 3 when 'commenter' then 2 else 1 end desc
      limit 1
    ) team_access on true
    where project.work_project_id = ${projectId}::uuid
      and project.archived_at is null
      and (
        project.privacy = 'organization'
        or project.created_by_employee_id = ${employeeId}::uuid
        or project.owner_employee_id = ${employeeId}::uuid
        or member.employee_id is not null
        or team_access.access_level is not null
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

export async function requireItemAccess(
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

async function requireItemInProject(
  ctx: TrpcContext,
  itemId: string,
  projectId: string,
) {
  await requireItemAccess(ctx, itemId);
  const db = getDb();
  const belongs = !db
    ? getDemoWork().items.get(itemId)?.projectId === projectId
    : Boolean(
        (
          await db.execute(sql`
            select 1 from public.work_project_item
            where work_item_id = ${itemId}::uuid
              and work_project_id = ${projectId}::uuid limit 1
          `)
        )[0],
      );
  if (!belongs)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Task does not belong to the selected project",
    });
}

function canManageOwned(
  ctx: TrpcContext,
  ownerEmployeeId: string | null,
  createdByEmployeeId: string,
) {
  const employeeId = actor(ctx);
  return employeeId === ownerEmployeeId || employeeId === createdByEmployeeId;
}

async function requireGoalAccess(
  ctx: TrpcContext,
  goalId: string,
  manage = false,
): Promise<WorkGoal> {
  const employeeId = actor(ctx);
  const db = getDb();
  let goal: WorkGoal | undefined;
  if (!db) goal = getDemoWork().goals.get(goalId);
  else {
    const rows = await db.execute<WorkGoal & { progress: string | number }>(sql`
      select work_goal_id as "goalId", parent_work_goal_id as "parentGoalId",
        name, description, scope, owner_employee_id as "ownerEmployeeId",
        status, progress, start_date::text as "startDate", due_date::text as "dueDate",
        privacy, created_by_employee_id as "createdByEmployeeId",
        created_at as "createdAt"
      from public.work_goal where work_goal_id = ${goalId}::uuid
        and archived_at is null
    `);
    const row = rows[0];
    if (row)
      goal = {
        ...row,
        progress: Number(row.progress),
        createdAt: new Date(row.createdAt).toISOString(),
      };
  }
  if (
    !goal ||
    (goal.privacy === "private" &&
      !canManageOwned(ctx, goal.ownerEmployeeId, goal.createdByEmployeeId))
  ) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  if (
    manage &&
    !canManageOwned(ctx, goal.ownerEmployeeId, goal.createdByEmployeeId)
  ) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return goal;
}

async function requirePortfolioAccess(
  ctx: TrpcContext,
  portfolioId: string,
  manage = false,
): Promise<WorkPortfolio> {
  const db = getDb();
  let portfolio: WorkPortfolio | undefined;
  if (!db) portfolio = getDemoWork().portfolios.get(portfolioId);
  else {
    const rows = await db.execute<WorkPortfolio>(sql`
      select work_portfolio_id as "portfolioId", name, description, color,
        privacy, owner_employee_id as "ownerEmployeeId",
        created_by_employee_id as "createdByEmployeeId", created_at as "createdAt"
      from public.work_portfolio
      where work_portfolio_id = ${portfolioId}::uuid and archived_at is null
    `);
    const row = rows[0];
    if (row)
      portfolio = {
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
      };
  }
  if (
    !portfolio ||
    (portfolio.privacy === "private" &&
      !canManageOwned(
        ctx,
        portfolio.ownerEmployeeId,
        portfolio.createdByEmployeeId,
      ))
  ) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
  if (
    manage &&
    !canManageOwned(
      ctx,
      portfolio.ownerEmployeeId,
      portfolio.createdByEmployeeId,
    )
  ) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
  return portfolio;
}

async function goalProgress(goal: WorkGoal): Promise<number> {
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const linked = [...store.goalLinks.values()]
      .filter((link) => link.goalId === goal.goalId)
      .flatMap((link) => {
        if (link.itemId) {
          const item = store.items.get(link.itemId);
          return item
            ? [{ progress: item.completedAt ? 100 : 0, weight: link.weight }]
            : [];
        }
        const items = [...store.items.values()].filter(
          (item) => item.projectId === link.projectId,
        );
        return [
          {
            progress: items.length
              ? (items.filter((item) => item.completedAt).length /
                  items.length) *
                100
              : 0,
            weight: link.weight,
          },
        ];
      });
    linked.push(
      ...[...store.goals.values()]
        .filter((item) => item.parentGoalId === goal.goalId)
        .map((item) => ({ progress: item.progress, weight: 1 })),
    );
    return weightedProgress(
      linked,
      goal.status === "achieved" ? 100 : goal.progress,
    );
  }
  const contributions = await db.execute<{
    progress: string | number;
    weight: string | number;
  }>(sql`
    select link.weight,
      case
        when link.work_item_id is not null then
          case when item.completed_at is null then 0 else 100 end
        else coalesce((
          select 100.0 * count(*) filter (where project_item.completed_at is not null)
            / nullif(count(*), 0)
          from public.work_project_item membership
          join public.work_item project_item
            on project_item.work_item_id = membership.work_item_id
          where membership.work_project_id = link.work_project_id
            and project_item.archived_at is null
        ), 0)
      end as progress
    from public.work_goal_link link
    left join public.work_item item on item.work_item_id = link.work_item_id
    where link.work_goal_id = ${goal.goalId}::uuid
    union all
    select 1 as weight, progress from public.work_goal
    where parent_work_goal_id = ${goal.goalId}::uuid and archived_at is null
  `);
  return weightedProgress(
    contributions.map((item) => ({
      progress: Number(item.progress),
      weight: Number(item.weight),
    })),
    goal.status === "achieved" ? 100 : goal.progress,
  );
}

async function projectProgress(projectId: string): Promise<number> {
  const db = getDb();
  if (!db) {
    const items = [...getDemoWork().items.values()].filter(
      (item) => item.projectId === projectId,
    );
    return items.length
      ? Math.round(
          (items.filter((item) => item.completedAt).length / items.length) *
            100,
        )
      : 0;
  }
  const row = (
    await db.execute<{ progress: string | number }>(sql`
      select coalesce(
        100.0 * count(*) filter (where item.completed_at is not null)
          / nullif(count(*), 0), 0
      ) as progress
      from public.work_project_item membership
      join public.work_item item on item.work_item_id = membership.work_item_id
      where membership.work_project_id = ${projectId}::uuid
        and item.archived_at is null
    `)
  )[0];
  return Math.round(Number(row?.progress ?? 0) * 100) / 100;
}

async function projectPlanningSummary(ctx: TrpcContext, projectId: string) {
  const project = await requireProjectAccess(ctx, projectId);
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const items = [...store.items.values()].filter(
      (item) => item.projectId === projectId,
    );
    const actualMinutes = [...store.timeEntries.values()]
      .filter((entry) => entry.projectId === projectId)
      .reduce((sum, entry) => sum + entry.minutes, 0);
    const remainingEstimatedMinutes = items
      .filter((item) => !item.completedAt)
      .reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
    return {
      projectId,
      name: project.name,
      progress: await projectProgress(projectId),
      totalTasks: items.length,
      completedTasks: items.filter((item) => item.completedAt).length,
      overdueTasks: items.filter(
        (item) =>
          !item.completedAt && item.dueAt && new Date(item.dueAt) < new Date(),
      ).length,
      unassignedTasks: items.filter((item) => !item.assigneeEmployeeId).length,
      actualMinutes,
      remainingEstimatedMinutes,
      budgetAmount: project.budgetAmount ?? null,
      budgetCurrency: project.budgetCurrency ?? "AED",
      hourlyCostRate: project.hourlyCostRate ?? null,
      ...budgetSummary(
        project.budgetAmount ?? null,
        project.hourlyCostRate ?? null,
        actualMinutes,
        remainingEstimatedMinutes,
      ),
    };
  }
  const [settings, metrics] = await Promise.all([
    db.execute<{
      budgetAmount: string | number | null;
      budgetCurrency: string;
      hourlyCostRate: string | number | null;
    }>(sql`
      select budget_amount as "budgetAmount", budget_currency as "budgetCurrency",
        hourly_cost_rate as "hourlyCostRate"
      from public.work_project where work_project_id = ${projectId}::uuid
    `),
    db.execute<{
      totalTasks: number;
      completedTasks: number;
      overdueTasks: number;
      unassignedTasks: number;
      remainingEstimatedMinutes: number;
      actualMinutes: number;
    }>(sql`
      select count(distinct item.work_item_id)::int as "totalTasks",
        count(distinct item.work_item_id) filter (
          where item.completed_at is not null
        )::int as "completedTasks",
        count(distinct item.work_item_id) filter (
          where item.completed_at is null and item.due_at < now()
        )::int as "overdueTasks",
        count(distinct item.work_item_id) filter (
          where item.assignee_employee_id is null
        )::int as "unassignedTasks",
        coalesce(sum(item.estimated_minutes) filter (
          where item.completed_at is null
        ), 0)::int as "remainingEstimatedMinutes",
        coalesce((select sum(entry.minutes) from public.time_entry entry
          where entry.work_project_id = ${projectId}::uuid), 0)::int as "actualMinutes"
      from public.work_project_item membership
      join public.work_item item on item.work_item_id = membership.work_item_id
      where membership.work_project_id = ${projectId}::uuid
        and item.archived_at is null
    `),
  ]);
  const setting = settings[0]!;
  const metric = metrics[0] ?? {
    totalTasks: 0,
    completedTasks: 0,
    overdueTasks: 0,
    unassignedTasks: 0,
    remainingEstimatedMinutes: 0,
    actualMinutes: 0,
  };
  const budgetAmount =
    setting.budgetAmount === null ? null : Number(setting.budgetAmount);
  const hourlyCostRate =
    setting.hourlyCostRate === null ? null : Number(setting.hourlyCostRate);
  return {
    projectId,
    name: project.name,
    progress: await projectProgress(projectId),
    ...metric,
    budgetAmount,
    budgetCurrency: setting.budgetCurrency,
    hourlyCostRate,
    ...budgetSummary(
      budgetAmount,
      hourlyCostRate,
      metric.actualMinutes,
      metric.remainingEstimatedMinutes,
    ),
  };
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

async function ruleSnapshot(
  itemId: string,
  projectId?: string,
): Promise<WorkItem> {
  const db = getDb();
  if (!db) {
    const item = getDemoWork().items.get(itemId);
    if (!item) throw new TRPCError({ code: "NOT_FOUND" });
    return item;
  }
  const [item] = await db.execute<WorkItem>(sql`
    select item.work_item_id as "itemId",
      item.parent_work_item_id as "parentItemId", item.title,
      item.description, item.item_type as "itemType", item.priority,
      item.assignee_employee_id as "assigneeEmployeeId",
      null::text as "assigneeName", item.start_date as "startDate",
      item.due_at as "dueAt", item.completed_at as "completedAt",
      membership.work_section_id as "sectionId", membership.position,
      membership.work_project_id as "projectId", item.recurrence
    from public.work_item item
    join public.work_project_item membership
      on membership.work_item_id = item.work_item_id
    where item.work_item_id = ${itemId}::uuid
      and (${projectId ?? null}::uuid is null
        or membership.work_project_id = ${projectId ?? null}::uuid)
    order by membership.created_at
    limit 1
  `);
  if (!item) throw new TRPCError({ code: "NOT_FOUND" });
  return item;
}

async function executeRuleAction(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
  action: WorkRuleAction,
) {
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const item = store.items.get(itemId);
    if (!item) throw new Error("Task not found");
    if (action.type === "set_priority") item.priority = action.value;
    else if (action.type === "move_section") {
      const section = store.sections.get(action.sectionId);
      if (section?.projectId !== projectId)
        throw new Error("Section not found");
      item.sectionId = action.sectionId;
    } else if (action.type === "assign") {
      if (
        action.employeeId &&
        action.employeeId !== "c0000000-0000-4000-8000-000000000001"
      ) {
        throw new Error("Employee not found");
      }
      item.assigneeEmployeeId = action.employeeId;
      item.assigneeName = action.employeeId ? "Dev Partner" : null;
    } else if (action.type === "complete") {
      item.completedAt = new Date().toISOString();
    } else if (action.type === "add_tag") {
      if (!store.tags.has(action.tagId)) throw new Error("Tag not found");
      const tags = store.itemTags.get(itemId) ?? new Set<string>();
      tags.add(action.tagId);
      store.itemTags.set(itemId, tags);
    } else {
      const subtaskId = randomUUID();
      store.items.set(subtaskId, {
        ...item,
        itemId: subtaskId,
        parentItemId: itemId,
        title: action.title,
        description: "",
        dueAt:
          action.dueInDays === undefined
            ? null
            : relativeDate(action.dueInDays),
        completedAt: null,
        recurrence: null,
      });
    }
    if (action.type === "complete") {
      const enabled = await featureEnabled("work.recurring_tasks", {
        userId: ctx.employeeId,
        roles: ctx.roles,
      });
      if (enabled) await generateNextOccurrence(ctx, itemId);
    }
    await notifyItem(
      ctx,
      itemId,
      action.type === "assign"
        ? "assigned"
        : action.type === "complete"
          ? "completed"
          : "updated",
      `Rule action: ${action.type.replaceAll("_", " ")}`,
    );
    return;
  }

  if (action.type === "set_priority") {
    await db.execute(sql`
      update public.work_item set priority = ${action.value}, updated_at = now()
      where work_item_id = ${itemId}::uuid
    `);
  } else if (action.type === "move_section") {
    const changed = await db.execute(sql`
      update public.work_project_item membership
      set work_section_id = section.work_section_id
      from public.work_section section
      where membership.work_item_id = ${itemId}::uuid
        and membership.work_project_id = ${projectId}::uuid
        and section.work_section_id = ${action.sectionId}::uuid
        and section.work_project_id = membership.work_project_id
      returning membership.work_project_item_id
    `);
    if (!changed[0]) throw new Error("Section not found");
  } else if (action.type === "assign") {
    if (action.employeeId) {
      const employee = await db.execute(sql`
        select 1 from public.employee
        where employee_id = ${action.employeeId}::uuid and is_active = true
      `);
      if (!employee[0]) throw new Error("Employee not found");
    }
    await db.execute(sql`
      update public.work_item
      set assignee_employee_id = ${action.employeeId}::uuid, updated_at = now()
      where work_item_id = ${itemId}::uuid
    `);
  } else if (action.type === "complete") {
    await db.execute(sql`
      update public.work_item set completed_at = now(), updated_at = now()
      where work_item_id = ${itemId}::uuid
    `);
  } else if (action.type === "add_tag") {
    const inserted = await db.execute(sql`
      insert into public.work_item_tag (work_item_id, work_tag_id)
      select ${itemId}::uuid, tag.work_tag_id
      from public.work_tag tag
      where tag.work_tag_id = ${action.tagId}::uuid
      on conflict (work_item_id, work_tag_id) do nothing
      returning work_item_tag_id
    `);
    if (!inserted[0]) {
      const exists = await db.execute(sql`
        select 1 from public.work_item_tag
        where work_item_id = ${itemId}::uuid
          and work_tag_id = ${action.tagId}::uuid
      `);
      if (!exists[0]) throw new Error("Tag not found");
    }
  } else {
    const [created] = await db.execute<{ id: string }>(sql`
      insert into public.work_item (
        parent_work_item_id, title, description, item_type,
        created_by_employee_id, due_at
      ) values (
        ${itemId}::uuid, ${action.title}, '', 'task', ${actor(ctx)}::uuid,
        ${action.dueInDays === undefined ? null : relativeDate(action.dueInDays)}::timestamptz
      ) returning work_item_id as id
    `);
    await db.execute(sql`
      insert into public.work_project_item (
        work_project_id, work_item_id, work_section_id, position
      ) select ${projectId}::uuid, ${created!.id}::uuid,
        membership.work_section_id,
        (select coalesce(max(position), -1) + 1 from public.work_project_item
         where work_project_id = ${projectId}::uuid)
      from public.work_project_item membership
      where membership.work_project_id = ${projectId}::uuid
        and membership.work_item_id = ${itemId}::uuid
    `);
  }
  if (action.type === "complete") {
    const enabled = await featureEnabled("work.recurring_tasks", {
      userId: ctx.employeeId,
      roles: ctx.roles,
    });
    if (enabled) await generateNextOccurrence(ctx, itemId);
  }
  await notifyItem(
    ctx,
    itemId,
    action.type === "assign"
      ? "assigned"
      : action.type === "complete"
        ? "completed"
        : "updated",
    `Rule action: ${action.type.replaceAll("_", " ")}`,
  );
}

async function validateRuleActions(
  projectId: string,
  actions: readonly WorkRuleAction[],
) {
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    for (const action of actions) {
      if (
        action.type === "move_section" &&
        store.sections.get(action.sectionId)?.projectId !== projectId
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Section not found",
        });
      if (action.type === "add_tag" && !store.tags.has(action.tagId))
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tag not found" });
      if (
        action.type === "assign" &&
        action.employeeId &&
        action.employeeId !== "c0000000-0000-4000-8000-000000000001"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Employee not found",
        });
    }
    return;
  }
  for (const action of actions) {
    if (action.type === "move_section") {
      const rows = await db.execute(sql`
        select 1 from public.work_section
        where work_section_id = ${action.sectionId}::uuid
          and work_project_id = ${projectId}::uuid
      `);
      if (!rows[0])
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Section not found",
        });
    } else if (action.type === "add_tag") {
      const rows = await db.execute(
        sql`select 1 from public.work_tag where work_tag_id = ${action.tagId}::uuid`,
      );
      if (!rows[0])
        throw new TRPCError({ code: "BAD_REQUEST", message: "Tag not found" });
    } else if (action.type === "assign" && action.employeeId) {
      const rows = await db.execute(sql`
        select 1 from public.employee
        where employee_id = ${action.employeeId}::uuid and is_active = true
      `);
      if (!rows[0])
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Employee not found",
        });
    }
  }
}

async function recordRuleRun(
  rule: WorkRule,
  itemId: string,
  status: WorkRuleRun["status"],
  output: Record<string, unknown>,
  errorMessage: string | null,
) {
  const run: WorkRuleRun = {
    ruleRunId: randomUUID(),
    ruleId: rule.ruleId,
    itemId,
    triggerType: rule.triggerType,
    status,
    output,
    errorMessage,
    createdAt: new Date().toISOString(),
  };
  const db = getDb();
  if (!db) getDemoWork().ruleRuns.set(run.ruleRunId, run);
  else
    await db.execute(sql`
      insert into public.work_rule_run (
        work_rule_run_id, work_rule_id, work_item_id, trigger_type,
        status, output, error_message
      ) values (
        ${run.ruleRunId}::uuid, ${rule.ruleId}::uuid, ${itemId}::uuid,
        ${rule.triggerType}, ${status}, ${JSON.stringify(output)}::jsonb,
        ${errorMessage}
      )
    `);
}

async function runProjectRules(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
  triggerType: WorkRule["triggerType"],
) {
  await queueWorkAiStudioEvent(ctx, projectId, itemId, triggerType);
  if (
    !(await featureEnabled("work.rules", {
      userId: ctx.employeeId,
      roles: ctx.roles,
    }))
  ) {
    return;
  }
  const db = getDb();
  const rules = !db
    ? [...getDemoWork().rules.values()].filter(
        (rule) =>
          rule.projectId === projectId &&
          rule.triggerType === triggerType &&
          rule.isEnabled,
      )
    : await db.execute<WorkRule & { branches: unknown }>(sql`
        select work_rule_id as "ruleId", work_project_id as "projectId",
          name, trigger_type as "triggerType", branches,
          is_enabled as "isEnabled"
        from public.work_rule
        where work_project_id = ${projectId}::uuid
          and trigger_type = ${triggerType} and is_enabled = true
        order by created_at
      `);
  const item = await ruleSnapshot(itemId, projectId);
  const snapshot = {
    title: item.title,
    priority: item.priority,
    completed: Boolean(item.completedAt),
    sectionId: item.sectionId,
    itemType: item.itemType,
  };
  for (const candidate of rules) {
    const parsed = z.array(ruleBranchSchema).safeParse(candidate.branches);
    const rule = { ...candidate, branches: parsed.success ? parsed.data : [] };
    const branch = rule.branches.find((value) =>
      ruleBranchMatches(value, snapshot),
    );
    if (!branch) {
      await recordRuleRun(rule, itemId, "skipped", {}, null);
      continue;
    }
    try {
      for (const action of branch.actions)
        await executeRuleAction(ctx, projectId, itemId, action);
      await recordRuleRun(
        rule,
        itemId,
        "succeeded",
        { actions: branch.actions.length },
        null,
      );
    } catch (error) {
      await recordRuleRun(
        rule,
        itemId,
        "failed",
        {},
        error instanceof Error ? error.message : "Rule failed",
      );
    }
  }
}

async function captureBundleBlueprint(
  projectId: string,
): Promise<z.infer<typeof bundleBlueprintSchema>> {
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    return {
      sections: [...store.sections.values()]
        .filter((section) => section.projectId === projectId)
        .sort((a, b) => a.position - b.position)
        .map(({ name }) => ({ name })),
      sectionRefs: Object.fromEntries(
        [...store.sections.values()]
          .filter((section) => section.projectId === projectId)
          .map((section) => [section.sectionId, section.name]),
      ),
      customFields: [...store.customFields.values()]
        .filter((field) => field.projectId === projectId)
        .sort((a, b) => a.position - b.position)
        .map(({ name, fieldType, options, isRequired }) => ({
          name,
          fieldType,
          options,
          isRequired,
        })),
      rules: [...store.rules.values()]
        .filter((rule) => rule.projectId === projectId)
        .map(({ name, triggerType, branches }) => ({
          name,
          triggerType,
          branches,
        })),
      taskTemplates: [...store.templates.values()]
        .filter(
          (template) =>
            template.projectId === projectId &&
            template.templateType === "task",
        )
        .flatMap((template) => {
          const parsed = taskTemplateBlueprintSchema.safeParse(
            template.blueprint,
          );
          return parsed.success
            ? [{ name: template.name, blueprint: parsed.data }]
            : [];
        }),
    };
  }
  const [sections, customFields, rules, templates] = await Promise.all([
    db.execute<{ name: string }>(sql`
      select name from public.work_section
      where work_project_id = ${projectId}::uuid order by position
    `),
    db.execute<{
      name: string;
      fieldType: WorkCustomFieldType;
      options: unknown;
      isRequired: boolean;
    }>(sql`
      select name, field_type as "fieldType", options,
        is_required as "isRequired"
      from public.work_custom_field
      where work_project_id = ${projectId}::uuid order by position
    `),
    db.execute<{
      name: string;
      triggerType: WorkRule["triggerType"];
      branches: unknown;
    }>(sql`
      select name, trigger_type as "triggerType", branches
      from public.work_rule
      where work_project_id = ${projectId}::uuid order by created_at
    `),
    db.execute<{ name: string; blueprint: unknown }>(sql`
      select name, blueprint from public.work_template
      where work_project_id = ${projectId}::uuid
        and template_type = 'task' and archived_at is null
      order by created_at
    `),
  ]);
  return {
    sections,
    sectionRefs: Object.fromEntries(
      (
        await db.execute<{ sectionId: string; name: string }>(sql`
          select work_section_id as "sectionId", name
          from public.work_section where work_project_id = ${projectId}::uuid
        `)
      ).map((section) => [section.sectionId, section.name]),
    ),
    customFields: customFields.map((field) => ({
      ...field,
      options: Array.isArray(field.options)
        ? field.options.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    })),
    rules: rules.flatMap((rule) => {
      const branches = z.array(ruleBranchSchema).safeParse(rule.branches);
      return branches.success ? [{ ...rule, branches: branches.data }] : [];
    }),
    taskTemplates: templates.flatMap((template) => {
      const blueprint = taskTemplateBlueprintSchema.safeParse(
        template.blueprint,
      );
      return blueprint.success
        ? [{ name: template.name, blueprint: blueprint.data }]
        : [];
    }),
  };
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
            when team_access.access_level is not null then team_access.access_level
            else 'viewer'
          end as "accessLevel",
          project.created_at as "createdAt"
        from public.work_project project
        left join public.work_project_member member
          on member.work_project_id = project.work_project_id
          and member.employee_id = ${employeeId}::uuid
        left join lateral (
          select team_project.access_level
          from public.work_team_project team_project
          join public.work_team_member team_member
            on team_member.work_team_id = team_project.work_team_id
          where team_project.work_project_id = project.work_project_id
            and team_member.employee_id = ${employeeId}::uuid
          order by case team_project.access_level
            when 'editor' then 3 when 'commenter' then 2 else 1 end desc
          limit 1
        ) team_access on true
        where project.archived_at is null
          and (
            project.privacy = 'organization'
            or project.created_by_employee_id = ${employeeId}::uuid
            or project.owner_employee_id = ${employeeId}::uuid
            or member.employee_id is not null
            or team_access.access_level is not null
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
        const [showSections, showTasks, showDependencies, showTime] =
          await Promise.all([
            featureEnabled("work.sections", subject),
            featureEnabled("work.tasks", subject),
            featureEnabled("work.dependencies", subject),
            featureEnabled("work.time_tracking", subject),
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
                  .map((item) => ({
                    ...item,
                    estimatedMinutes: showTime ? item.estimatedMinutes : null,
                  }))
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
                item.recurrence, item.estimated_minutes as "estimatedMinutes",
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
            estimatedMinutes: showTime ? item.estimatedMinutes : null,
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
          privacy: z.enum(["organization", "private"]).optional(),
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
        const privacy =
          input.privacy ??
          (await getWorkOrganizationPolicy()).defaultProjectPrivacy;
        let project: WorkProject;
        if (!db) {
          project = {
            projectId: randomUUID(),
            name: input.name,
            description: input.description,
            color: input.color,
            privacy,
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
                ${input.name}, ${input.description}, ${input.color}, ${privacy},
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
    update: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          sectionId: uuid,
          name: z.string().trim().min(1).max(120),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        let section: WorkSection | undefined;
        if (!db) {
          const stored = getDemoWork().sections.get(input.sectionId);
          if (stored?.projectId === input.projectId) {
            stored.name = input.name;
            section = stored;
          }
        } else {
          const [updated] = await db.execute<WorkSection>(sql`
            update public.work_section set name = ${input.name}, updated_at = now()
            where work_section_id = ${input.sectionId}::uuid
              and work_project_id = ${input.projectId}::uuid
            returning work_section_id as "sectionId", work_project_id as "projectId",
              name, position
          `);
          section = updated;
        }
        if (!section) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "work.section.update",
          "work_section",
          input.sectionId,
          {
            projectId: input.projectId,
            name: input.name,
          },
        );
        return section;
      }),
  }),

  tasks: router({
    get: staffProcedure
      .input(z.object({ itemId: uuid }))
      .query(async ({ input, ctx }) => {
        const access = await requireItemAccess(ctx, input.itemId);
        const showTime = await featureEnabled("work.time_tracking", {
          userId: ctx.employeeId,
          clientId: ctx.clientId,
          roles: ctx.roles,
        });
        const db = getDb();
        if (!db) {
          const item = getDemoWork().items.get(input.itemId)!;
          await requireWorkTypeFeature(ctx, item.itemType);
          return {
            ...item,
            estimatedMinutes: showTime ? item.estimatedMinutes : null,
          };
        }
        const rows = await db.execute<
          WorkItem & {
            dueAt: Date | string | null;
            completedAt: Date | string | null;
          }
        >(sql`
          select item.work_item_id as "itemId",
            item.parent_work_item_id as "parentItemId", item.title,
            item.description, item.item_type as "itemType", item.priority,
            item.recurrence, item.estimated_minutes as "estimatedMinutes",
            item.assignee_employee_id as "assigneeEmployeeId",
            assignee.display_name as "assigneeName", item.start_date as "startDate",
            item.due_at as "dueAt", item.completed_at as "completedAt",
            membership.work_section_id as "sectionId", membership.position,
            membership.work_project_id as "projectId"
          from public.work_item item
          join public.work_project_item membership
            on membership.work_item_id = item.work_item_id
            and membership.work_project_id = ${access.projectId}::uuid
          left join public.employee assignee
            on assignee.employee_id = item.assignee_employee_id
          where item.work_item_id = ${input.itemId}::uuid
            and item.archived_at is null limit 1
        `);
        const item = rows[0];
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        await requireWorkTypeFeature(ctx, item.itemType);
        return {
          ...item,
          estimatedMinutes: showTime ? item.estimatedMinutes : null,
          startDate: item.startDate ? String(item.startDate) : null,
          dueAt: iso(item.dueAt),
          completedAt: iso(item.completedAt),
        };
      }),

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
          estimatedMinutes: z
            .number()
            .int()
            .min(1)
            .max(1_000_000)
            .nullable()
            .optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireWorkTypeFeature(ctx, input.itemType);
        if (input.estimatedMinutes !== undefined)
          await requireWorkFeature(ctx, "work.time_tracking");
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
            estimatedMinutes: input.estimatedMinutes ?? null,
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
                , estimated_minutes
              ) values (
                ${input.parentItemId ?? null}::uuid, ${input.title}, ${input.description},
                ${input.itemType}, ${input.priority ?? null},
                ${input.assigneeEmployeeId ?? null}::uuid, ${employeeId}::uuid,
                ${input.startDate ?? null}::date, ${input.dueAt ?? null}::timestamptz
                , ${input.estimatedMinutes ?? null}
              )
              returning work_item_id as "itemId", parent_work_item_id as "parentItemId",
                title, description, item_type as "itemType", priority,
                recurrence, estimated_minutes as "estimatedMinutes",
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
          await queueAssignedWorkAiTeammate(
            ctx,
            item.itemId,
            item.assigneeEmployeeId,
          );
        }
        await runProjectRules(ctx, input.projectId, item.itemId, "task_added");
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
          estimatedMinutes: z
            .number()
            .int()
            .min(1)
            .max(1_000_000)
            .nullable()
            .optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const access = await requireItemAccess(ctx, input.itemId, "editor");
        if (input.estimatedMinutes !== undefined)
          await requireWorkFeature(ctx, "work.time_tracking");
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
            ...(input.estimatedMinutes !== undefined
              ? { estimatedMinutes: input.estimatedMinutes }
              : {}),
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
          if (input.priority !== undefined)
            await runProjectRules(
              ctx,
              access.projectId,
              input.itemId,
              "priority_changed",
            );
          if (input.dueAt)
            await runProjectRules(
              ctx,
              access.projectId,
              input.itemId,
              "due_date_set",
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
            estimated_minutes = case when ${input.estimatedMinutes !== undefined} then ${input.estimatedMinutes ?? null} else estimated_minutes end,
            updated_at = now()
          where work_item_id = ${input.itemId}::uuid and archived_at is null
          returning work_item_id as "itemId", parent_work_item_id as "parentItemId",
            title, description, item_type as "itemType", priority,
            recurrence, estimated_minutes as "estimatedMinutes",
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
        if (input.assigneeEmployeeId !== undefined)
          await queueAssignedWorkAiTeammate(
            ctx,
            input.itemId,
            input.assigneeEmployeeId,
          );
        if (input.priority !== undefined)
          await runProjectRules(
            ctx,
            access.projectId,
            input.itemId,
            "priority_changed",
          );
        if (input.dueAt)
          await runProjectRules(
            ctx,
            access.projectId,
            input.itemId,
            "due_date_set",
          );
        return rows[0];
      }),

    archive: staffProcedure
      .input(z.object({ itemId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db) getDemoWork().items.delete(input.itemId);
        else
          await db.execute(sql`
            update public.work_item set archived_at = now(), updated_at = now()
            where work_item_id = ${input.itemId}::uuid and archived_at is null
          `);
        await audit(ctx, "work.task.archive", "work_item", input.itemId, {
          archived: true,
        });
        return { ok: true as const };
      }),

    complete: staffProcedure
      .input(z.object({ itemId: uuid, completed: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const access = await requireItemAccess(ctx, input.itemId, "editor");
        const current = await ruleSnapshot(input.itemId);
        if (
          input.completed &&
          current.itemType === "approval" &&
          (await featureEnabled("work.approvals", {
            userId: ctx.employeeId,
            roles: ctx.roles,
          }))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Choose Approve, Request changes, or Reject",
          });
        }
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
        if (input.completed)
          await runProjectRules(
            ctx,
            access.projectId,
            input.itemId,
            "task_completed",
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
        await runProjectRules(ctx, input.projectId, input.itemId, "task_moved");
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
        await runProjectRules(ctx, input.projectId, input.itemId, "task_added");
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
          comment.author_employee_id as "authorEmployeeId",
          comment.author_portal_user_id as "authorPortalUserId",
          coalesce(author.display_name, portal_author.display_name, 'Unknown') as "authorName",
          comment.body, comment.created_at as "createdAt"
        from public.work_comment comment
        left join public.employee author on author.employee_id = comment.author_employee_id
        left join public.client_portal_user portal_author
          on portal_author.client_portal_user_id = comment.author_portal_user_id
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
        await queueMentionedWorkAiTeammates(ctx, input.itemId, input.body);
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

  forms: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().forms.values()].filter(
            (form) => form.projectId === input.projectId,
          );
        const rows = await db.execute<WorkForm & { questions: unknown }>(sql`
          select work_form_id as "formId", work_project_id as "projectId",
            work_section_id as "sectionId", name, description,
            title_question_key as "titleQuestionKey", questions,
            default_assignee_employee_id as "defaultAssigneeEmployeeId",
            confirmation_message as "confirmationMessage", is_active as "isActive"
          from public.work_form
          where work_project_id = ${input.projectId}::uuid
          order by lower(name)
        `);
        return rows.map((form) => {
          const questions = z
            .array(formQuestionSchema)
            .safeParse(form.questions);
          return {
            ...form,
            questions: questions.success ? questions.data : [],
          };
        });
      }),
    create: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          sectionId: nullableUuid.optional(),
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(5000).default(""),
          titleQuestionKey: z
            .string()
            .regex(/^[a-z][a-z0-9_]{0,63}$/)
            .default("title"),
          questions: z.array(formQuestionSchema).min(1).max(100),
          defaultAssigneeEmployeeId: nullableUuid.optional(),
          confirmationMessage: z
            .string()
            .trim()
            .min(1)
            .max(1000)
            .default("Your request was submitted."),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const keys = new Set(input.questions.map((question) => question.key));
        if (keys.size !== input.questions.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Question keys must be unique",
          });
        const titleQuestion = input.questions.find(
          (question) => question.key === input.titleQuestionKey,
        );
        if (
          !titleQuestion ||
          !["text", "textarea"].includes(titleQuestion.type)
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "The task title must map to a text question",
          });
        for (const question of input.questions) {
          if (
            ["single_select", "multi_select"].includes(question.type) &&
            !question.options.length
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${question.label} needs at least one option`,
            });
          if (question.showWhen && !keys.has(question.showWhen.key))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${question.label} has an unknown branch question`,
            });
        }
        const form: WorkForm = {
          formId: randomUUID(),
          projectId: input.projectId,
          sectionId: input.sectionId ?? null,
          name: input.name,
          description: input.description,
          titleQuestionKey: input.titleQuestionKey,
          questions: input.questions,
          defaultAssigneeEmployeeId: input.defaultAssigneeEmployeeId ?? null,
          confirmationMessage: input.confirmationMessage,
          isActive: true,
        };
        const db = getDb();
        if (!db) {
          if (
            form.defaultAssigneeEmployeeId &&
            form.defaultAssigneeEmployeeId !==
              "c0000000-0000-4000-8000-000000000001"
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Employee not found",
            });
          getDemoWork().forms.set(form.formId, form);
        } else {
          if (form.sectionId) {
            const section = await db.execute(sql`
              select 1 from public.work_section
              where work_section_id = ${form.sectionId}::uuid
                and work_project_id = ${form.projectId}::uuid
            `);
            if (!section[0])
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Section not found",
              });
          }
          if (form.defaultAssigneeEmployeeId) {
            const employee = await db.execute(sql`
              select 1 from public.employee
              where employee_id = ${form.defaultAssigneeEmployeeId}::uuid
                and is_active = true
            `);
            if (!employee[0])
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Employee not found",
              });
          }
          await db.execute(sql`
            insert into public.work_form (
              work_form_id, work_project_id, work_section_id, name, description,
              title_question_key, questions, default_assignee_employee_id,
              confirmation_message, created_by_employee_id
            ) values (
              ${form.formId}::uuid, ${form.projectId}::uuid, ${form.sectionId}::uuid,
              ${form.name}, ${form.description}, ${form.titleQuestionKey},
              ${JSON.stringify(form.questions)}::jsonb,
              ${form.defaultAssigneeEmployeeId}::uuid, ${form.confirmationMessage},
              ${actor(ctx)}::uuid
            )
          `);
        }
        await audit(ctx, "work.form.create", "work_form", form.formId, {
          projectId: form.projectId,
          questions: form.questions.length,
        });
        return form;
      }),
    setActive: staffProcedure
      .input(z.object({ formId: uuid, active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const form = !db
          ? getDemoWork().forms.get(input.formId)
          : (
              await db.execute<{ projectId: string }>(sql`
                select work_project_id as "projectId" from public.work_form
                where work_form_id = ${input.formId}::uuid
              `)
            )[0];
        if (!form) throw new TRPCError({ code: "NOT_FOUND" });
        await requireProjectAccess(ctx, form.projectId, "editor");
        if (!db) getDemoWork().forms.get(input.formId)!.isActive = input.active;
        else
          await db.execute(sql`
            update public.work_form set is_active = ${input.active}, updated_at = now()
            where work_form_id = ${input.formId}::uuid
          `);
        await audit(ctx, "work.form.active", "work_form", input.formId, {
          active: input.active,
        });
        return { ok: true as const };
      }),
    submit: staffProcedure
      .input(
        z.object({
          formId: uuid,
          answers: z.record(z.string().max(64), z.unknown()),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const raw = !db
          ? getDemoWork().forms.get(input.formId)
          : (
              await db.execute<WorkForm & { questions: unknown }>(sql`
                select work_form_id as "formId", work_project_id as "projectId",
                  work_section_id as "sectionId", name, description,
                  title_question_key as "titleQuestionKey", questions,
                  default_assignee_employee_id as "defaultAssigneeEmployeeId",
                  confirmation_message as "confirmationMessage", is_active as "isActive"
                from public.work_form where work_form_id = ${input.formId}::uuid
              `)
            )[0];
        if (!raw) throw new TRPCError({ code: "NOT_FOUND" });
        await requireProjectAccess(ctx, raw.projectId);
        const parsed = z.array(formQuestionSchema).safeParse(raw.questions);
        if (!raw.isActive || !parsed.success)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Form is unavailable",
          });
        let answers: Record<string, unknown>;
        try {
          answers = normalizeFormAnswers(parsed.data, input.answers);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              error instanceof Error ? error.message : "Answers are invalid",
          });
        }
        const title = answers[raw.titleQuestionKey];
        if (typeof title !== "string" || !title.trim())
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Task title is required",
          });
        const description = parsed.data
          .flatMap((question) =>
            answers[question.key] === undefined
              ? []
              : [
                  `${question.label}: ${Array.isArray(answers[question.key]) ? (answers[question.key] as unknown[]).join(", ") : String(answers[question.key])}`,
                ],
          )
          .join("\n");
        const itemId = randomUUID();
        const submissionId = randomUUID();
        if (!db) {
          getDemoWork().items.set(itemId, {
            itemId,
            parentItemId: null,
            title: title.trim(),
            description,
            itemType: "task",
            priority: null,
            assigneeEmployeeId: raw.defaultAssigneeEmployeeId,
            assigneeName: raw.defaultAssigneeEmployeeId
              ? "Assigned user"
              : null,
            startDate: null,
            dueAt: null,
            completedAt: null,
            sectionId: raw.sectionId,
            position: [...getDemoWork().items.values()].filter(
              (item) => item.projectId === raw.projectId,
            ).length,
            projectId: raw.projectId,
            recurrence: null,
          });
          getDemoWork().formSubmissions.set(submissionId, {
            formId: raw.formId,
            itemId,
            answers,
          });
        } else {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_item (
                work_item_id, title, description, item_type,
                assignee_employee_id, created_by_employee_id
              ) values (
                ${itemId}::uuid, ${title.trim()}, ${description}, 'task',
                ${raw.defaultAssigneeEmployeeId}::uuid, ${actor(ctx)}::uuid
              )
            `);
            await tx.execute(sql`
              insert into public.work_project_item (
                work_project_id, work_item_id, work_section_id, position
              ) values (
                ${raw.projectId}::uuid, ${itemId}::uuid, ${raw.sectionId}::uuid,
                (select coalesce(max(position), -1) + 1 from public.work_project_item
                 where work_project_id = ${raw.projectId}::uuid)
              )
            `);
            await tx.execute(sql`
              insert into public.work_form_submission (
                work_form_submission_id, work_form_id, submitted_by_employee_id,
                answers, work_item_id
              ) values (
                ${submissionId}::uuid, ${raw.formId}::uuid, ${actor(ctx)}::uuid,
                ${JSON.stringify(answers)}::jsonb, ${itemId}::uuid
              )
            `);
          });
        }
        await audit(
          ctx,
          "work.form.submit",
          "work_form_submission",
          submissionId,
          {
            formId: raw.formId,
            itemId,
          },
        );
        if (raw.defaultAssigneeEmployeeId)
          await notifyItem(
            ctx,
            itemId,
            "assigned",
            `Assigned: ${title.trim()}`,
          );
        await runProjectRules(ctx, raw.projectId, itemId, "task_added");
        return { submissionId, itemId, message: raw.confirmationMessage };
      }),
  }),

  rules: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().rules.values()].filter(
            (rule) => rule.projectId === input.projectId,
          );
        const rows = await db.execute<WorkRule & { branches: unknown }>(sql`
          select work_rule_id as "ruleId", work_project_id as "projectId",
            name, trigger_type as "triggerType", branches,
            is_enabled as "isEnabled"
          from public.work_rule
          where work_project_id = ${input.projectId}::uuid
          order by lower(name)
        `);
        return rows.map((rule) => {
          const branches = z.array(ruleBranchSchema).safeParse(rule.branches);
          return { ...rule, branches: branches.success ? branches.data : [] };
        });
      }),
    create: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(160),
          triggerType: z.enum([
            "task_added",
            "task_completed",
            "task_moved",
            "priority_changed",
            "due_date_set",
            "approval_decided",
          ]),
          branches: z.array(ruleBranchSchema).min(1).max(20),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        for (const branch of input.branches) {
          await validateRuleActions(input.projectId, branch.actions);
          const sectionConditions = branch.conditions.flatMap((condition) =>
            condition.field === "sectionId" &&
            typeof condition.value === "string"
              ? [condition.value]
              : [],
          );
          for (const sectionId of sectionConditions) {
            if (!uuid.safeParse(sectionId).success)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Section condition is invalid",
              });
            await validateRuleActions(input.projectId, [
              { type: "move_section", sectionId },
            ]);
          }
        }
        const rule: WorkRule = {
          ruleId: randomUUID(),
          projectId: input.projectId,
          name: input.name,
          triggerType: input.triggerType,
          branches: input.branches,
          isEnabled: true,
        };
        const db = getDb();
        if (!db) getDemoWork().rules.set(rule.ruleId, rule);
        else
          await db.execute(sql`
            insert into public.work_rule (
              work_rule_id, work_project_id, name, trigger_type, branches,
              owner_employee_id
            ) values (
              ${rule.ruleId}::uuid, ${rule.projectId}::uuid, ${rule.name},
              ${rule.triggerType}, ${JSON.stringify(rule.branches)}::jsonb,
              ${actor(ctx)}::uuid
            )
          `);
        await audit(ctx, "work.rule.create", "work_rule", rule.ruleId, {
          projectId: rule.projectId,
          triggerType: rule.triggerType,
          branches: rule.branches.length,
        });
        return rule;
      }),
    setEnabled: staffProcedure
      .input(z.object({ ruleId: uuid, enabled: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const rule = !db
          ? getDemoWork().rules.get(input.ruleId)
          : (
              await db.execute<{ projectId: string }>(sql`
                select work_project_id as "projectId" from public.work_rule
                where work_rule_id = ${input.ruleId}::uuid
              `)
            )[0];
        if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
        await requireProjectAccess(ctx, rule.projectId, "editor");
        if (!db)
          getDemoWork().rules.get(input.ruleId)!.isEnabled = input.enabled;
        else
          await db.execute(sql`
            update public.work_rule set is_enabled = ${input.enabled}, updated_at = now()
            where work_rule_id = ${input.ruleId}::uuid
          `);
        await audit(ctx, "work.rule.enabled", "work_rule", input.ruleId, {
          enabled: input.enabled,
        });
        return { ok: true as const };
      }),
    runs: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          limit: z.number().int().min(1).max(200).default(50),
        }),
      )
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) {
          const ruleIds = new Set(
            [...getDemoWork().rules.values()]
              .filter((rule) => rule.projectId === input.projectId)
              .map((rule) => rule.ruleId),
          );
          return [...getDemoWork().ruleRuns.values()]
            .filter((run) => ruleIds.has(run.ruleId))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, input.limit);
        }
        const rows = await db.execute<
          WorkRuleRun & { createdAt: Date | string }
        >(sql`
          select run.work_rule_run_id as "ruleRunId",
            run.work_rule_id as "ruleId", run.work_item_id as "itemId",
            run.trigger_type as "triggerType", run.status, run.output,
            run.error_message as "errorMessage", run.created_at as "createdAt"
          from public.work_rule_run run
          join public.work_rule rule on rule.work_rule_id = run.work_rule_id
          where rule.work_project_id = ${input.projectId}::uuid
          order by run.created_at desc limit ${input.limit}
        `);
        return rows.map((run) => ({
          ...run,
          createdAt: new Date(run.createdAt).toISOString(),
        }));
      }),
  }),

  templates: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid.optional() }).optional())
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        if (input?.projectId) await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().templates.values()].filter(
            (template) =>
              (template.templateType === "project" &&
                template.createdByEmployeeId === employeeId) ||
              template.projectId === input?.projectId,
          );
        return db.execute<WorkTemplate>(sql`
          select work_template_id as "templateId",
            work_project_id as "projectId", name,
            template_type as "templateType", blueprint,
            created_by_employee_id as "createdByEmployeeId"
          from public.work_template
          where archived_at is null
            and ((template_type = 'project'
                and created_by_employee_id = ${employeeId}::uuid)
              or work_project_id = ${input?.projectId ?? null}::uuid)
          order by template_type, lower(name)
        `);
      }),
    createTask: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(160),
          blueprint: taskTemplateBlueprintSchema,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireWorkTypeFeature(ctx, input.blueprint.itemType);
        if (input.blueprint.assigneeEmployeeId)
          await validateRuleActions(input.projectId, [
            { type: "assign", employeeId: input.blueprint.assigneeEmployeeId },
          ]);
        const template: WorkTemplate = {
          templateId: randomUUID(),
          projectId: input.projectId,
          name: input.name,
          templateType: "task",
          blueprint: input.blueprint,
          createdByEmployeeId: actor(ctx),
        };
        const db = getDb();
        if (!db) getDemoWork().templates.set(template.templateId, template);
        else
          await db.execute(sql`
            insert into public.work_template (
              work_template_id, work_project_id, name, template_type,
              blueprint, created_by_employee_id
            ) values (
              ${template.templateId}::uuid, ${template.projectId}::uuid,
              ${template.name}, 'task', ${JSON.stringify(template.blueprint)}::jsonb,
              ${actor(ctx)}::uuid
            )
          `);
        await audit(
          ctx,
          "work.template.create",
          "work_template",
          template.templateId,
          {
            projectId: template.projectId,
            templateType: "task",
          },
        );
        return template;
      }),
    captureProject: staffProcedure
      .input(
        z.object({ projectId: uuid, name: z.string().trim().min(1).max(160) }),
      )
      .mutation(async ({ input, ctx }) => {
        const project = await requireProjectAccess(
          ctx,
          input.projectId,
          "editor",
        );
        const db = getDb();
        let blueprint: z.infer<typeof projectTemplateBlueprintSchema>;
        if (!db) {
          const store = getDemoWork();
          const sections = [...store.sections.values()]
            .filter((section) => section.projectId === input.projectId)
            .sort((a, b) => a.position - b.position);
          const sectionNames = new Map(
            sections.map((section) => [section.sectionId, section.name]),
          );
          blueprint = {
            description: project.description,
            color: project.color,
            privacy: project.privacy,
            sections: sections.map(({ name, position }) => ({
              name,
              position,
            })),
            tasks: [...store.items.values()]
              .filter(
                (item) =>
                  item.projectId === input.projectId && !item.parentItemId,
              )
              .map((item) => ({
                title: item.title,
                description: item.description,
                itemType: item.itemType,
                priority: item.priority,
                sectionName: item.sectionId
                  ? (sectionNames.get(item.sectionId) ?? null)
                  : null,
                dueOffsetDays: item.dueAt
                  ? Math.round(
                      (new Date(item.dueAt).getTime() - Date.now()) /
                        86_400_000,
                    )
                  : null,
              })),
          };
        } else {
          const sections = await db.execute<WorkSection>(sql`
            select work_section_id as "sectionId", work_project_id as "projectId",
              name, position from public.work_section
            where work_project_id = ${input.projectId}::uuid order by position
          `);
          const tasks = await db.execute<{
            title: string;
            description: string;
            itemType: WorkItem["itemType"];
            priority: WorkItem["priority"];
            sectionName: string | null;
            dueAt: Date | string | null;
          }>(sql`
            select item.title, item.description, item.item_type as "itemType",
              item.priority, section.name as "sectionName", item.due_at as "dueAt"
            from public.work_project_item membership
            join public.work_item item on item.work_item_id = membership.work_item_id
            left join public.work_section section
              on section.work_section_id = membership.work_section_id
            where membership.work_project_id = ${input.projectId}::uuid
              and item.parent_work_item_id is null and item.archived_at is null
            order by membership.position, item.created_at
          `);
          blueprint = {
            description: project.description,
            color: project.color,
            privacy: project.privacy,
            sections: sections.map(({ name, position }) => ({
              name,
              position,
            })),
            tasks: tasks.map((task) => ({
              title: task.title,
              description: task.description,
              itemType: task.itemType,
              priority: task.priority,
              sectionName: task.sectionName,
              dueOffsetDays: task.dueAt
                ? Math.round(
                    (new Date(task.dueAt).getTime() - Date.now()) / 86_400_000,
                  )
                : null,
            })),
          };
        }
        const template: WorkTemplate = {
          templateId: randomUUID(),
          projectId: null,
          name: input.name,
          templateType: "project",
          blueprint,
          createdByEmployeeId: actor(ctx),
        };
        if (!db) getDemoWork().templates.set(template.templateId, template);
        else
          await db.execute(sql`
            insert into public.work_template (
              work_template_id, name, template_type, blueprint,
              created_by_employee_id
            ) values (
              ${template.templateId}::uuid, ${template.name}, 'project',
              ${JSON.stringify(blueprint)}::jsonb, ${actor(ctx)}::uuid
            )
          `);
        await audit(
          ctx,
          "work.template.capture",
          "work_template",
          template.templateId,
          {
            sourceProjectId: input.projectId,
            tasks: blueprint.tasks.length,
          },
        );
        return template;
      }),
    instantiateTask: staffProcedure
      .input(
        z.object({
          templateId: uuid,
          projectId: uuid,
          sectionId: nullableUuid.optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        const template = !db
          ? getDemoWork().templates.get(input.templateId)
          : (
              await db.execute<WorkTemplate>(sql`
                select work_template_id as "templateId",
                  work_project_id as "projectId", name,
                  template_type as "templateType", blueprint,
                  created_by_employee_id as "createdByEmployeeId"
                from public.work_template
                where work_template_id = ${input.templateId}::uuid
                  and archived_at is null
              `)
            )[0];
        if (!template || template.templateType !== "task")
          throw new TRPCError({ code: "NOT_FOUND" });
        if (template.projectId !== input.projectId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Template belongs to another project",
          });
        const parsed = taskTemplateBlueprintSchema.safeParse(
          template.blueprint,
        );
        if (!parsed.success)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Template is invalid",
          });
        await requireWorkTypeFeature(ctx, parsed.data.itemType);
        const itemId = randomUUID();
        const dueAt =
          parsed.data.dueInDays === undefined
            ? null
            : relativeDate(parsed.data.dueInDays);
        if (!db) {
          const store = getDemoWork();
          const parent: WorkItem = {
            itemId,
            parentItemId: null,
            title: parsed.data.title,
            description: parsed.data.description,
            itemType: parsed.data.itemType,
            priority: parsed.data.priority,
            assigneeEmployeeId: parsed.data.assigneeEmployeeId ?? null,
            assigneeName: parsed.data.assigneeEmployeeId
              ? "Assigned user"
              : null,
            startDate: null,
            dueAt,
            completedAt: null,
            sectionId: input.sectionId ?? null,
            position: [...store.items.values()].filter(
              (item) => item.projectId === input.projectId,
            ).length,
            projectId: input.projectId,
            recurrence: null,
          };
          store.items.set(itemId, parent);
          parsed.data.subtasks.forEach((subtask, index) => {
            const subtaskId = randomUUID();
            store.items.set(subtaskId, {
              ...parent,
              itemId: subtaskId,
              parentItemId: itemId,
              title: subtask.title,
              description: subtask.description,
              dueAt:
                subtask.dueInDays === undefined
                  ? null
                  : relativeDate(subtask.dueInDays),
              position: index,
            });
          });
        } else {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_item (
                work_item_id, title, description, item_type, priority,
                assignee_employee_id, created_by_employee_id, due_at
              ) values (
                ${itemId}::uuid, ${parsed.data.title}, ${parsed.data.description},
                ${parsed.data.itemType}, ${parsed.data.priority},
                ${parsed.data.assigneeEmployeeId ?? null}::uuid,
                ${actor(ctx)}::uuid, ${dueAt}::timestamptz
              )
            `);
            await tx.execute(sql`
              insert into public.work_project_item (
                work_project_id, work_item_id, work_section_id, position
              ) values (
                ${input.projectId}::uuid, ${itemId}::uuid,
                ${input.sectionId ?? null}::uuid,
                (select coalesce(max(position), -1) + 1 from public.work_project_item
                 where work_project_id = ${input.projectId}::uuid)
              )
            `);
            for (const subtask of parsed.data.subtasks) {
              const subtaskId = randomUUID();
              await tx.execute(sql`
                insert into public.work_item (
                  work_item_id, parent_work_item_id, title, description,
                  item_type, created_by_employee_id, due_at
                ) values (
                  ${subtaskId}::uuid, ${itemId}::uuid, ${subtask.title},
                  ${subtask.description}, 'task', ${actor(ctx)}::uuid,
                  ${subtask.dueInDays === undefined ? null : relativeDate(subtask.dueInDays)}::timestamptz
                )
              `);
              await tx.execute(sql`
                insert into public.work_project_item (
                  work_project_id, work_item_id, work_section_id, position
                ) values (
                  ${input.projectId}::uuid, ${subtaskId}::uuid,
                  ${input.sectionId ?? null}::uuid,
                  (select coalesce(max(position), -1) + 1 from public.work_project_item
                   where work_project_id = ${input.projectId}::uuid)
                )
              `);
            }
          });
        }
        await audit(ctx, "work.template.instantiate", "work_item", itemId, {
          templateId: template.templateId,
          projectId: input.projectId,
        });
        await runProjectRules(ctx, input.projectId, itemId, "task_added");
        return { itemId };
      }),
    instantiateProject: staffProcedure
      .input(
        z.object({
          templateId: uuid,
          name: z.string().trim().min(1).max(160),
          referenceDate: z.string().date(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const db = getDb();
        const template = !db
          ? getDemoWork().templates.get(input.templateId)
          : (
              await db.execute<WorkTemplate>(sql`
                select work_template_id as "templateId", null::uuid as "projectId",
                  name, template_type as "templateType", blueprint,
                  created_by_employee_id as "createdByEmployeeId"
                from public.work_template
                where work_template_id = ${input.templateId}::uuid
                  and template_type = 'project' and archived_at is null
                  and created_by_employee_id = ${actor(ctx)}::uuid
              `)
            )[0];
        if (
          !template ||
          template.templateType !== "project" ||
          template.createdByEmployeeId !== actor(ctx)
        )
          throw new TRPCError({ code: "NOT_FOUND" });
        const parsed = projectTemplateBlueprintSchema.safeParse(
          template.blueprint,
        );
        if (!parsed.success)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Template is invalid",
          });
        for (const task of parsed.data.tasks)
          await requireWorkTypeFeature(ctx, task.itemType);
        const projectId = randomUUID();
        const baseDate = new Date(`${input.referenceDate}T12:00:00Z`);
        if (!db) {
          const store = getDemoWork();
          store.projects.set(projectId, {
            projectId,
            name: input.name,
            description: parsed.data.description,
            color: parsed.data.color,
            privacy: parsed.data.privacy,
            clientId: null,
            ownerEmployeeId: actor(ctx),
            sourcePlatform: "native",
            accessLevel: "admin",
            createdAt: new Date().toISOString(),
          });
          const sectionIds = new Map<string, string>();
          for (const section of parsed.data.sections) {
            const sectionId = randomUUID();
            sectionIds.set(section.name, sectionId);
            store.sections.set(sectionId, { sectionId, projectId, ...section });
          }
          parsed.data.tasks.forEach((task, position) => {
            const itemId = randomUUID();
            store.items.set(itemId, {
              itemId,
              parentItemId: null,
              title: task.title,
              description: task.description,
              itemType: task.itemType,
              priority: task.priority,
              assigneeEmployeeId: null,
              assigneeName: null,
              startDate: null,
              dueAt:
                task.dueOffsetDays === null
                  ? null
                  : relativeDate(task.dueOffsetDays, baseDate),
              completedAt: null,
              sectionId: task.sectionName
                ? (sectionIds.get(task.sectionName) ?? null)
                : null,
              position,
              projectId,
              recurrence: null,
            });
          });
        } else {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_project (
                work_project_id, name, description, color, privacy,
                owner_employee_id, created_by_employee_id
              ) values (
                ${projectId}::uuid, ${input.name}, ${parsed.data.description},
                ${parsed.data.color}, ${parsed.data.privacy}, ${actor(ctx)}::uuid,
                ${actor(ctx)}::uuid
              )
            `);
            await tx.execute(sql`
              insert into public.work_project_member (
                work_project_id, employee_id, access_level
              ) values (${projectId}::uuid, ${actor(ctx)}::uuid, 'admin')
            `);
            const sectionIds = new Map<string, string>();
            for (const section of parsed.data.sections) {
              const sectionId = randomUUID();
              sectionIds.set(section.name, sectionId);
              await tx.execute(sql`
                insert into public.work_section (
                  work_section_id, work_project_id, name, position
                ) values (
                  ${sectionId}::uuid, ${projectId}::uuid,
                  ${section.name}, ${section.position}
                )
              `);
            }
            for (const [position, task] of parsed.data.tasks.entries()) {
              const itemId = randomUUID();
              await tx.execute(sql`
                insert into public.work_item (
                  work_item_id, title, description, item_type, priority,
                  created_by_employee_id, due_at
                ) values (
                  ${itemId}::uuid, ${task.title}, ${task.description},
                  ${task.itemType}, ${task.priority}, ${actor(ctx)}::uuid,
                  ${task.dueOffsetDays === null ? null : relativeDate(task.dueOffsetDays, baseDate)}::timestamptz
                )
              `);
              await tx.execute(sql`
                insert into public.work_project_item (
                  work_project_id, work_item_id, work_section_id, position
                ) values (
                  ${projectId}::uuid, ${itemId}::uuid,
                  ${task.sectionName ? (sectionIds.get(task.sectionName) ?? null) : null}::uuid,
                  ${position}
                )
              `);
            }
          });
        }
        await audit(ctx, "work.template.project", "work_project", projectId, {
          templateId: template.templateId,
          tasks: parsed.data.tasks.length,
        });
        return { projectId };
      }),
  }),

  bundles: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db)
        return [...getDemoWork().bundles.values()].filter(
          (bundle) =>
            bundle.visibility === "organization" ||
            bundle.createdByEmployeeId === employeeId,
        );
      const rows = await db.execute<WorkBundle & { blueprint: unknown }>(sql`
        select bundle.work_bundle_id as "bundleId", bundle.name,
          bundle.description, bundle.visibility,
          bundle.created_by_employee_id as "createdByEmployeeId",
          latest.version, latest.blueprint
        from public.work_bundle bundle
        join lateral (
          select version, blueprint from public.work_bundle_version
          where work_bundle_id = bundle.work_bundle_id
          order by version desc limit 1
        ) latest on true
        where bundle.archived_at is null
          and (bundle.visibility = 'organization'
            or bundle.created_by_employee_id = ${employeeId}::uuid)
        order by lower(bundle.name)
      `);
      return rows.flatMap((bundle) => {
        const blueprint = bundleBlueprintSchema.safeParse(bundle.blueprint);
        return blueprint.success
          ? [{ ...bundle, blueprint: blueprint.data }]
          : [];
      });
    }),
    capture: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(5000).default(""),
          visibility: z
            .enum(["organization", "limited"])
            .default("organization"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "admin");
        const blueprint = await captureBundleBlueprint(input.projectId);
        const bundle: WorkBundle = {
          bundleId: randomUUID(),
          name: input.name,
          description: input.description,
          visibility: input.visibility,
          version: 1,
          blueprint,
          createdByEmployeeId: actor(ctx),
        };
        const db = getDb();
        if (!db) getDemoWork().bundles.set(bundle.bundleId, bundle);
        else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_bundle (
                work_bundle_id, name, description, visibility,
                created_by_employee_id
              ) values (
                ${bundle.bundleId}::uuid, ${bundle.name}, ${bundle.description},
                ${bundle.visibility}, ${bundle.createdByEmployeeId}::uuid
              )
            `);
            await tx.execute(sql`
              insert into public.work_bundle_version (
                work_bundle_id, version, blueprint, published_by_employee_id
              ) values (
                ${bundle.bundleId}::uuid, 1,
                ${JSON.stringify(blueprint)}::jsonb, ${actor(ctx)}::uuid
              )
            `);
          });
        await audit(
          ctx,
          "work.bundle.capture",
          "work_bundle",
          bundle.bundleId,
          {
            projectId: input.projectId,
            version: 1,
          },
        );
        return bundle;
      }),
    publish: staffProcedure
      .input(z.object({ bundleId: uuid, sourceProjectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.sourceProjectId, "admin");
        const employeeId = actor(ctx);
        const db = getDb();
        const bundle = !db
          ? getDemoWork().bundles.get(input.bundleId)
          : (
              await db.execute<{
                createdByEmployeeId: string;
                version: number;
              }>(sql`
                select bundle.created_by_employee_id as "createdByEmployeeId",
                  coalesce(max(version.version), 0)::int as version
                from public.work_bundle bundle
                left join public.work_bundle_version version
                  on version.work_bundle_id = bundle.work_bundle_id
                where bundle.work_bundle_id = ${input.bundleId}::uuid
                  and bundle.archived_at is null
                group by bundle.created_by_employee_id
              `)
            )[0];
        if (!bundle) throw new TRPCError({ code: "NOT_FOUND" });
        if (bundle.createdByEmployeeId !== employeeId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the bundle owner can publish",
          });
        const blueprint = await captureBundleBlueprint(input.sourceProjectId);
        const version = bundle.version + 1;
        if (!db) {
          Object.assign(getDemoWork().bundles.get(input.bundleId)!, {
            version,
            blueprint,
          });
        } else {
          await db.execute(sql`
            insert into public.work_bundle_version (
              work_bundle_id, version, blueprint, published_by_employee_id
            ) values (
              ${input.bundleId}::uuid, ${version},
              ${JSON.stringify(blueprint)}::jsonb, ${employeeId}::uuid
            )
          `);
          await db.execute(sql`
            update public.work_bundle set updated_at = now()
            where work_bundle_id = ${input.bundleId}::uuid
          `);
        }
        await audit(ctx, "work.bundle.publish", "work_bundle", input.bundleId, {
          sourceProjectId: input.sourceProjectId,
          version,
        });
        return { bundleId: input.bundleId, version };
      }),
    applyToProject: staffProcedure
      .input(z.object({ bundleId: uuid, projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const employeeId = actor(ctx);
        const db = getDb();
        const raw = !db
          ? getDemoWork().bundles.get(input.bundleId)
          : (
              await db.execute<WorkBundle & { blueprint: unknown }>(sql`
                select bundle.work_bundle_id as "bundleId", bundle.name,
                  bundle.description, bundle.visibility,
                  bundle.created_by_employee_id as "createdByEmployeeId",
                  latest.version, latest.blueprint
                from public.work_bundle bundle
                join lateral (
                  select version, blueprint from public.work_bundle_version
                  where work_bundle_id = bundle.work_bundle_id
                  order by version desc limit 1
                ) latest on true
                where bundle.work_bundle_id = ${input.bundleId}::uuid
                  and bundle.archived_at is null
                  and (bundle.visibility = 'organization'
                    or bundle.created_by_employee_id = ${employeeId}::uuid)
              `)
            )[0];
        if (!raw) throw new TRPCError({ code: "NOT_FOUND" });
        const parsed = bundleBlueprintSchema.safeParse(raw.blueprint);
        if (!parsed.success)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Bundle is invalid",
          });
        const store = getDemoWork();
        const key = `${input.projectId}:${input.bundleId}`;
        if (!db) {
          const applied = [...store.projectBundles.keys()].filter((candidate) =>
            candidate.startsWith(`${input.projectId}:`),
          );
          if (!store.projectBundles.has(key) && applied.length >= 5)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A project can use up to five bundles",
            });
          const sectionIds = new Map(
            [...store.sections.values()]
              .filter((section) => section.projectId === input.projectId)
              .map((section) => [
                section.name.toLowerCase(),
                section.sectionId,
              ]),
          );
          for (const section of parsed.data.sections) {
            if (sectionIds.has(section.name.toLowerCase())) continue;
            const sectionId = randomUUID();
            sectionIds.set(section.name.toLowerCase(), sectionId);
            store.sections.set(sectionId, {
              sectionId,
              projectId: input.projectId,
              name: section.name,
              position: sectionIds.size - 1,
            });
          }
          const remapBranches = (branches: WorkRuleBranch[]) =>
            branches.map((branch) => ({
              ...branch,
              conditions: branch.conditions.map((condition) => {
                if (
                  condition.field !== "sectionId" ||
                  typeof condition.value !== "string"
                )
                  return condition;
                const name = parsed.data.sectionRefs[condition.value];
                const value = name ? sectionIds.get(name.toLowerCase()) : null;
                if (!value)
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Bundle section is missing",
                  });
                return { ...condition, value };
              }),
              actions: branch.actions.map((action) => {
                if (action.type !== "move_section") return action;
                const name = parsed.data.sectionRefs[action.sectionId];
                const sectionId = name
                  ? sectionIds.get(name.toLowerCase())
                  : null;
                if (!sectionId)
                  throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Bundle section is missing",
                  });
                return { ...action, sectionId };
              }),
            }));
          for (const field of parsed.data.customFields) {
            if (
              [...store.customFields.values()].some(
                (candidate) =>
                  candidate.projectId === input.projectId &&
                  candidate.name.toLowerCase() === field.name.toLowerCase(),
              )
            )
              continue;
            const customFieldId = randomUUID();
            store.customFields.set(customFieldId, {
              customFieldId,
              projectId: input.projectId,
              ...field,
              position: [...store.customFields.values()].filter(
                (candidate) => candidate.projectId === input.projectId,
              ).length,
            });
          }
          for (const rule of parsed.data.rules) {
            if (
              [...store.rules.values()].some(
                (candidate) =>
                  candidate.projectId === input.projectId &&
                  candidate.name.toLowerCase() === rule.name.toLowerCase(),
              )
            )
              continue;
            const ruleId = randomUUID();
            store.rules.set(ruleId, {
              ruleId,
              projectId: input.projectId,
              ...rule,
              branches: remapBranches(rule.branches),
              isEnabled: true,
            });
          }
          for (const template of parsed.data.taskTemplates) {
            if (
              [...store.templates.values()].some(
                (candidate) =>
                  candidate.projectId === input.projectId &&
                  candidate.name.toLowerCase() === template.name.toLowerCase(),
              )
            )
              continue;
            const templateId = randomUUID();
            store.templates.set(templateId, {
              templateId,
              projectId: input.projectId,
              templateType: "task",
              ...template,
              createdByEmployeeId: employeeId,
            });
          }
          store.projectBundles.set(key, {
            version: raw.version,
            appliedAt: new Date().toISOString(),
          });
        } else {
          await db.transaction(async (tx) => {
            const applied = await tx.execute<{ count: number }>(sql`
              select count(*)::int as count from public.work_project_bundle
              where work_project_id = ${input.projectId}::uuid
                and work_bundle_id <> ${input.bundleId}::uuid
            `);
            if ((applied[0]?.count ?? 0) >= 5)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "A project can use up to five bundles",
              });
            const existingSections = await tx.execute<{
              sectionId: string;
              name: string;
            }>(sql`
              select work_section_id as "sectionId", name
              from public.work_section where work_project_id = ${input.projectId}::uuid
            `);
            const sectionIds = new Map(
              existingSections.map((section) => [
                section.name.toLowerCase(),
                section.sectionId,
              ]),
            );
            for (const section of parsed.data.sections) {
              if (sectionIds.has(section.name.toLowerCase())) continue;
              const sectionId = randomUUID();
              sectionIds.set(section.name.toLowerCase(), sectionId);
              await tx.execute(sql`
                insert into public.work_section (
                  work_section_id, work_project_id, name, position
                ) values (
                  ${sectionId}::uuid, ${input.projectId}::uuid, ${section.name},
                  (select coalesce(max(position), -1) + 1 from public.work_section
                   where work_project_id = ${input.projectId}::uuid)
                )
              `);
            }
            const remapBranches = (branches: WorkRuleBranch[]) =>
              branches.map((branch) => ({
                ...branch,
                conditions: branch.conditions.map((condition) => {
                  if (
                    condition.field !== "sectionId" ||
                    typeof condition.value !== "string"
                  )
                    return condition;
                  const name = parsed.data.sectionRefs[condition.value];
                  const value = name
                    ? sectionIds.get(name.toLowerCase())
                    : null;
                  if (!value)
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message: "Bundle section is missing",
                    });
                  return { ...condition, value };
                }),
                actions: branch.actions.map((action) => {
                  if (action.type !== "move_section") return action;
                  const name = parsed.data.sectionRefs[action.sectionId];
                  const sectionId = name
                    ? sectionIds.get(name.toLowerCase())
                    : null;
                  if (!sectionId)
                    throw new TRPCError({
                      code: "BAD_REQUEST",
                      message: "Bundle section is missing",
                    });
                  return { ...action, sectionId };
                }),
              }));
            for (const field of parsed.data.customFields) {
              await tx.execute(sql`
                insert into public.work_custom_field (
                  work_project_id, name, field_type, options, is_required, position
                ) select ${input.projectId}::uuid, ${field.name}, ${field.fieldType},
                  ${JSON.stringify(field.options)}::jsonb, ${field.isRequired},
                  (select coalesce(max(position), -1) + 1 from public.work_custom_field
                   where work_project_id = ${input.projectId}::uuid)
                where not exists (
                  select 1 from public.work_custom_field
                  where work_project_id = ${input.projectId}::uuid
                    and lower(name) = lower(${field.name})
                )
              `);
            }
            for (const rule of parsed.data.rules) {
              const branches = remapBranches(rule.branches);
              await tx.execute(sql`
                insert into public.work_rule (
                  work_project_id, name, trigger_type, branches, owner_employee_id
                ) values (
                  ${input.projectId}::uuid, ${rule.name}, ${rule.triggerType},
                  ${JSON.stringify(branches)}::jsonb, ${employeeId}::uuid
                ) on conflict (work_project_id, name) do update
                  set trigger_type = excluded.trigger_type,
                    branches = excluded.branches, updated_at = now()
              `);
            }
            for (const template of parsed.data.taskTemplates) {
              await tx.execute(sql`
                insert into public.work_template (
                  work_project_id, name, template_type, blueprint,
                  created_by_employee_id
                ) select ${input.projectId}::uuid, ${template.name}, 'task',
                  ${JSON.stringify(template.blueprint)}::jsonb, ${employeeId}::uuid
                where not exists (
                  select 1 from public.work_template
                  where work_project_id = ${input.projectId}::uuid
                    and template_type = 'task' and archived_at is null
                    and lower(name) = lower(${template.name})
                )
              `);
            }
            await tx.execute(sql`
              insert into public.work_project_bundle (
                work_project_id, work_bundle_id, applied_version,
                applied_by_employee_id
              ) values (
                ${input.projectId}::uuid, ${input.bundleId}::uuid, ${raw.version},
                ${employeeId}::uuid
              ) on conflict (work_project_id, work_bundle_id) do update
                set applied_version = excluded.applied_version,
                  applied_by_employee_id = excluded.applied_by_employee_id,
                  applied_at = now()
            `);
          });
        }
        await audit(ctx, "work.bundle.apply", "work_project", input.projectId, {
          bundleId: input.bundleId,
          version: raw.version,
        });
        return {
          projectId: input.projectId,
          bundleId: input.bundleId,
          version: raw.version,
        };
      }),
  }),

  approvals: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().items.values()]
            .filter(
              (item) =>
                item.projectId === input.projectId &&
                item.itemType === "approval",
            )
            .map((item) => ({
              ...item,
              decision:
                getDemoWork().approvalDecisions.get(item.itemId)?.at(-1) ??
                null,
            }));
        const rows = await db.execute<
          WorkItem & {
            decisionId: string | null;
            decision: WorkApprovalDecision["decision"] | null;
            note: string | null;
            decidedByEmployeeId: string | null;
            decidedAt: Date | string | null;
          }
        >(sql`
          select item.work_item_id as "itemId",
            item.parent_work_item_id as "parentItemId", item.title,
            item.description, item.item_type as "itemType", item.priority,
            item.assignee_employee_id as "assigneeEmployeeId",
            assignee.display_name as "assigneeName", item.start_date as "startDate",
            item.due_at as "dueAt", item.completed_at as "completedAt",
            membership.work_section_id as "sectionId", membership.position,
            membership.work_project_id as "projectId", item.recurrence,
            decision.work_approval_decision_id as "decisionId",
            decision.decision, decision.note,
            decision.decided_by_employee_id as "decidedByEmployeeId",
            decision.decided_at as "decidedAt"
          from public.work_project_item membership
          join public.work_item item on item.work_item_id = membership.work_item_id
          left join public.employee assignee on assignee.employee_id = item.assignee_employee_id
          left join lateral (
            select * from public.work_approval_decision
            where work_item_id = item.work_item_id
            order by decided_at desc limit 1
          ) decision on true
          where membership.work_project_id = ${input.projectId}::uuid
            and item.item_type = 'approval' and item.archived_at is null
          order by item.completed_at nulls first, item.due_at nulls last
        `);
        return rows.map((item) => ({
          ...item,
          dueAt: iso(item.dueAt),
          completedAt: iso(item.completedAt),
          decision: item.decisionId
            ? {
                decisionId: item.decisionId,
                itemId: item.itemId,
                decision: item.decision!,
                note: item.note ?? "",
                decidedByEmployeeId: item.decidedByEmployeeId!,
                decidedAt: iso(item.decidedAt)!,
              }
            : null,
        }));
      }),
    convert: staffProcedure
      .input(z.object({ itemId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const db = getDb();
        if (!db) {
          const item = getDemoWork().items.get(input.itemId)!;
          item.itemType = "approval";
          item.completedAt = null;
        } else
          await db.execute(sql`
            update public.work_item
            set item_type = 'approval', completed_at = null, updated_at = now()
            where work_item_id = ${input.itemId}::uuid
          `);
        await audit(ctx, "work.approval.convert", "work_item", input.itemId, {
          itemType: "approval",
        });
        return { itemId: input.itemId, itemType: "approval" as const };
      }),
    decide: staffProcedure
      .input(
        z.object({
          itemId: uuid,
          decision: z.enum(["approved", "changes_requested", "rejected"]),
          note: z.string().trim().max(10_000).default(""),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const access = await requireItemAccess(ctx, input.itemId, "editor");
        const item = await ruleSnapshot(input.itemId);
        if (item.itemType !== "approval")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Task is not an approval",
          });
        const decision: WorkApprovalDecision = {
          decisionId: randomUUID(),
          itemId: input.itemId,
          decision: input.decision,
          note: input.note,
          decidedByEmployeeId: actor(ctx),
          decidedAt: new Date().toISOString(),
        };
        const db = getDb();
        if (!db) {
          const decisions =
            getDemoWork().approvalDecisions.get(input.itemId) ?? [];
          decisions.push(decision);
          getDemoWork().approvalDecisions.set(input.itemId, decisions);
          getDemoWork().items.get(input.itemId)!.completedAt =
            decision.decidedAt;
        } else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_approval_decision (
                work_approval_decision_id, work_item_id, decision, note,
                decided_by_employee_id
              ) values (
                ${decision.decisionId}::uuid, ${decision.itemId}::uuid,
                ${decision.decision}, ${decision.note},
                ${decision.decidedByEmployeeId}::uuid
              )
            `);
            await tx.execute(sql`
              update public.work_item
              set completed_at = now(), updated_at = now()
              where work_item_id = ${input.itemId}::uuid
                and item_type = 'approval'
            `);
          });
        await audit(ctx, "work.approval.decide", "work_item", input.itemId, {
          decision: input.decision,
          decisionId: decision.decisionId,
        });
        await notifyItem(
          ctx,
          input.itemId,
          "completed",
          `Approval ${input.decision.replaceAll("_", " ")}`,
        );
        await runProjectRules(
          ctx,
          access.projectId,
          input.itemId,
          "approval_decided",
        );
        return decision;
      }),
    reopen: staffProcedure
      .input(z.object({ itemId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireItemAccess(ctx, input.itemId, "editor");
        const item = await ruleSnapshot(input.itemId);
        if (item.itemType !== "approval")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Task is not an approval",
          });
        const db = getDb();
        if (!db) getDemoWork().items.get(input.itemId)!.completedAt = null;
        else
          await db.execute(sql`
            update public.work_item set completed_at = null, updated_at = now()
            where work_item_id = ${input.itemId}::uuid
          `);
        await audit(ctx, "work.approval.reopen", "work_item", input.itemId, {
          pending: true,
        });
        return { ok: true as const };
      }),
  }),

  goals: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      const goals = !db
        ? [...getDemoWork().goals.values()].filter(
            (goal) =>
              goal.privacy === "organization" ||
              canManageOwned(
                ctx,
                goal.ownerEmployeeId,
                goal.createdByEmployeeId,
              ),
          )
        : await db.execute<WorkGoal & { progress: string | number }>(sql`
            select work_goal_id as "goalId",
              parent_work_goal_id as "parentGoalId", name, description, scope,
              owner_employee_id as "ownerEmployeeId", status, progress,
              start_date::text as "startDate", due_date::text as "dueDate", privacy,
              created_by_employee_id as "createdByEmployeeId", created_at as "createdAt"
            from public.work_goal
            where archived_at is null and (
              privacy = 'organization' or owner_employee_id = ${employeeId}::uuid
              or created_by_employee_id = ${employeeId}::uuid
            )
            order by due_date nulls last, lower(name)
          `);
      return Promise.all(
        goals.map(async (goal) => ({
          ...goal,
          progress: await goalProgress({
            ...goal,
            progress: Number(goal.progress),
            createdAt: new Date(goal.createdAt).toISOString(),
          }),
          createdAt: new Date(goal.createdAt).toISOString(),
        })),
      );
    }),
    create: staffProcedure
      .input(
        z.object({
          parentGoalId: nullableUuid.optional(),
          name: z.string().trim().min(1).max(300),
          description: z.string().trim().max(20_000).default(""),
          scope: z.enum(["company", "team", "individual"]).default("company"),
          ownerEmployeeId: nullableUuid.optional(),
          status: z
            .enum(["on_track", "at_risk", "off_track", "achieved", "dropped"])
            .default("on_track"),
          progress: z.number().min(0).max(100).default(0),
          startDate: z.string().date().nullable().optional(),
          dueDate: z.string().date().nullable().optional(),
          privacy: z.enum(["organization", "private"]).default("organization"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.parentGoalId)
          await requireGoalAccess(ctx, input.parentGoalId, true);
        if (input.startDate && input.dueDate && input.dueDate < input.startDate)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Due date must be after the start date",
          });
        const employeeId = actor(ctx);
        const goal: WorkGoal = {
          goalId: randomUUID(),
          parentGoalId: input.parentGoalId ?? null,
          name: input.name,
          description: input.description,
          scope: input.scope,
          ownerEmployeeId: input.ownerEmployeeId ?? employeeId,
          status: input.status,
          progress: input.status === "achieved" ? 100 : input.progress,
          startDate: input.startDate ?? null,
          dueDate: input.dueDate ?? null,
          privacy: input.privacy,
          createdByEmployeeId: employeeId,
          createdAt: new Date().toISOString(),
        };
        const db = getDb();
        if (!db) getDemoWork().goals.set(goal.goalId, goal);
        else
          await db.execute(sql`
            insert into public.work_goal (
              work_goal_id, parent_work_goal_id, name, description, scope,
              owner_employee_id, status, progress, start_date, due_date, privacy,
              created_by_employee_id
            ) values (
              ${goal.goalId}::uuid, ${goal.parentGoalId}::uuid, ${goal.name},
              ${goal.description}, ${goal.scope}, ${goal.ownerEmployeeId}::uuid,
              ${goal.status}, ${goal.progress}, ${goal.startDate}::date,
              ${goal.dueDate}::date, ${goal.privacy}, ${employeeId}::uuid
            )
          `);
        await audit(ctx, "work.goal.create", "work_goal", goal.goalId, {
          name: goal.name,
          scope: goal.scope,
        });
        return goal;
      }),
    update: staffProcedure
      .input(
        z.object({
          goalId: uuid,
          name: z.string().trim().min(1).max(300),
          description: z.string().trim().max(20_000),
          scope: z.enum(["company", "team", "individual"]),
          ownerEmployeeId: nullableUuid,
          status: z.enum([
            "on_track",
            "at_risk",
            "off_track",
            "achieved",
            "dropped",
          ]),
          progress: z.number().min(0).max(100),
          startDate: z.string().date().nullable(),
          dueDate: z.string().date().nullable(),
          privacy: z.enum(["organization", "private"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const current = await requireGoalAccess(ctx, input.goalId, true);
        if (input.startDate && input.dueDate && input.dueDate < input.startDate)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid date range",
          });
        const goal = {
          ...current,
          ...input,
          progress: input.status === "achieved" ? 100 : input.progress,
        };
        const db = getDb();
        if (!db) getDemoWork().goals.set(goal.goalId, goal);
        else
          await db.execute(sql`
            update public.work_goal set name = ${goal.name},
              description = ${goal.description}, scope = ${goal.scope},
              owner_employee_id = ${goal.ownerEmployeeId}::uuid,
              status = ${goal.status}, progress = ${goal.progress},
              start_date = ${goal.startDate}::date, due_date = ${goal.dueDate}::date,
              privacy = ${goal.privacy}, updated_at = now()
            where work_goal_id = ${goal.goalId}::uuid
          `);
        await audit(ctx, "work.goal.update", "work_goal", goal.goalId, {
          status: goal.status,
          progress: goal.progress,
        });
        return { ...goal, progress: await goalProgress(goal) };
      }),
    links: staffProcedure
      .input(z.object({ goalId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireGoalAccess(ctx, input.goalId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().goalLinks.values()].filter(
            (link) => link.goalId === input.goalId,
          );
        const rows = await db.execute<
          WorkGoalLink & { weight: string | number }
        >(sql`
          select work_goal_link_id as "goalLinkId", work_goal_id as "goalId",
            work_project_id as "projectId", work_item_id as "itemId", weight
          from public.work_goal_link where work_goal_id = ${input.goalId}::uuid
        `);
        return rows.map((row) => ({ ...row, weight: Number(row.weight) }));
      }),
    link: staffProcedure
      .input(
        z.object({
          goalId: uuid,
          target: z.discriminatedUnion("type", [
            z.object({ type: z.literal("project"), id: uuid }),
            z.object({ type: z.literal("item"), id: uuid }),
          ]),
          weight: z.number().positive().max(10_000).default(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireGoalAccess(ctx, input.goalId, true);
        if (input.target.type === "project")
          await requireProjectAccess(ctx, input.target.id);
        else await requireItemAccess(ctx, input.target.id);
        const link: WorkGoalLink = {
          goalLinkId: randomUUID(),
          goalId: input.goalId,
          projectId: input.target.type === "project" ? input.target.id : null,
          itemId: input.target.type === "item" ? input.target.id : null,
          weight: input.weight,
        };
        const db = getDb();
        if (!db) {
          const existing = [...getDemoWork().goalLinks.values()].find(
            (item) =>
              item.goalId === link.goalId &&
              item.projectId === link.projectId &&
              item.itemId === link.itemId,
          );
          if (existing) {
            existing.weight = link.weight;
            return existing;
          }
          getDemoWork().goalLinks.set(link.goalLinkId, link);
        } else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              delete from public.work_goal_link
              where work_goal_id = ${link.goalId}::uuid
                and work_project_id is not distinct from ${link.projectId}::uuid
                and work_item_id is not distinct from ${link.itemId}::uuid
            `);
            await tx.execute(sql`
              insert into public.work_goal_link (
                work_goal_link_id, work_goal_id, work_project_id, work_item_id, weight
              ) values (
                ${link.goalLinkId}::uuid, ${link.goalId}::uuid,
                ${link.projectId}::uuid, ${link.itemId}::uuid, ${link.weight}
              )
            `);
          });
        await audit(ctx, "work.goal.link", "work_goal", input.goalId, {
          target: input.target,
          weight: input.weight,
        });
        return link;
      }),
    unlink: staffProcedure
      .input(z.object({ goalId: uuid, goalLinkId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireGoalAccess(ctx, input.goalId, true);
        const db = getDb();
        if (!db) {
          const link = getDemoWork().goalLinks.get(input.goalLinkId);
          if (!link || link.goalId !== input.goalId)
            throw new TRPCError({ code: "NOT_FOUND" });
          getDemoWork().goalLinks.delete(input.goalLinkId);
        } else
          await db.execute(sql`
            delete from public.work_goal_link
            where work_goal_link_id = ${input.goalLinkId}::uuid
              and work_goal_id = ${input.goalId}::uuid
          `);
        return { ok: true as const };
      }),
    archive: staffProcedure
      .input(z.object({ goalId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireGoalAccess(ctx, input.goalId, true);
        const db = getDb();
        if (!db) getDemoWork().goals.delete(input.goalId);
        else
          await db.execute(sql`
            update public.work_goal set archived_at = now(), updated_at = now()
            where work_goal_id = ${input.goalId}::uuid
          `);
        await audit(ctx, "work.goal.archive", "work_goal", input.goalId, {
          archived: true,
        });
        return { ok: true as const };
      }),
  }),

  portfolios: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      const portfolios = !db
        ? [...getDemoWork().portfolios.values()].filter(
            (item) =>
              item.privacy === "organization" ||
              canManageOwned(
                ctx,
                item.ownerEmployeeId,
                item.createdByEmployeeId,
              ),
          )
        : await db.execute<WorkPortfolio>(sql`
            select work_portfolio_id as "portfolioId", name, description, color,
              privacy, owner_employee_id as "ownerEmployeeId",
              created_by_employee_id as "createdByEmployeeId", created_at as "createdAt"
            from public.work_portfolio where archived_at is null and (
              privacy = 'organization' or owner_employee_id = ${employeeId}::uuid
              or created_by_employee_id = ${employeeId}::uuid
            ) order by lower(name)
          `);
      return Promise.all(
        portfolios.map(async (portfolio) => {
          const projectIds = !db
            ? [
                ...(getDemoWork().portfolioProjects.get(
                  portfolio.portfolioId,
                ) ?? []),
              ]
            : (
                await db.execute<{ projectId: string }>(sql`
                  select work_project_id as "projectId"
                  from public.work_portfolio_project
                  where work_portfolio_id = ${portfolio.portfolioId}::uuid
                  order by position
                `)
              ).map((item) => item.projectId);
          const accessible: string[] = [];
          for (const projectId of projectIds) {
            try {
              await requireProjectAccess(ctx, projectId);
              accessible.push(projectId);
            } catch (error) {
              if (!(error instanceof TRPCError)) throw error;
            }
          }
          const progresses = await Promise.all(accessible.map(projectProgress));
          const progress = progresses.length
            ? Math.round(
                (progresses.reduce((sum, value) => sum + value, 0) /
                  progresses.length) *
                  100,
              ) / 100
            : 0;
          const latest = !db
            ? [...getDemoWork().statusUpdates.values()]
                .filter((item) => item.portfolioId === portfolio.portfolioId)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
            : (
                await db.execute<{ health: WorkStatusUpdate["health"] }>(sql`
                  select health from public.work_status_update
                  where work_portfolio_id = ${portfolio.portfolioId}::uuid
                  order by created_at desc limit 1
                `)
              )[0];
          return {
            ...portfolio,
            createdAt: new Date(portfolio.createdAt).toISOString(),
            projectIds: accessible,
            progress,
            health:
              latest?.health ?? (progress === 100 ? "complete" : "on_track"),
          };
        }),
      );
    }),
    create: staffProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(200),
          description: z.string().trim().max(20_000).default(""),
          color: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .default("#C7702E"),
          privacy: z.enum(["organization", "private"]).default("organization"),
          ownerEmployeeId: nullableUuid.optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const portfolio: WorkPortfolio = {
          portfolioId: randomUUID(),
          name: input.name,
          description: input.description,
          color: input.color,
          privacy: input.privacy,
          ownerEmployeeId: input.ownerEmployeeId ?? employeeId,
          createdByEmployeeId: employeeId,
          createdAt: new Date().toISOString(),
        };
        const db = getDb();
        if (!db) {
          getDemoWork().portfolios.set(portfolio.portfolioId, portfolio);
          getDemoWork().portfolioProjects.set(portfolio.portfolioId, new Set());
        } else
          await db.execute(sql`
            insert into public.work_portfolio (
              work_portfolio_id, name, description, color, privacy,
              owner_employee_id, created_by_employee_id
            ) values (
              ${portfolio.portfolioId}::uuid, ${portfolio.name},
              ${portfolio.description}, ${portfolio.color}, ${portfolio.privacy},
              ${portfolio.ownerEmployeeId}::uuid, ${employeeId}::uuid
            )
          `);
        await audit(
          ctx,
          "work.portfolio.create",
          "work_portfolio",
          portfolio.portfolioId,
          {
            name: portfolio.name,
          },
        );
        return portfolio;
      }),
    addProject: staffProcedure
      .input(z.object({ portfolioId: uuid, projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requirePortfolioAccess(ctx, input.portfolioId, true);
        await requireProjectAccess(ctx, input.projectId, "editor");
        const db = getDb();
        if (!db)
          (
            getDemoWork().portfolioProjects.get(input.portfolioId) ?? new Set()
          ).add(input.projectId);
        else
          await db.execute(sql`
            insert into public.work_portfolio_project (
              work_portfolio_id, work_project_id, position
            ) values (
              ${input.portfolioId}::uuid, ${input.projectId}::uuid,
              (select count(*) from public.work_portfolio_project
               where work_portfolio_id = ${input.portfolioId}::uuid)
            ) on conflict do nothing
          `);
        await audit(
          ctx,
          "work.portfolio.project.add",
          "work_portfolio",
          input.portfolioId,
          {
            projectId: input.projectId,
          },
        );
        return { ok: true as const };
      }),
    removeProject: staffProcedure
      .input(z.object({ portfolioId: uuid, projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requirePortfolioAccess(ctx, input.portfolioId, true);
        const db = getDb();
        if (!db)
          getDemoWork()
            .portfolioProjects.get(input.portfolioId)
            ?.delete(input.projectId);
        else
          await db.execute(sql`
            delete from public.work_portfolio_project
            where work_portfolio_id = ${input.portfolioId}::uuid
              and work_project_id = ${input.projectId}::uuid
          `);
        return { ok: true as const };
      }),
    archive: staffProcedure
      .input(z.object({ portfolioId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requirePortfolioAccess(ctx, input.portfolioId, true);
        const db = getDb();
        if (!db) getDemoWork().portfolios.delete(input.portfolioId);
        else
          await db.execute(sql`
            update public.work_portfolio set archived_at = now(), updated_at = now()
            where work_portfolio_id = ${input.portfolioId}::uuid
          `);
        await audit(
          ctx,
          "work.portfolio.archive",
          "work_portfolio",
          input.portfolioId,
          { archived: true },
        );
        return { ok: true as const };
      }),
  }),

  statusUpdates: router({
    list: staffProcedure
      .input(
        z.object({
          targetType: z.enum(["project", "portfolio", "goal"]),
          targetId: uuid,
        }),
      )
      .query(async ({ input, ctx }) => {
        if (input.targetType === "project")
          await requireProjectAccess(ctx, input.targetId);
        else if (input.targetType === "portfolio")
          await requirePortfolioAccess(ctx, input.targetId);
        else await requireGoalAccess(ctx, input.targetId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().statusUpdates.values()]
            .filter((item) => item[`${input.targetType}Id`] === input.targetId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const target =
          input.targetType === "project"
            ? sql`work_project_id`
            : input.targetType === "portfolio"
              ? sql`work_portfolio_id`
              : sql`work_goal_id`;
        const rows = await db.execute<
          WorkStatusUpdate & { progress: string | number | null }
        >(sql`
          select work_status_update_id as "statusUpdateId",
            work_project_id as "projectId", work_portfolio_id as "portfolioId",
            work_goal_id as "goalId", health, progress, title, body,
            created_by_employee_id as "createdByEmployeeId", created_at as "createdAt"
          from public.work_status_update where ${target} = ${input.targetId}::uuid
          order by created_at desc
        `);
        return rows.map((row) => ({
          ...row,
          progress: row.progress === null ? null : Number(row.progress),
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      }),
    create: staffProcedure
      .input(
        z.object({
          targetType: z.enum(["project", "portfolio", "goal"]),
          targetId: uuid,
          health: z.enum(["on_track", "at_risk", "off_track", "complete"]),
          progress: z.number().min(0).max(100).nullable().default(null),
          title: z.string().trim().min(1).max(300),
          body: z.string().trim().max(50_000).default(""),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (input.targetType === "project")
          await requireProjectAccess(ctx, input.targetId, "editor");
        else if (input.targetType === "portfolio")
          await requirePortfolioAccess(ctx, input.targetId, true);
        else await requireGoalAccess(ctx, input.targetId, true);
        const update: WorkStatusUpdate = {
          statusUpdateId: randomUUID(),
          projectId: input.targetType === "project" ? input.targetId : null,
          portfolioId: input.targetType === "portfolio" ? input.targetId : null,
          goalId: input.targetType === "goal" ? input.targetId : null,
          health: input.health,
          progress: input.progress,
          title: input.title,
          body: input.body,
          createdByEmployeeId: actor(ctx),
          createdAt: new Date().toISOString(),
        };
        const db = getDb();
        if (!db) getDemoWork().statusUpdates.set(update.statusUpdateId, update);
        else
          await db.execute(sql`
            insert into public.work_status_update (
              work_status_update_id, work_project_id, work_portfolio_id,
              work_goal_id, health, progress, title, body, created_by_employee_id
            ) values (
              ${update.statusUpdateId}::uuid, ${update.projectId}::uuid,
              ${update.portfolioId}::uuid, ${update.goalId}::uuid,
              ${update.health}, ${update.progress}, ${update.title}, ${update.body},
              ${update.createdByEmployeeId}::uuid
            )
          `);
        await audit(
          ctx,
          "work.status.create",
          "work_status_update",
          update.statusUpdateId,
          {
            targetType: input.targetType,
            targetId: input.targetId,
            health: input.health,
          },
        );
        return update;
      }),
  }),

  reporting: router({
    summary: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(({ input, ctx }) => projectPlanningSummary(ctx, input.projectId)),
    dashboards: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db)
        return [...getDemoWork().dashboards.values()].filter(
          (item) => item.ownerEmployeeId === employeeId,
        );
      return db.execute<WorkDashboard>(sql`
        select work_reporting_dashboard_id as "dashboardId",
          owner_employee_id as "ownerEmployeeId", name, config
        from public.work_reporting_dashboard
        where owner_employee_id = ${employeeId}::uuid order by lower(name)
      `);
    }),
    saveDashboard: staffProcedure
      .input(
        z.object({
          dashboardId: uuid.optional(),
          name: z.string().trim().min(1).max(160),
          config: z.record(z.string(), z.unknown()),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const dashboard: WorkDashboard = {
          dashboardId: input.dashboardId ?? randomUUID(),
          ownerEmployeeId: employeeId,
          name: input.name,
          config: input.config,
        };
        const db = getDb();
        if (!db) {
          const existing = getDemoWork().dashboards.get(dashboard.dashboardId);
          if (existing && existing.ownerEmployeeId !== employeeId)
            throw new TRPCError({ code: "NOT_FOUND" });
          getDemoWork().dashboards.set(dashboard.dashboardId, dashboard);
        } else
          await db.execute(sql`
            insert into public.work_reporting_dashboard (
              work_reporting_dashboard_id, owner_employee_id, name, config
            ) values (
              ${dashboard.dashboardId}::uuid, ${employeeId}::uuid,
              ${dashboard.name}, ${JSON.stringify(dashboard.config)}::jsonb
            ) on conflict (work_reporting_dashboard_id) do update
              set name = excluded.name, config = excluded.config, updated_at = now()
              where work_reporting_dashboard.owner_employee_id = ${employeeId}::uuid
          `);
        await audit(
          ctx,
          "work.dashboard.save",
          "work_reporting_dashboard",
          dashboard.dashboardId,
          {
            name: dashboard.name,
          },
        );
        return dashboard;
      }),
    deleteDashboard: staffProcedure
      .input(z.object({ dashboardId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const dashboard = getDemoWork().dashboards.get(input.dashboardId);
          if (!dashboard || dashboard.ownerEmployeeId !== employeeId)
            throw new TRPCError({ code: "NOT_FOUND" });
          getDemoWork().dashboards.delete(input.dashboardId);
        } else
          await db.execute(sql`
            delete from public.work_reporting_dashboard
            where work_reporting_dashboard_id = ${input.dashboardId}::uuid
              and owner_employee_id = ${employeeId}::uuid
          `);
        return { ok: true as const };
      }),
    exportProject: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        const rows = !db
          ? [...getDemoWork().items.values()]
              .filter((item) => item.projectId === input.projectId)
              .map((item) => ({
                title: item.title,
                assignee: item.assigneeName,
                due: item.dueAt?.slice(0, 10) ?? null,
                completed: item.completedAt ? "yes" : "no",
                estimatedMinutes: item.estimatedMinutes ?? null,
              }))
          : await db.execute<{
              title: string;
              assignee: string | null;
              due: string | null;
              completed: string;
              estimatedMinutes: number | null;
            }>(sql`
              select item.title, employee.display_name as assignee,
                item.due_at::date::text as due,
                case when item.completed_at is null then 'no' else 'yes' end as completed,
                item.estimated_minutes as "estimatedMinutes"
              from public.work_project_item membership
              join public.work_item item on item.work_item_id = membership.work_item_id
              left join public.employee employee
                on employee.employee_id = item.assignee_employee_id
              where membership.work_project_id = ${input.projectId}::uuid
                and item.archived_at is null order by membership.position
            `);
        const escape = (value: unknown) =>
          `"${String(value ?? "").replaceAll('"', '""')}"`;
        return {
          fileName: `work-report-${input.projectId}.csv`,
          contentType: "text/csv;charset=utf-8",
          csv: [
            ["Task", "Assignee", "Due", "Completed", "Estimated minutes"],
            ...rows.map((item) => [
              item.title,
              item.assignee,
              item.due,
              item.completed,
              item.estimatedMinutes,
            ]),
          ]
            .map((row) => row.map(escape).join(","))
            .join("\n"),
        };
      }),
  }),

  workload: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid, weekStart: z.string().date() }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) {
          const allocations = [...getDemoWork().allocations.values()].filter(
            (item) =>
              item.projectId === input.projectId &&
              item.weekStart === input.weekStart,
          );
          const employeeId = actor(ctx);
          const allocatedMinutes = allocations
            .filter((item) => item.employeeId === employeeId)
            .reduce((sum, item) => sum + item.allocatedMinutes, 0);
          const assignedMinutes = [...getDemoWork().items.values()]
            .filter(
              (item) =>
                item.projectId === input.projectId &&
                item.assigneeEmployeeId === employeeId &&
                !item.completedAt,
            )
            .reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
          return [
            {
              employeeId,
              displayName: "Dev Partner",
              capacityHours: 40,
              allocatedMinutes,
              assignedMinutes,
              actualMinutes: [...getDemoWork().timeEntries.values()]
                .filter(
                  (item) =>
                    item.employeeId === employeeId &&
                    item.projectId === input.projectId &&
                    item.workDate >= input.weekStart &&
                    item.workDate <
                      relativeDate(
                        7,
                        new Date(`${input.weekStart}T00:00:00Z`),
                      ).slice(0, 10),
                )
                .reduce((sum, item) => sum + item.minutes, 0),
              utilization: capacityUtilization(
                Math.max(allocatedMinutes, assignedMinutes),
                40,
              ),
              allocations,
            },
          ];
        }
        const rows = await db.execute<{
          employeeId: string;
          displayName: string;
          capacityHours: string | number | null;
          allocatedMinutes: number;
          assignedMinutes: number;
          actualMinutes: number;
        }>(sql`
          select employee.employee_id as "employeeId",
            employee.display_name as "displayName",
            employee.capacity_hours_per_week as "capacityHours",
            coalesce((select sum(allocation.allocated_minutes)
              from public.work_capacity_allocation allocation
              where allocation.employee_id = employee.employee_id
                and allocation.work_project_id = ${input.projectId}::uuid
                and allocation.week_start = ${input.weekStart}::date), 0)::int
              as "allocatedMinutes",
            coalesce((select sum(item.estimated_minutes)
              from public.work_project_item membership
              join public.work_item item
                on item.work_item_id = membership.work_item_id
              where membership.work_project_id = ${input.projectId}::uuid
                and item.assignee_employee_id = employee.employee_id
                and item.completed_at is null
                and item.due_at >= ${input.weekStart}::date
                and item.due_at < ${input.weekStart}::date + interval '7 days'), 0)::int
              as "assignedMinutes",
            coalesce((select sum(entry.minutes) from public.time_entry entry
              where entry.employee_id = employee.employee_id
                and entry.work_project_id = ${input.projectId}::uuid
                and entry.work_date >= ${input.weekStart}::date
                and entry.work_date < ${input.weekStart}::date + 7), 0)::int
              as "actualMinutes"
          from public.employee employee where employee.is_active = true
          order by lower(employee.display_name)
        `);
        return rows.map((row) => ({
          ...row,
          capacityHours: Number(row.capacityHours ?? 40),
          utilization: capacityUtilization(
            Math.max(row.allocatedMinutes, row.assignedMinutes),
            Number(row.capacityHours ?? 40),
          ),
        }));
      }),
    upsert: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          employeeId: uuid,
          weekStart: z.string().date(),
          allocatedMinutes: z.number().int().min(0).max(10_080),
          roleName: z.string().trim().max(160).nullable().default(null),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        if (new Date(`${input.weekStart}T00:00:00Z`).getUTCDay() !== 1)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Capacity weeks start on Monday",
          });
        const allocation: WorkCapacityAllocation = {
          allocationId: randomUUID(),
          ...input,
        };
        const db = getDb();
        if (!db) {
          const existing = [...getDemoWork().allocations.values()].find(
            (item) =>
              item.employeeId === input.employeeId &&
              item.projectId === input.projectId &&
              item.weekStart === input.weekStart,
          );
          if (existing) Object.assign(existing, input);
          else
            getDemoWork().allocations.set(allocation.allocationId, allocation);
        } else {
          const rows = await db.execute<{ allocationId: string }>(sql`
            insert into public.work_capacity_allocation (
              employee_id, work_project_id, week_start, allocated_minutes,
              role_name, created_by_employee_id
            ) values (
              ${input.employeeId}::uuid, ${input.projectId}::uuid,
              ${input.weekStart}::date, ${input.allocatedMinutes},
              ${input.roleName}, ${actor(ctx)}::uuid
            ) on conflict (employee_id, work_project_id, week_start) do update
              set allocated_minutes = excluded.allocated_minutes,
                role_name = excluded.role_name, updated_at = now()
            returning work_capacity_allocation_id as "allocationId"
          `);
          allocation.allocationId = rows[0]!.allocationId;
        }
        await audit(
          ctx,
          "work.capacity.upsert",
          "work_capacity_allocation",
          allocation.allocationId,
          {
            projectId: input.projectId,
            employeeId: input.employeeId,
            allocatedMinutes: input.allocatedMinutes,
          },
        );
        return allocation;
      }),
  }),

  budgets: router({
    summary: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(({ input, ctx }) => projectPlanningSummary(ctx, input.projectId)),
    update: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          budgetAmount: z.number().min(0).nullable(),
          budgetCurrency: z.string().regex(/^[A-Z]{3}$/),
          hourlyCostRate: z.number().min(0).nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const project = await requireProjectAccess(
          ctx,
          input.projectId,
          "admin",
        );
        const db = getDb();
        if (!db) {
          Object.assign(project, input);
          getDemoWork().projects.set(project.projectId, project);
        } else
          await db.execute(sql`
            update public.work_project set budget_amount = ${input.budgetAmount},
              budget_currency = ${input.budgetCurrency},
              hourly_cost_rate = ${input.hourlyCostRate}, updated_at = now()
            where work_project_id = ${input.projectId}::uuid
          `);
        await audit(
          ctx,
          "work.budget.update",
          "work_project",
          input.projectId,
          {
            budgetAmount: input.budgetAmount,
            budgetCurrency: input.budgetCurrency,
            hourlyCostRate: input.hourlyCostRate,
          },
        );
        return projectPlanningSummary(ctx, input.projectId);
      }),
  }),

  time: router({
    list: staffProcedure
      .input(
        z.object({
          projectId: uuid.optional(),
          from: z.string().date().optional(),
          to: z.string().date().optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        if (input.projectId) await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db)
          return [...getDemoWork().timeEntries.values()]
            .filter(
              (entry) =>
                entry.employeeId === employeeId &&
                (!input.projectId || entry.projectId === input.projectId) &&
                (!input.from || entry.workDate >= input.from) &&
                (!input.to || entry.workDate <= input.to),
            )
            .sort((a, b) => b.workDate.localeCompare(a.workDate));
        return db.execute<WorkTimeEntry>(sql`
          select time_entry_id as "timeEntryId", employee_id as "employeeId",
            work_project_id as "projectId", work_item_id as "itemId",
            work_date::text as "workDate", minutes, is_billable as "isBillable",
            description, status from public.time_entry
          where employee_id = ${employeeId}::uuid
            and (${input.projectId ?? null}::uuid is null
              or work_project_id = ${input.projectId ?? null}::uuid)
            and (${input.from ?? null}::date is null
              or work_date >= ${input.from ?? null}::date)
            and (${input.to ?? null}::date is null
              or work_date <= ${input.to ?? null}::date)
          order by work_date desc, created_at desc
        `);
      }),
    log: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          itemId: nullableUuid.optional(),
          workDate: z.string().date(),
          minutes: z.number().int().min(1).max(1_440),
          isBillable: z.boolean().default(false),
          description: z.string().trim().max(5_000).nullable().default(null),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireProjectAccess(ctx, input.projectId, "commenter");
        if (input.itemId)
          await requireItemInProject(ctx, input.itemId, input.projectId);
        const entry: WorkTimeEntry = {
          timeEntryId: randomUUID(),
          employeeId,
          projectId: input.projectId,
          itemId: input.itemId ?? null,
          workDate: input.workDate,
          minutes: input.minutes,
          isBillable: input.isBillable,
          description: input.description,
          status: "draft",
        };
        const db = getDb();
        if (!db) {
          const current = [...getDemoWork().timeEntries.values()]
            .filter(
              (item) =>
                item.employeeId === employeeId &&
                item.workDate === input.workDate,
            )
            .reduce((sum, item) => sum + item.minutes, 0);
          try {
            validateDailyMinutes(current, input.minutes);
          } catch {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Daily time cannot exceed 24 hours",
            });
          }
          getDemoWork().timeEntries.set(entry.timeEntryId, entry);
        } else
          await db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`${employeeId}:${input.workDate}`}))`,
            );
            const current = Number(
              (
                await tx.execute<{ minutes: number }>(sql`
                  select coalesce(sum(minutes), 0)::int as minutes
                  from public.time_entry
                  where employee_id = ${employeeId}::uuid
                    and work_date = ${input.workDate}::date
                `)
              )[0]?.minutes ?? 0,
            );
            try {
              validateDailyMinutes(current, input.minutes);
            } catch {
              throw new TRPCError({
                code: "CONFLICT",
                message: "Daily time cannot exceed 24 hours",
              });
            }
            await tx.execute(sql`
              insert into public.time_entry (
                time_entry_id, employee_id, work_project_id, work_item_id,
                work_date, minutes, is_billable, description, created_by_employee_id
              ) values (
                ${entry.timeEntryId}::uuid, ${employeeId}::uuid,
                ${entry.projectId}::uuid, ${entry.itemId}::uuid,
                ${entry.workDate}::date, ${entry.minutes}, ${entry.isBillable},
                ${entry.description}, ${employeeId}::uuid
              )
            `);
          });
        await audit(ctx, "work.time.log", "time_entry", entry.timeEntryId, {
          projectId: entry.projectId,
          minutes: entry.minutes,
        });
        return entry;
      }),
    remove: staffProcedure
      .input(z.object({ timeEntryId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const entry = getDemoWork().timeEntries.get(input.timeEntryId);
          if (
            !entry ||
            entry.employeeId !== employeeId ||
            !["draft", "rejected"].includes(entry.status)
          )
            throw new TRPCError({ code: "FORBIDDEN" });
          getDemoWork().timeEntries.delete(input.timeEntryId);
        } else {
          const rows = await db.execute<{
            employeeId: string;
            status: string;
          }>(sql`
            select employee_id as "employeeId", status from public.time_entry
            where time_entry_id = ${input.timeEntryId}::uuid
          `);
          const entry = rows[0];
          if (
            !entry ||
            entry.employeeId !== employeeId ||
            !["draft", "rejected"].includes(entry.status)
          )
            throw new TRPCError({ code: "FORBIDDEN" });
          await db.execute(sql`
            delete from public.time_entry
            where time_entry_id = ${input.timeEntryId}::uuid
          `);
        }
        await audit(
          ctx,
          "work.time.remove",
          "time_entry",
          input.timeEntryId,
          {},
        );
        return { ok: true as const };
      }),
    activeTimer: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db)
        return (
          [...getDemoWork().timers.values()].find(
            (timer) => timer.employeeId === employeeId && !timer.stoppedAt,
          ) ?? null
        );
      const rows = await db.execute<WorkTimer>(sql`
        select work_timer_id as "timerId", employee_id as "employeeId",
          work_project_id as "projectId", work_item_id as "itemId", description,
          started_at as "startedAt", stopped_at as "stoppedAt"
        from public.work_timer where employee_id = ${employeeId}::uuid
          and stopped_at is null limit 1
      `);
      return rows[0]
        ? {
            ...rows[0],
            startedAt: new Date(rows[0].startedAt).toISOString(),
            stoppedAt: iso(rows[0].stoppedAt),
          }
        : null;
    }),
    startTimer: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          itemId: nullableUuid.optional(),
          description: z.string().trim().max(5_000).nullable().default(null),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireProjectAccess(ctx, input.projectId, "commenter");
        if (input.itemId)
          await requireItemInProject(ctx, input.itemId, input.projectId);
        const timer: WorkTimer = {
          timerId: randomUUID(),
          employeeId,
          projectId: input.projectId,
          itemId: input.itemId ?? null,
          description: input.description,
          startedAt: new Date().toISOString(),
          stoppedAt: null,
        };
        const db = getDb();
        if (!db) {
          if (
            [...getDemoWork().timers.values()].some(
              (item) => item.employeeId === employeeId && !item.stoppedAt,
            )
          )
            throw new TRPCError({
              code: "CONFLICT",
              message: "Stop the active timer first",
            });
          getDemoWork().timers.set(timer.timerId, timer);
        } else {
          const existing = await db.execute(sql`
            select 1 from public.work_timer where employee_id = ${employeeId}::uuid
              and stopped_at is null limit 1
          `);
          if (existing[0])
            throw new TRPCError({
              code: "CONFLICT",
              message: "Stop the active timer first",
            });
          await db.execute(sql`
            insert into public.work_timer (
              work_timer_id, employee_id, work_project_id, work_item_id,
              description, started_at
            ) values (
              ${timer.timerId}::uuid, ${employeeId}::uuid,
              ${timer.projectId}::uuid, ${timer.itemId}::uuid,
              ${timer.description}, ${timer.startedAt}::timestamptz
            )
          `);
        }
        return timer;
      }),
    stopTimer: staffProcedure
      .input(
        z.object({ timerId: uuid, isBillable: z.boolean().default(false) }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const stoppedAt = new Date().toISOString();
        const db = getDb();
        if (!db) {
          const timer = getDemoWork().timers.get(input.timerId);
          if (!timer || timer.employeeId !== employeeId || timer.stoppedAt)
            throw new TRPCError({ code: "NOT_FOUND" });
          let chunks: ReturnType<typeof splitTimerByUtcDay>;
          try {
            chunks = splitTimerByUtcDay(timer.startedAt, stoppedAt);
            for (const chunk of chunks) {
              const existing = [...getDemoWork().timeEntries.values()]
                .filter(
                  (entry) =>
                    entry.employeeId === employeeId &&
                    entry.workDate === chunk.workDate,
                )
                .reduce((sum, entry) => sum + entry.minutes, 0);
              validateDailyMinutes(existing, chunk.minutes);
            }
          } catch (error) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                error instanceof Error ? error.message : "Timer is invalid",
            });
          }
          timer.stoppedAt = stoppedAt;
          const entries = chunks.map((chunk) => {
            const entry: WorkTimeEntry = {
              timeEntryId: randomUUID(),
              employeeId,
              projectId: timer.projectId,
              itemId: timer.itemId,
              workDate: chunk.workDate,
              minutes: chunk.minutes,
              isBillable: input.isBillable,
              description: timer.description,
              status: "draft",
            };
            getDemoWork().timeEntries.set(entry.timeEntryId, entry);
            return entry;
          });
          await audit(ctx, "work.timer.stop", "work_timer", input.timerId, {
            minutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
          });
          return { timer, entries };
        }
        const result = await db.transaction(async (tx) => {
          const timers = await tx.execute<WorkTimer>(sql`
            select work_timer_id as "timerId", employee_id as "employeeId",
              work_project_id as "projectId", work_item_id as "itemId", description,
              started_at as "startedAt", stopped_at as "stoppedAt"
            from public.work_timer where work_timer_id = ${input.timerId}::uuid
              and employee_id = ${employeeId}::uuid and stopped_at is null
            for update
          `);
          const timer = timers[0];
          if (!timer) throw new TRPCError({ code: "NOT_FOUND" });
          let chunks: ReturnType<typeof splitTimerByUtcDay>;
          try {
            chunks = splitTimerByUtcDay(timer.startedAt, stoppedAt);
          } catch (error) {
            throw new TRPCError({
              code: "CONFLICT",
              message:
                error instanceof Error ? error.message : "Timer is invalid",
            });
          }
          for (const chunk of chunks) {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`${employeeId}:${chunk.workDate}`}))`,
            );
            const current = Number(
              (
                await tx.execute<{ minutes: number }>(sql`
                  select coalesce(sum(minutes), 0)::int as minutes
                  from public.time_entry where employee_id = ${employeeId}::uuid
                    and work_date = ${chunk.workDate}::date
                `)
              )[0]?.minutes ?? 0,
            );
            try {
              validateDailyMinutes(current, chunk.minutes);
            } catch {
              throw new TRPCError({
                code: "CONFLICT",
                message: `Time on ${chunk.workDate} would exceed 24 hours`,
              });
            }
          }
          await tx.execute(sql`
            update public.work_timer set stopped_at = ${stoppedAt}::timestamptz
            where work_timer_id = ${input.timerId}::uuid
          `);
          const entries: WorkTimeEntry[] = [];
          for (const chunk of chunks) {
            const entry: WorkTimeEntry = {
              timeEntryId: randomUUID(),
              employeeId,
              projectId: timer.projectId,
              itemId: timer.itemId,
              workDate: chunk.workDate,
              minutes: chunk.minutes,
              isBillable: input.isBillable,
              description: timer.description,
              status: "draft",
            };
            await tx.execute(sql`
              insert into public.time_entry (
                time_entry_id, employee_id, work_project_id, work_item_id,
                work_date, minutes, is_billable, description, created_by_employee_id
              ) values (
                ${entry.timeEntryId}::uuid, ${employeeId}::uuid,
                ${entry.projectId}::uuid, ${entry.itemId}::uuid,
                ${entry.workDate}::date, ${entry.minutes}, ${entry.isBillable},
                ${entry.description}, ${employeeId}::uuid
              )
            `);
            entries.push(entry);
          }
          return {
            timer: { ...timer, stoppedAt },
            entries,
          };
        });
        await audit(ctx, "work.timer.stop", "work_timer", input.timerId, {
          minutes: result.entries.reduce(
            (sum, entry) => sum + entry.minutes,
            0,
          ),
        });
        return result;
      }),
    discardTimer: staffProcedure
      .input(z.object({ timerId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const timer = getDemoWork().timers.get(input.timerId);
          if (!timer || timer.employeeId !== employeeId || timer.stoppedAt)
            throw new TRPCError({ code: "NOT_FOUND" });
          getDemoWork().timers.delete(input.timerId);
        } else
          await db.execute(sql`
            delete from public.work_timer where work_timer_id = ${input.timerId}::uuid
              and employee_id = ${employeeId}::uuid and stopped_at is null
          `);
        await audit(ctx, "work.timer.discard", "work_timer", input.timerId, {});
        return { ok: true as const };
      }),
  }),

  gantt: router({
    get: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        const items = !db
          ? [...getDemoWork().items.values()].filter(
              (item) => item.projectId === input.projectId,
            )
          : await db.execute<WorkItem>(sql`
              select item.work_item_id as "itemId",
                item.parent_work_item_id as "parentItemId", item.title,
                item.description, item.item_type as "itemType", item.priority,
                item.assignee_employee_id as "assigneeEmployeeId",
                assignee.display_name as "assigneeName", item.start_date::text as "startDate",
                item.due_at as "dueAt", item.completed_at as "completedAt",
                membership.work_section_id as "sectionId", membership.position,
                membership.work_project_id as "projectId", item.recurrence,
                item.estimated_minutes as "estimatedMinutes"
              from public.work_project_item membership
              join public.work_item item on item.work_item_id = membership.work_item_id
              left join public.employee assignee
                on assignee.employee_id = item.assignee_employee_id
              where membership.work_project_id = ${input.projectId}::uuid
                and item.archived_at is null order by membership.position
            `);
        const dependencies = !db
          ? [...getDemoWork().dependencies.entries()].flatMap(
              ([itemId, values]) =>
                items.some((item) => item.itemId === itemId)
                  ? [...values].map((dependsOnItemId) => ({
                      itemId,
                      dependsOnItemId,
                    }))
                  : [],
            )
          : await db.execute<{ itemId: string; dependsOnItemId: string }>(sql`
              select dependency.work_item_id as "itemId",
                dependency.depends_on_work_item_id as "dependsOnItemId"
              from public.work_item_dependency dependency
              join public.work_project_item membership
                on membership.work_item_id = dependency.work_item_id
              where membership.work_project_id = ${input.projectId}::uuid
            `);
        const baselines = !db
          ? [...getDemoWork().baselines.values()].filter(
              (item) => item.projectId === input.projectId,
            )
          : await db.execute<WorkBaseline>(sql`
              select work_item_baseline_id as "baselineId",
                work_project_id as "projectId", work_item_id as "itemId",
                baseline_start_date::text as "startDate", baseline_due_at as "dueAt",
                captured_at as "capturedAt" from public.work_item_baseline
              where work_project_id = ${input.projectId}::uuid
            `);
        const baselineByItem = new Map(
          baselines.map((item) => [item.itemId, item]),
        );
        const criticalItemIds = criticalPath(
          items.map((item) => ({
            itemId: item.itemId,
            durationMinutes:
              item.estimatedMinutes ??
              (item.startDate && item.dueAt
                ? Math.max(
                    1,
                    Math.ceil(
                      (new Date(item.dueAt).getTime() -
                        new Date(`${item.startDate}T00:00:00Z`).getTime()) /
                        60_000,
                    ),
                  )
                : 480),
            dependencies: dependencies
              .filter((edge) => edge.itemId === item.itemId)
              .map((edge) => edge.dependsOnItemId),
          })),
        );
        return {
          items: items.map((item) => {
            const baseline = baselineByItem.get(item.itemId);
            return {
              ...item,
              dueAt: iso(item.dueAt),
              completedAt: iso(item.completedAt),
              baseline: baseline ?? null,
              scheduleVarianceDays:
                baseline?.dueAt && item.dueAt
                  ? Math.round(
                      (new Date(item.dueAt).getTime() -
                        new Date(baseline.dueAt).getTime()) /
                        86_400_000,
                    )
                  : null,
            };
          }),
          dependencies,
          criticalItemIds,
        };
      }),
    captureBaseline: staffProcedure
      .input(z.object({ projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        const employeeId = actor(ctx);
        const capturedAt = new Date().toISOString();
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          for (const [id, baseline] of store.baselines)
            if (baseline.projectId === input.projectId)
              store.baselines.delete(id);
          for (const item of store.items.values()) {
            if (item.projectId !== input.projectId) continue;
            const baseline: WorkBaseline = {
              baselineId: randomUUID(),
              projectId: input.projectId,
              itemId: item.itemId,
              startDate: item.startDate,
              dueAt: item.dueAt,
              capturedAt,
            };
            store.baselines.set(baseline.baselineId, baseline);
          }
        } else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              delete from public.work_item_baseline
              where work_project_id = ${input.projectId}::uuid
            `);
            await tx.execute(sql`
              insert into public.work_item_baseline (
                work_project_id, work_item_id, baseline_start_date,
                baseline_due_at, captured_by_employee_id, captured_at
              ) select membership.work_project_id, item.work_item_id,
                item.start_date, item.due_at, ${employeeId}::uuid,
                ${capturedAt}::timestamptz
              from public.work_project_item membership
              join public.work_item item
                on item.work_item_id = membership.work_item_id
              where membership.work_project_id = ${input.projectId}::uuid
                and item.archived_at is null
            `);
          });
        await audit(
          ctx,
          "work.gantt.baseline",
          "work_project",
          input.projectId,
          {
            capturedAt,
          },
        );
        return { ok: true as const, capturedAt };
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

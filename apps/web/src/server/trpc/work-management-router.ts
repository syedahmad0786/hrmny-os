import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import {
  featureEnabled,
  listFeatureOverrides,
  resolveFeatureCatalog,
} from "../features";
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
  type WorkFormAttachmentAnswer,
  type WorkFormQuestion,
  type WorkRuleAction,
  type WorkRuleBranch,
} from "../work-workflows";
import {
  buildWorkReportChart,
  capacityUtilization,
  criticalPath,
  splitTimerByUtcDay,
  weightedProgress,
  type WorkReportChartRow,
  type WorkReportChartSpec,
} from "../work-planning";
import { validateDailyMinutes } from "../shifts-timesheets";
import { queueWorkAiStudioEvent } from "../work-ai-studio-events";
import { workMentionEmployeeIds } from "../../lib/work-rich-text";
import {
  queueAssignedWorkAiTeammate,
  queueMentionedWorkAiTeammates,
} from "../work-ai-teammate-events";
import { isDemoWorkAiActor, workAiContextForEmployee } from "../work-ai-actor";
import {
  createCallerFactory,
  publicProcedure,
  router,
  staffProcedure,
  type TrpcContext,
} from "./trpc";

type AccessLevel = "admin" | "editor" | "commenter" | "viewer";
type CustomTaskTypeAccessLevel = "admin" | "editor" | "user" | "none";
type WorkProject = {
  projectId: string;
  name: string;
  description: string;
  color: string;
  privacy: "organization" | "private";
  clientId: string | null;
  ownerEmployeeId: string | null;
  ownerName?: string | null;
  health?: "on_track" | "at_risk" | "off_track" | "complete" | null;
  sourcePlatform: "native" | "asana";
  projectKind?: "standard" | "personal";
  accessLevel: AccessLevel;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  hourlyCostRate?: number | null;
  teamIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
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
  customTaskTypeId?: string | null;
  customTaskStatusOptionId?: string | null;
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
  sourcePlatform?: "native" | "asana";
  externalId?: string | null;
};
type WorkCustomTaskStatusOption = {
  statusOptionId: string;
  customTaskTypeId: string;
  name: string;
  color: string;
  completionState: "incomplete" | "complete";
  enabled: boolean;
  position: number;
};
type WorkCustomTaskType = {
  customTaskTypeId: string;
  ownerProjectId: string | null;
  name: string;
  icon: string;
  sourcePlatform: "native" | "asana";
  defaultAccessLevel: CustomTaskTypeAccessLevel;
  statuses: WorkCustomTaskStatusOption[];
};
type WorkCustomTaskTypeMember = {
  customTaskTypeId: string;
  memberType: "employee" | "team";
  memberId: string;
  accessLevel: Exclude<CustomTaskTypeAccessLevel, "none">;
};
type WorkProjectCustomTaskType = {
  projectId: string;
  customTaskTypeId: string;
  isDefault: boolean;
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
type WorkProofAnnotation = {
  annotationId: string;
  attachmentId: string;
  itemId: string;
  xPosition: number;
  yPosition: number;
  pageNumber: number | null;
  createdByEmployeeId: string;
  createdAt: string;
};
type WorkOutOfOffice = {
  outOfOfficeId: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  note: string;
  createdAt: string;
  updatedAt: string;
};
type WorkAccessibilityPreference = {
  employeeId: string;
  theme: "system" | "light" | "dark";
  colorblindMode: boolean;
  reducedMotion: boolean;
  updatedAt: string;
};
type WorkMyTasksSection = {
  sectionId: string;
  employeeId: string;
  name: string;
  position: number;
  createdAt: string;
};
type WorkMyTasksMembership = {
  employeeId: string;
  itemId: string;
  sectionId: string;
  position: number;
};
type WorkMyTasksFocus = {
  employeeId: string;
  weekStart: string;
  focusText: string;
  updatedAt: string;
};
type WorkNotification = {
  notificationId: string;
  itemId: string | null;
  projectId: string | null;
  messageId: string | null;
  eventType: string;
  message: string;
  readAt: string | null;
  createdAt: string;
};
type WorkMessage = {
  messageId: string;
  projectId: string | null;
  teamId: string | null;
  subject: string;
  body: string;
  isAnnouncement: boolean;
  createdByEmployeeId: string;
  authorName: string;
  createdAt: string;
  commentCount: number;
  likeCount: number;
  likedByMe: boolean;
  following: boolean;
};
type WorkMessageComment = {
  messageCommentId: string;
  messageId: string;
  authorEmployeeId: string;
  authorName: string;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
};
type WorkLikeTarget =
  | "item"
  | "comment"
  | "attachment"
  | "status_update"
  | "message"
  | "message_comment";
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
  accessLevel: "organization" | "anyone" | "deactivated";
  createdByEmployeeId: string;
};
type WorkRule = {
  ruleId: string;
  projectId: string;
  ownerEmployeeId?: string;
  name: string;
  triggerType:
    | "task_added"
    | "task_completed"
    | "task_moved"
    | "priority_changed"
    | "due_date_set"
    | "approval_decided"
    | "custom_status_changed"
    | "collaborator_added"
    | "scheduled";
  scheduleMinutes: number | null;
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
type WorkExternalRuleEvent = {
  eventId: string;
  projectId: string;
  itemId: string;
  message: string;
  taskTitle: string;
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
  installedProjectCount?: number;
  currentProjectCount?: number;
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
  ownerName?: string | null;
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
  ownerName?: string | null;
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
  visibility: "private" | "organization";
  viewerEmployeeIds: string[];
  currentAccess: "admin" | "viewer";
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
  customTaskTypes: Map<string, WorkCustomTaskType>;
  projectCustomTaskTypes: Map<string, WorkProjectCustomTaskType>;
  customTaskTypeMembers: Map<string, WorkCustomTaskTypeMember>;
  attachments: Map<string, WorkAttachment>;
  proofAnnotations: Map<string, WorkProofAnnotation>;
  outOfOffice: Map<string, WorkOutOfOffice>;
  accessibility: Map<string, WorkAccessibilityPreference>;
  myTasksSections: Map<string, WorkMyTasksSection>;
  myTasksMemberships: Map<string, WorkMyTasksMembership>;
  myTasksFocus: Map<string, WorkMyTasksFocus>;
  notifications: Map<
    string,
    WorkNotification & { recipientEmployeeId: string }
  >;
  messages: Map<string, WorkMessage>;
  messageComments: Map<string, WorkMessageComment>;
  likes: Map<string, Set<string>>;
  savedSearches: Map<string, WorkSavedSearch>;
  forms: Map<string, WorkForm>;
  formSubmissions: Map<
    string,
    {
      formId: string;
      itemId: string;
      answers: Record<string, unknown>;
      submittedByEmployeeId: string | null;
      submittedAt: string;
    }
  >;
  rules: Map<string, WorkRule>;
  ruleRuns: Map<string, WorkRuleRun>;
  externalRuleEvents: Map<string, WorkExternalRuleEvent>;
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
  projectRates: Map<string, number>;
  dashboards: Map<string, WorkDashboard>;
  baselines: Map<string, WorkBaseline>;
};

const DEMO_PROJECT_ID = "a1000000-0000-4000-8000-000000000001";
const DEMO_SECTION_TODO = "a2000000-0000-4000-8000-000000000001";
const DEMO_SECTION_DOING = "a2000000-0000-4000-8000-000000000002";
const myTasksMembershipKey = (employeeId: string, itemId: string) =>
  `${employeeId}:${itemId}`;
const customTaskTypeProjectKey = (
  projectId: string,
  customTaskTypeId: string,
) => `${projectId}:${customTaskTypeId}`;
const customTaskTypeMemberKey = (
  customTaskTypeId: string,
  memberType: WorkCustomTaskTypeMember["memberType"],
  memberId: string,
) => `${customTaskTypeId}:${memberType}:${memberId}`;
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
    customTaskTypes: new Map(),
    projectCustomTaskTypes: new Map(),
    customTaskTypeMembers: new Map(),
    attachments: new Map(),
    proofAnnotations: new Map(),
    outOfOffice: new Map(),
    accessibility: new Map(),
    myTasksSections: new Map(),
    myTasksMemberships: new Map(),
    myTasksFocus: new Map(),
    notifications: new Map(),
    messages: new Map(),
    messageComments: new Map(),
    likes: new Map(),
    savedSearches: new Map(),
    forms: new Map(),
    formSubmissions: new Map(),
    rules: new Map(),
    ruleRuns: new Map(),
    externalRuleEvents: new Map(),
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
    projectRates: new Map(),
    dashboards: new Map(),
    baselines: new Map(),
  };
  return demoWork;
}

function validateCustomTaskStatuses(
  statuses: Array<z.infer<typeof customTaskStatusInput>>,
) {
  if (
    new Set(statuses.map((status) => status.name.toLowerCase())).size !==
    statuses.length
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Custom task status names must be unique",
    });
  if (!statuses.some((status) => status.completionState === "incomplete"))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add at least one incomplete status",
    });
  if (!statuses.some((status) => status.completionState === "complete"))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Add at least one complete status",
    });
}

function applyDemoDefaultCustomTaskType(item: WorkItem) {
  const store = getDemoWork();
  const association = [...store.projectCustomTaskTypes.values()].find(
    (candidate) =>
      candidate.projectId === item.projectId && candidate.isDefault,
  );
  const type = association
    ? store.customTaskTypes.get(association.customTaskTypeId)
    : null;
  const status = type?.statuses.find(
    (candidate) =>
      candidate.enabled && candidate.completionState === "incomplete",
  );
  if (type && status && item.itemType === "task") {
    item.customTaskTypeId = type.customTaskTypeId;
    item.customTaskStatusOptionId = status.statusOptionId;
  }
}

function validateCustomTaskStatusUpdate(
  statuses: Array<z.infer<typeof customTaskStatusInput>>,
  existing: Array<{ statusOptionId: string; name: string }>,
) {
  const existingIds = new Set(existing.map((status) => status.statusOptionId));
  if (
    statuses.some(
      (status) =>
        status.statusOptionId && !existingIds.has(status.statusOptionId),
    )
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Custom task status does not belong to this type",
    });
  const selectedIds = new Set(
    statuses.flatMap((status) =>
      status.statusOptionId ? [status.statusOptionId] : [],
    ),
  );
  const existingByName = new Map(
    existing.map((status) => [
      status.name.toLowerCase(),
      status.statusOptionId,
    ]),
  );
  if (
    statuses.some((status) => {
      const collision = existingByName.get(status.name.toLowerCase());
      return (
        collision &&
        collision !== status.statusOptionId &&
        !selectedIds.has(collision)
      );
    })
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Re-enable the existing status before reusing its name",
    });
}

function syncDemoCustomTaskCompletion(item: WorkItem, completed: boolean) {
  if (!item.customTaskTypeId) return;
  const status = getDemoWork()
    .customTaskTypes.get(item.customTaskTypeId)
    ?.statuses.find(
      (candidate) =>
        candidate.enabled &&
        candidate.completionState === (completed ? "complete" : "incomplete"),
    );
  if (status) item.customTaskStatusOptionId = status.statusOptionId;
}

const accessRank: Record<AccessLevel, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  admin: 3,
};
const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const customTaskStatusInput = z.object({
  statusOptionId: uuid.optional(),
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  completionState: z.enum(["incomplete", "complete"]),
});
const messageScopeSchema = z
  .object({ projectId: uuid.optional(), teamId: uuid.optional() })
  .refine(
    (value) =>
      Number(Boolean(value.projectId)) + Number(Boolean(value.teamId)) === 1,
    {
      message: "Choose one project or team",
    },
  );
const likeTargetTypeSchema = z.enum([
  "item",
  "comment",
  "attachment",
  "status_update",
  "message",
  "message_comment",
]);
const outOfOfficeFields = {
  startDate: z.string().date(),
  endDate: z.string().date(),
  note: z.string().trim().max(500).default(""),
};
const validOutOfOfficeRange = <
  T extends { startDate: string; endDate: string },
>(
  value: T,
) => value.endDate >= value.startDate;
const outOfOfficeSchema = z
  .object(outOfOfficeFields)
  .refine(validOutOfOfficeRange, {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  });
const updateOutOfOfficeSchema = z
  .object({ outOfOfficeId: uuid, ...outOfOfficeFields })
  .refine(validOutOfOfficeRange, {
    path: ["endDate"],
    message: "End date must be on or after the start date",
  });
const workRuleTriggerSchema = z.enum([
  "task_added",
  "task_completed",
  "task_moved",
  "priority_changed",
  "due_date_set",
  "approval_decided",
  "custom_status_changed",
  "collaborator_added",
  "scheduled",
]);
const workRuleScheduleSchema = z
  .object({
    triggerType: workRuleTriggerSchema,
    scheduleMinutes: z
      .number()
      .int()
      .min(15)
      .max(525_600)
      .nullable()
      .default(null),
  })
  .superRefine((value, ctx) => {
    if (
      (value.triggerType === "scheduled") !==
      (value.scheduleMinutes !== null)
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scheduleMinutes"],
        message: "Scheduled rules require an interval",
      });
  });
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
    "attachment",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
  multiple: z.boolean().optional(),
  showWhen: z
    .object({
      key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      equals: z.union([z.string().max(200), z.boolean()]),
    })
    .optional(),
});
const formSubmissionSchema = z.object({
  formId: uuid,
  answers: z.record(z.string().max(64), z.unknown()),
});
const ruleConditionSchema = z
  .object({
    field: z.enum([
      "title",
      "priority",
      "completed",
      "sectionId",
      "itemType",
      "customTaskTypeId",
      "customTaskStatusOptionId",
    ]),
    operator: z.enum([
      "equals",
      "not_equals",
      "contains",
      "is_empty",
      "is_not_empty",
    ]),
    value: z.union([z.string().max(500), z.boolean(), z.null()]).optional(),
  })
  .superRefine((condition, ctx) => {
    if (
      ["customTaskTypeId", "customTaskStatusOptionId"].includes(
        condition.field,
      ) &&
      !["equals", "not_equals", "is_empty", "is_not_empty"].includes(
        condition.operator,
      )
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["operator"],
        message: "Custom task type conditions require an exact comparison",
      });
  });
const ruleActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set_priority"),
    value: z.enum(["low", "medium", "high", "urgent"]).nullable(),
  }),
  z.object({ type: z.literal("move_section"), sectionId: uuid }),
  z.object({ type: z.literal("assign"), employeeId: nullableUuid }),
  z.object({ type: z.literal("complete") }),
  z.object({
    type: z.literal("set_custom_task_status"),
    customTaskTypeId: uuid,
    statusOptionId: uuid,
  }),
  z.object({ type: z.literal("add_tag"), tagId: uuid }),
  z.object({
    type: z.literal("send_webhook"),
    message: z.string().trim().min(1).max(2000),
  }),
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
  clientId: nullableUuid.default(null),
  roles: z
    .array(
      z.object({
        roleId: uuid,
        name: z.string().trim().min(1).max(120),
      }),
    )
    .max(100)
    .default([]),
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
        assigneeRoleId: nullableUuid.default(null),
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
  customTaskTypes: z
    .array(
      z.object({
        customTaskTypeId: uuid,
        name: z.string().trim().min(1).max(120),
        icon: z.string().trim().min(1).max(16),
        sourcePlatform: z.enum(["native", "asana"]),
        isDefault: z.boolean(),
        statuses: z
          .array(
            z.object({
              statusOptionId: uuid,
              name: z.string().trim().min(1).max(120),
              color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
              completionState: z.enum(["incomplete", "complete"]),
              enabled: z.boolean(),
              position: z.number().int().min(0),
            }),
          )
          .min(2)
          .max(20),
      }),
    )
    .max(100)
    .default([]),
  rules: z
    .array(
      z
        .object({
          name: z.string().trim().min(1).max(160),
          triggerType: workRuleTriggerSchema,
          scheduleMinutes: z
            .number()
            .int()
            .min(15)
            .max(525_600)
            .nullable()
            .default(null),
          branches: z.array(ruleBranchSchema).min(1).max(20),
        })
        .superRefine((value, ctx) => {
          if (
            (value.triggerType === "scheduled") !==
            (value.scheduleMinutes !== null)
          )
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["scheduleMinutes"],
              message: "Scheduled rules require an interval",
            });
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

const reportChartSpecSchema = z
  .object({
    groupBy: z.enum([
      "completion",
      "assignee",
      "priority",
      "section",
      "task_type",
      "project",
      "custom_field",
    ]),
    metric: z.enum([
      "task_count",
      "estimated_minutes",
      "actual_minutes",
      "custom_field_sum",
      "custom_field_average",
    ]),
    completion: z.enum(["all", "complete", "incomplete"]),
    dueFrom: z.string().date().nullable(),
    dueTo: z.string().date().nullable(),
    includeSubtasks: z.boolean(),
    customFieldId: nullableUuid,
    metricCustomFieldKey: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .nullable()
      .optional(),
    assigneeEmployeeId: nullableUuid.optional(),
    priority: z.enum(["low", "medium", "high", "urgent"]).nullable().optional(),
    itemType: z.enum(["task", "milestone", "approval"]).nullable().optional(),
    subtasks: z.enum(["all", "exclude", "only"]).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dueFrom && value.dueTo && value.dueFrom > value.dueTo)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueTo"],
        message: "Due through must be on or after due from",
      });
    if (value.groupBy === "custom_field" && !value.customFieldId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["customFieldId"],
        message: "Choose a custom field to group by",
      });
    if (
      ["custom_field_sum", "custom_field_average"].includes(value.metric) &&
      !value.metricCustomFieldKey
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["metricCustomFieldKey"],
        message: "Choose a numeric custom field to measure",
      });
  });
const metadataReportSpecSchema = z
  .object({
    groupBy: z.enum([
      "project_health",
      "project_owner",
      "project_privacy",
      "project_source",
      "goal_status",
      "goal_owner",
      "goal_scope",
      "goal_time_period",
      "portfolio_health",
      "portfolio_owner",
      "portfolio_privacy",
    ]),
    ownerEmployeeId: nullableUuid.optional(),
    status: z
      .enum([
        "on_track",
        "at_risk",
        "off_track",
        "complete",
        "achieved",
        "dropped",
      ])
      .nullable()
      .optional(),
    privacy: z.enum(["organization", "private"]).nullable().optional(),
    sourcePlatform: z.enum(["native", "asana"]).nullable().optional(),
    scope: z.enum(["company", "team", "individual"]).nullable().optional(),
    timePeriod: z
      .string()
      .regex(/^Q[1-4] \d{4}$/)
      .nullable()
      .optional(),
    includeSubgoals: z.boolean().optional(),
    objectIds: z.array(uuid).max(500).optional(),
    teamId: nullableUuid.optional(),
    dateField: z.enum(["created", "start", "due"]).nullable().optional(),
    dateFrom: z.string().date().nullable().optional(),
    dateTo: z.string().date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.dateFrom || value.dateTo) && !value.dateField)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateField"],
        message: "Choose which date to filter",
      });
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dateTo"],
        message: "Date through must be on or after date from",
      });
  });
const dashboardConfigSchema = z
  .object({
    reportType: z.enum(["tasks", "projects", "goals", "portfolios"]).optional(),
    projectId: uuid.optional(),
    portfolioId: uuid.optional(),
    chartStyle: z.enum(["bar", "donut", "number"]).optional(),
    spec: z.union([reportChartSpecSchema, metadataReportSpecSchema]).optional(),
  })
  .catchall(z.unknown())
  .superRefine((value, ctx) => {
    const reportType = value.reportType ?? "tasks";
    if (
      (reportType === "tasks" &&
        Boolean(value.projectId) === Boolean(value.portfolioId)) ||
      (reportType === "projects" && Boolean(value.projectId)) ||
      ((reportType === "goals" || reportType === "portfolios") &&
        Boolean(value.projectId || value.portfolioId))
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "Choose a valid reporting scope",
      });
    if (!value.spec) {
      if (reportType !== "tasks")
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["spec"],
          message: "Choose how to group this report",
        });
      return;
    }
    const groupBy = value.spec.groupBy;
    const valid =
      reportType === "tasks"
        ? !groupBy.includes("_") ||
          ["task_type", "custom_field"].includes(groupBy)
        : groupBy.startsWith(`${reportType.slice(0, -1)}_`);
    if (!valid)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spec", "groupBy"],
        message: "Group does not match the report type",
      });
    if (reportType === "tasks" || "metric" in value.spec) return;
    const metadata = value.spec;
    const invalidStatus =
      metadata.status &&
      (reportType === "goals"
        ? !["on_track", "at_risk", "off_track", "achieved", "dropped"].includes(
            metadata.status,
          )
        : !["on_track", "at_risk", "off_track", "complete"].includes(
            metadata.status,
          ));
    const invalidFields =
      (reportType !== "projects" && metadata.sourcePlatform) ||
      (reportType !== "projects" && metadata.teamId) ||
      (reportType === "portfolios" &&
        metadata.dateField &&
        metadata.dateField !== "created") ||
      (reportType !== "goals" &&
        (metadata.scope ||
          metadata.timePeriod ||
          metadata.includeSubgoals !== undefined)) ||
      (reportType === "goals" && metadata.privacy);
    if (invalidStatus || invalidFields)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["spec"],
        message: "Filter does not match the report type",
      });
  });

function actor(ctx: TrpcContext): string {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

const customTaskTypeAccessRank: Record<CustomTaskTypeAccessLevel, number> = {
  none: 0,
  user: 1,
  editor: 2,
  admin: 3,
};

export async function customTaskTypeAccess(
  ctx: TrpcContext,
  customTaskTypeId: string,
) {
  const employeeId = actor(ctx);
  const db = getDb();
  if (!db) {
    const type = getDemoWork().customTaskTypes.get(customTaskTypeId);
    if (!type) throw new TRPCError({ code: "NOT_FOUND" });
    return (
      getDemoWork().customTaskTypeMembers.get(
        customTaskTypeMemberKey(customTaskTypeId, "employee", employeeId),
      )?.accessLevel ?? type.defaultAccessLevel
    );
  }
  const [row] = await db.execute<{
    defaultAccessLevel: CustomTaskTypeAccessLevel;
    employeeAccessLevel: Exclude<CustomTaskTypeAccessLevel, "none"> | null;
    teamAccessLevel: Exclude<CustomTaskTypeAccessLevel, "none"> | null;
  }>(sql`
    select type.default_access_level as "defaultAccessLevel",
      employee_access.access_level as "employeeAccessLevel",
      team_access.access_level as "teamAccessLevel"
    from public.work_custom_task_type type
    left join public.work_custom_task_type_member employee_access
      on employee_access.work_custom_task_type_id = type.work_custom_task_type_id
      and employee_access.member_type = 'employee'
      and employee_access.employee_id = ${employeeId}::uuid
    left join lateral (
      select access.access_level
      from public.work_custom_task_type_member access
      join public.work_team_member team_member
        on team_member.work_team_id = access.work_team_id
      where access.work_custom_task_type_id = type.work_custom_task_type_id
        and access.member_type = 'team'
        and team_member.employee_id = ${employeeId}::uuid
      order by case access.access_level
        when 'admin' then 3 when 'editor' then 2 else 1 end desc
      limit 1
    ) team_access on true
    where type.work_custom_task_type_id = ${customTaskTypeId}::uuid
      and type.archived_at is null
  `);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return (
    row.employeeAccessLevel ?? row.teamAccessLevel ?? row.defaultAccessLevel
  );
}

async function requireCustomTaskTypeAccess(
  ctx: TrpcContext,
  customTaskTypeId: string,
  minimum: Exclude<CustomTaskTypeAccessLevel, "none"> = "user",
) {
  const accessLevel = await customTaskTypeAccess(ctx, customTaskTypeId);
  if (customTaskTypeAccessRank[accessLevel] < customTaskTypeAccessRank[minimum])
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${minimum} custom task type access required`,
    });
  return accessLevel;
}

function withOutOfOfficeStatus(period: WorkOutOfOffice) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    ...period,
    status:
      period.startDate > today
        ? ("upcoming" as const)
        : period.endDate < today
          ? ("past" as const)
          : ("active" as const),
  };
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
    if (
      project.projectKind === "personal" &&
      project.ownerEmployeeId !== employeeId
    )
      throw new TRPCError({ code: "NOT_FOUND" });
    if (ctx.requestedFeatureKey)
      await requireScopedFeature(ctx, ctx.requestedFeatureKey, projectId);
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
  if (ctx.requestedFeatureKey)
    await requireScopedFeature(ctx, ctx.requestedFeatureKey, projectId);
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

const PROOFING_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/bmp",
]);

export function isProofableAttachment(
  attachment: Pick<WorkAttachment, "name" | "contentType">,
) {
  return (
    PROOFING_CONTENT_TYPES.has(attachment.contentType?.toLowerCase() ?? "") ||
    /\.(?:pdf|png|jpe?g|gif|bmp)$/i.test(attachment.name)
  );
}

function isPdfAttachment(
  attachment: Pick<WorkAttachment, "name" | "contentType">,
) {
  return (
    attachment.contentType?.toLowerCase() === "application/pdf" ||
    /\.pdf$/i.test(attachment.name)
  );
}

async function attachmentById(
  ctx: TrpcContext,
  attachmentId: string,
  minimum: AccessLevel = "viewer",
): Promise<WorkAttachment> {
  const db = getDb();
  const attachment = !db
    ? getDemoWork().attachments.get(attachmentId)
    : (
        await db.execute<
          Omit<WorkAttachment, "createdAt" | "sizeBytes"> & {
            createdAt: Date | string;
            sizeBytes: string | number | null;
          }
        >(sql`
          select work_attachment_id as "attachmentId", work_item_id as "itemId",
            name, storage_path as "storagePath", external_url as "externalUrl",
            content_type as "contentType", size_bytes as "sizeBytes",
            created_at as "createdAt"
          from public.work_attachment
          where work_attachment_id = ${attachmentId}::uuid
        `)
      )[0];
  if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
  await requireItemAccess(ctx, attachment.itemId, minimum);
  return {
    ...attachment,
    sizeBytes:
      attachment.sizeBytes === null ? null : Number(attachment.sizeBytes),
    createdAt: new Date(attachment.createdAt).toISOString(),
  };
}

async function requireProofingFeatures(ctx: TrpcContext, projectId: string) {
  await Promise.all(
    ["work.proofing", "work.attachments", "work.subtasks", "work.tasks"].map(
      (featureKey) => requireScopedFeature(ctx, featureKey, projectId),
    ),
  );
}

type WorkMessageScope = { projectId: string | null; teamId: string | null };

async function requireMessageScope(
  ctx: TrpcContext,
  scope: WorkMessageScope,
  mode: "view" | "post" | "comment" = "view",
) {
  await requireScopedFeature(ctx, "work.project_messages", scope.projectId);
  if (scope.projectId) {
    await requireProjectAccess(
      ctx,
      scope.projectId,
      mode === "view" ? "viewer" : "commenter",
    );
    return;
  }
  if (!scope.teamId) throw new TRPCError({ code: "BAD_REQUEST" });
  const db = getDb();
  if (!db) throw new TRPCError({ code: "NOT_FOUND" });
  const [team] = await db.execute<{
    privacy: "public" | "request" | "private";
    role: "admin" | "member" | null;
    messageSendPermission: "admins" | "members";
  }>(sql`
    select team.privacy, membership.role,
      team.message_send_permission as "messageSendPermission"
    from public.work_team team
    left join public.work_team_member membership
      on membership.work_team_id = team.work_team_id
      and membership.employee_id = ${actor(ctx)}::uuid
    where team.work_team_id = ${scope.teamId}::uuid
      and team.archived_at is null
  `);
  if (!team || (mode === "view" && team.privacy !== "public" && !team.role))
    throw new TRPCError({ code: "NOT_FOUND" });
  if (mode === "comment" && !team.role)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Team membership required",
    });
  if (
    mode === "post" &&
    (!team.role ||
      (team.messageSendPermission === "admins" && team.role !== "admin"))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Team message permission denied",
    });
}

async function messageScopeById(
  ctx: TrpcContext,
  messageId: string,
  mode: "view" | "post" | "comment" = "view",
): Promise<WorkMessageScope> {
  const db = getDb();
  const scope = !db
    ? (() => {
        const message = getDemoWork().messages.get(messageId);
        return message
          ? { projectId: message.projectId, teamId: message.teamId }
          : null;
      })()
    : (
        await db.execute<WorkMessageScope>(sql`
          select work_project_id as "projectId", work_team_id as "teamId"
          from public.work_message
          where work_message_id = ${messageId}::uuid and archived_at is null
        `)
      )[0];
  if (!scope) throw new TRPCError({ code: "NOT_FOUND" });
  await requireMessageScope(ctx, scope, mode);
  return scope;
}

async function requireLikeTargetAccess(
  ctx: TrpcContext,
  targetType: WorkLikeTarget,
  targetId: string,
  write: boolean,
): Promise<string | null> {
  const minimum = write ? "commenter" : "viewer";
  if (targetType === "item") {
    const item = await requireItemAccess(ctx, targetId, minimum);
    return item.projectId;
  }
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    if (targetType === "comment") {
      const comment = store.comments.get(targetId);
      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      return (await requireItemAccess(ctx, comment.itemId, minimum)).projectId;
    } else if (targetType === "attachment") {
      const attachment = store.attachments.get(targetId);
      if (!attachment) throw new TRPCError({ code: "NOT_FOUND" });
      return (await requireItemAccess(ctx, attachment.itemId, minimum))
        .projectId;
    } else if (targetType === "status_update") {
      const update = store.statusUpdates.get(targetId);
      if (!update) throw new TRPCError({ code: "NOT_FOUND" });
      if (update.projectId)
        await requireProjectAccess(ctx, update.projectId, minimum);
      else if (update.portfolioId)
        await requirePortfolioAccess(ctx, update.portfolioId);
      else await requireGoalAccess(ctx, update.goalId!);
      return update.projectId;
    } else if (targetType === "message") {
      return (await messageScopeById(ctx, targetId, write ? "comment" : "view"))
        .projectId;
    } else {
      const comment = store.messageComments.get(targetId);
      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      return (
        await messageScopeById(
          ctx,
          comment.messageId,
          write ? "comment" : "view",
        )
      ).projectId;
    }
  }
  if (targetType === "comment" || targetType === "attachment") {
    const table =
      targetType === "comment"
        ? sql`public.work_comment`
        : sql`public.work_attachment`;
    const idColumn =
      targetType === "comment" ? sql`work_comment_id` : sql`work_attachment_id`;
    const [row] = await db.execute<{ itemId: string }>(sql`
      select work_item_id as "itemId" from ${table}
      where ${idColumn} = ${targetId}::uuid
    `);
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    return (await requireItemAccess(ctx, row.itemId, minimum)).projectId;
  }
  if (targetType === "status_update") {
    const [update] = await db.execute<{
      projectId: string | null;
      portfolioId: string | null;
      goalId: string | null;
    }>(sql`
      select work_project_id as "projectId",
        work_portfolio_id as "portfolioId", work_goal_id as "goalId"
      from public.work_status_update
      where work_status_update_id = ${targetId}::uuid
    `);
    if (!update) throw new TRPCError({ code: "NOT_FOUND" });
    if (update.projectId)
      await requireProjectAccess(ctx, update.projectId, minimum);
    else if (update.portfolioId)
      await requirePortfolioAccess(ctx, update.portfolioId);
    else await requireGoalAccess(ctx, update.goalId!);
    return update.projectId;
  }
  if (targetType === "message") {
    return (await messageScopeById(ctx, targetId, write ? "comment" : "view"))
      .projectId;
  }
  const [comment] = await db.execute<{ messageId: string }>(sql`
    select work_message_id as "messageId"
    from public.work_message_comment
    where work_message_comment_id = ${targetId}::uuid and deleted_at is null
  `);
  if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
  return (
    await messageScopeById(ctx, comment.messageId, write ? "comment" : "view")
  ).projectId;
}

async function requireLikeFeatures(
  ctx: TrpcContext,
  targetType: WorkLikeTarget,
  projectId: string | null,
) {
  const targetFeature =
    targetType === "item"
      ? "work.tasks"
      : targetType === "comment"
        ? "work.comments"
        : targetType === "attachment"
          ? "work.attachments"
          : targetType === "status_update"
            ? "work.status_updates"
            : "work.project_messages";
  await requireScopedFeature(ctx, targetFeature, projectId);
  await requireScopedFeature(ctx, "work.likes", projectId);
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
    const entries = [...store.timeEntries.values()].filter(
      (entry) => entry.projectId === projectId,
    );
    const actualMinutes = entries.reduce(
      (sum, entry) => sum + entry.minutes,
      0,
    );
    const remainingEstimatedMinutes = items
      .filter((item) => !item.completedAt)
      .reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
    const defaultRate = project.hourlyCostRate ?? 0;
    const rateFor = (employeeId: string | null) =>
      (employeeId
        ? store.projectRates.get(`${projectId}:${employeeId}`)
        : undefined) ?? defaultRate;
    const actualCost =
      Math.round(
        entries.reduce(
          (sum, entry) =>
            sum + (entry.minutes / 60) * rateFor(entry.employeeId),
          0,
        ) * 100,
      ) / 100;
    const remainingCost =
      Math.round(
        items
          .filter((item) => !item.completedAt)
          .reduce(
            (sum, item) =>
              sum +
              ((item.estimatedMinutes ?? 0) / 60) *
                rateFor(item.assigneeEmployeeId),
            0,
          ) * 100,
      ) / 100;
    const forecastCost = Math.round((actualCost + remainingCost) * 100) / 100;
    const budgetAmount = project.budgetAmount ?? null;
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
      budgetAmount,
      budgetCurrency: project.budgetCurrency ?? "AED",
      hourlyCostRate: project.hourlyCostRate ?? null,
      actualCost,
      forecastCost,
      variance: budgetAmount === null ? null : budgetAmount - forecastCost,
    };
  }
  const [settings, metrics, costs] = await Promise.all([
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
    db.execute<{
      actualCost: string | number;
      remainingCost: string | number;
    }>(sql`
      select coalesce((
        select round(sum(
          entry.minutes::numeric / 60 * coalesce(
            rate.hourly_cost_rate, project.hourly_cost_rate, 0
          )
        ), 2)
        from public.time_entry entry
        left join public.work_project_rate rate
          on rate.work_project_id = project.work_project_id
          and rate.employee_id = entry.employee_id
        where entry.work_project_id = project.work_project_id
      ), 0) as "actualCost",
      coalesce((
        select round(sum(
          coalesce(item.estimated_minutes, 0)::numeric / 60 * coalesce(
            rate.hourly_cost_rate, project.hourly_cost_rate, 0
          )
        ), 2)
        from public.work_project_item membership
        join public.work_item item
          on item.work_item_id = membership.work_item_id
        left join public.work_project_rate rate
          on rate.work_project_id = project.work_project_id
          and rate.employee_id = item.assignee_employee_id
        where membership.work_project_id = project.work_project_id
          and item.archived_at is null and item.completed_at is null
      ), 0) as "remainingCost"
      from public.work_project project
      where project.work_project_id = ${projectId}::uuid
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
  const actualCost = Number(costs[0]?.actualCost ?? 0);
  const forecastCost =
    Math.round((actualCost + Number(costs[0]?.remainingCost ?? 0)) * 100) / 100;
  return {
    projectId,
    name: project.name,
    progress: await projectProgress(projectId),
    ...metric,
    budgetAmount,
    budgetCurrency: setting.budgetCurrency,
    hourlyCostRate,
    actualCost,
    forecastCost,
    variance: budgetAmount === null ? null : budgetAmount - forecastCost,
  };
}

async function workloadForProjects(
  ctx: TrpcContext,
  projectIds: string[],
  weekStart: string,
) {
  if (!projectIds.length) return [];
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const employeeId = actor(ctx);
    const weekEnd = relativeDate(7, new Date(`${weekStart}T00:00:00Z`)).slice(
      0,
      10,
    );
    const allocations = [...store.allocations.values()].filter(
      (item) =>
        projectIds.includes(item.projectId) && item.weekStart === weekStart,
    );
    const allocatedMinutes = allocations
      .filter((item) => item.employeeId === employeeId)
      .reduce((sum, item) => sum + item.allocatedMinutes, 0);
    const assignedMinutes = [...store.items.values()]
      .filter(
        (item) =>
          projectIds.includes(item.projectId) &&
          item.assigneeEmployeeId === employeeId &&
          !item.completedAt &&
          item.dueAt &&
          item.dueAt.slice(0, 10) >= weekStart &&
          item.dueAt.slice(0, 10) < weekEnd,
      )
      .reduce((sum, item) => sum + (item.estimatedMinutes ?? 0), 0);
    return [
      {
        employeeId,
        displayName: "Dev Partner",
        capacityHours: 40,
        allocatedMinutes,
        assignedMinutes,
        actualMinutes: [...store.timeEntries.values()]
          .filter(
            (item) =>
              item.employeeId === employeeId &&
              projectIds.includes(item.projectId) &&
              item.workDate >= weekStart &&
              item.workDate < weekEnd,
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
          and allocation.work_project_id = any(${projectIds}::uuid[])
          and allocation.week_start = ${weekStart}::date), 0)::int
        as "allocatedMinutes",
      coalesce((select sum(scoped.estimated_minutes) from (
        select distinct item.work_item_id, item.estimated_minutes
        from public.work_project_item membership
        join public.work_item item
          on item.work_item_id = membership.work_item_id
        where membership.work_project_id = any(${projectIds}::uuid[])
          and item.assignee_employee_id = employee.employee_id
          and item.completed_at is null
          and item.due_at >= ${weekStart}::date
          and item.due_at < ${weekStart}::date + interval '7 days'
      ) scoped), 0)::int as "assignedMinutes",
      coalesce((select sum(entry.minutes) from public.time_entry entry
        where entry.employee_id = employee.employee_id
          and entry.work_project_id = any(${projectIds}::uuid[])
          and entry.work_date >= ${weekStart}::date
          and entry.work_date < ${weekStart}::date + 7), 0)::int
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
  includeActor = false,
) {
  const employeeId = actor(ctx);
  const db = getDb();
  if (!db) {
    const store = getDemoWork();
    const item = store.items.get(itemId);
    const recipients = new Set(store.followers.get(itemId) ?? []);
    if (item?.assigneeEmployeeId) recipients.add(item.assigneeEmployeeId);
    if (!includeActor) recipients.delete(employeeId);
    for (const recipientEmployeeId of recipients) {
      const notificationId = randomUUID();
      store.notifications.set(notificationId, {
        notificationId,
        recipientEmployeeId,
        itemId,
        projectId: item?.projectId ?? null,
        messageId: null,
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
      and (${includeActor} or recipient.employee_id <> ${employeeId}::uuid)
  `);
}

async function addMentionedItemFollowers(
  ctx: TrpcContext,
  itemId: string,
  projectId: string,
  value: string,
) {
  if (
    !(await featureEnabled("work.rich_text", {
      userId: ctx.employeeId,
      clientId: await projectClientId(projectId),
      roles: ctx.roles,
    }))
  )
    return;
  const employeeIds = workMentionEmployeeIds(value);
  if (!employeeIds.length) return;
  const db = getDb();
  if (!db) {
    const followers = getDemoWork().followers.get(itemId) ?? new Set<string>();
    for (const employeeId of employeeIds) followers.add(employeeId);
    getDemoWork().followers.set(itemId, followers);
    return;
  }
  await db.execute(sql`
    insert into public.work_item_follower (work_item_id, employee_id)
    select ${itemId}::uuid, employee.employee_id
    from unnest(string_to_array(${employeeIds.join(",")}, ',')::uuid[])
      mention(employee_id)
    join public.employee employee on employee.employee_id = mention.employee_id
      and employee.is_active = true
    on conflict do nothing
  `);
}

async function notifyStatusUpdate(ctx: TrpcContext, update: WorkStatusUpdate) {
  const employeeId = actor(ctx);
  const db = getDb();
  if (!db) return;
  await db.execute(sql`
    insert into public.work_notification (
      recipient_employee_id, actor_employee_id, work_project_id,
      event_type, message, payload
    )
    select distinct recipient.employee_id, ${employeeId}::uuid,
      ${update.projectId}::uuid, 'status_update',
      ${`Status update: ${update.title}`},
      jsonb_build_object('statusUpdateId', ${update.statusUpdateId}::text)
    from (
      select member.employee_id
      from public.work_project_member member
      where member.work_project_id = ${update.projectId}::uuid
      union
      select team_member.employee_id
      from public.work_team_project team_project
      join public.work_team_member team_member
        on team_member.work_team_id = team_project.work_team_id
      where team_project.work_project_id = ${update.projectId}::uuid
      union
      select project.owner_employee_id
      from public.work_project project
      where project.work_project_id = ${update.projectId}::uuid
      union
      select portfolio.owner_employee_id
      from public.work_portfolio portfolio
      where portfolio.work_portfolio_id = ${update.portfolioId}::uuid
      union
      select goal.owner_employee_id
      from public.work_goal goal
      where goal.work_goal_id = ${update.goalId}::uuid
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
    syncDemoCustomTaskCompletion(generated, false);
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
    await queueAssignedWorkAiTeammate(
      ctx,
      generated.itemId,
      generated.assigneeEmployeeId,
      "A recurring task was created and assigned to you. Review it and propose the next useful actions.",
    );
    return generated.itemId;
  }

  const generated = await db.transaction(async (tx) => {
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
      customTaskTypeId: string | null;
      nextCustomTaskStatusOptionId: string | null;
    }>(sql`
      select title, description, item_type as "itemType", priority,
        assignee_employee_id as "assigneeEmployeeId",
        created_by_employee_id as "createdByEmployeeId",
        parent_work_item_id as "parentItemId", start_date as "startDate",
        due_at as "dueAt", recurrence,
        item.work_custom_task_type_id as "customTaskTypeId",
        next_status.work_custom_task_status_option_id as "nextCustomTaskStatusOptionId"
      from public.work_item item
      left join lateral (
        select status.work_custom_task_status_option_id
        from public.work_custom_task_status_option status
        where status.work_custom_task_type_id = item.work_custom_task_type_id
          and status.enabled and status.completion_state = 'incomplete'
        order by status.position, status.created_at limit 1
      ) next_status on true
      where item.work_item_id = ${itemId}::uuid and item.archived_at is null
      for update of item
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
    if (existing)
      return {
        itemId: existing.id,
        assigneeEmployeeId: source.assigneeEmployeeId,
        created: false,
      };

    const [created] = await tx.execute<{ id: string }>(sql`
      insert into public.work_item (
        parent_work_item_id, title, description, item_type, priority,
        assignee_employee_id, created_by_employee_id, start_date, due_at,
        recurrence, work_custom_task_type_id,
        work_custom_task_status_option_id
      ) values (
        ${source.parentItemId}::uuid, ${source.title}, ${source.description},
        ${source.itemType}, ${source.priority}, ${source.assigneeEmployeeId}::uuid,
        ${source.createdByEmployeeId}::uuid,
        case
          when ${source.startDate}::date is not null and ${source.dueAt}::timestamptz is not null
          then ${source.startDate}::date + (${dueAt}::date - ${source.dueAt}::date)
          else null
        end,
        ${dueAt}::timestamptz, ${JSON.stringify(parsed.data)}::jsonb,
        ${source.nextCustomTaskStatusOptionId ? source.customTaskTypeId : null}::uuid,
        ${source.nextCustomTaskStatusOptionId}::uuid
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
    return {
      itemId: generatedId,
      assigneeEmployeeId: source.assigneeEmployeeId,
      created: true,
    };
  });
  if (!generated) return null;
  if (generated.created)
    await queueAssignedWorkAiTeammate(
      ctx,
      generated.itemId,
      generated.assigneeEmployeeId,
      "A recurring task was created and assigned to you. Review it and propose the next useful actions.",
    );
  return generated.itemId;
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
      item.work_custom_task_type_id as "customTaskTypeId",
      item.work_custom_task_status_option_id as "customTaskStatusOptionId",
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

async function requireAssignableEmployee(
  ctx: TrpcContext,
  projectId: string,
  employeeId: string,
) {
  const db = getDb();
  if (!db) {
    if (employeeId === "c0000000-0000-4000-8000-000000000001") return;
    if (!isDemoWorkAiActor(employeeId))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Employee not found",
      });
    await requireScopedFeature(ctx, "work.ai.teammates", projectId);
    return;
  }
  const [employee] = await db.execute<{
    teammateId: string | null;
    teammateStatus: "active" | "paused" | null;
    hasMemberAccess: boolean;
    hasProjectAccess: boolean;
  }>(sql`
    select teammate.work_ai_teammate_id as "teammateId",
      teammate.status as "teammateStatus",
      coalesce(member.work_ai_teammate_member_id is not null, false)
        as "hasMemberAccess",
      coalesce(access.work_ai_teammate_project_access_id is not null, false)
        as "hasProjectAccess"
    from public.employee employee
    left join public.work_ai_teammate teammate
      on teammate.employee_id = employee.employee_id
      and teammate.archived_at is null
    left join public.work_ai_teammate_member member
      on member.work_ai_teammate_id = teammate.work_ai_teammate_id
      and member.employee_id = ${actor(ctx)}::uuid
    left join public.work_ai_teammate_project_access access
      on access.work_ai_teammate_id = teammate.work_ai_teammate_id
      and access.work_project_id = ${projectId}::uuid
    where employee.employee_id = ${employeeId}::uuid and employee.is_active = true
    limit 1
  `);
  if (!employee)
    throw new TRPCError({ code: "BAD_REQUEST", message: "Employee not found" });
  if (!employee.teammateId) return;
  await requireScopedFeature(ctx, "work.ai.teammates", projectId);
  if (
    employee.teammateStatus !== "active" ||
    !employee.hasMemberAccess ||
    !employee.hasProjectAccess
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "AI Teammate must be active and shared into this project",
    });
}

async function executeRuleAction(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
  action: WorkRuleAction,
) {
  if (action.type === "assign" && action.employeeId)
    await requireAssignableEmployee(ctx, projectId, action.employeeId);
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
      item.assigneeEmployeeId = action.employeeId;
      item.assigneeName = action.employeeId ? "Dev Partner" : null;
    } else if (action.type === "complete") {
      item.completedAt = new Date().toISOString();
      syncDemoCustomTaskCompletion(item, true);
    } else if (action.type === "set_custom_task_status") {
      const association = store.projectCustomTaskTypes.get(
        customTaskTypeProjectKey(projectId, action.customTaskTypeId),
      );
      const status = store.customTaskTypes
        .get(action.customTaskTypeId)
        ?.statuses.find(
          (candidate) =>
            candidate.statusOptionId === action.statusOptionId &&
            candidate.enabled,
        );
      if (!association || !status) throw new Error("Task status not found");
      item.customTaskTypeId = action.customTaskTypeId;
      item.customTaskStatusOptionId = action.statusOptionId;
      item.completedAt =
        status.completionState === "complete"
          ? (item.completedAt ?? new Date().toISOString())
          : null;
    } else if (action.type === "add_tag") {
      if (!store.tags.has(action.tagId)) throw new Error("Tag not found");
      const tags = store.itemTags.get(itemId) ?? new Set<string>();
      tags.add(action.tagId);
      store.itemTags.set(itemId, tags);
    } else if (action.type === "send_webhook") {
      const eventId = randomUUID();
      store.externalRuleEvents.set(eventId, {
        eventId,
        projectId,
        itemId,
        message: action.message,
        taskTitle: item.title,
        createdAt: new Date().toISOString(),
      });
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
    if (action.type === "send_webhook") return;
    if (action.type === "complete") {
      const enabled = await featureEnabled("work.recurring_tasks", {
        userId: ctx.employeeId,
        clientId: await projectClientId(projectId),
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
  } else if (action.type === "set_custom_task_status") {
    const updated = await db.execute(sql`
      update public.work_item item set
        work_custom_task_type_id = ${action.customTaskTypeId}::uuid,
        work_custom_task_status_option_id = ${action.statusOptionId}::uuid,
        completed_at = case when status.completion_state = 'complete'
          then coalesce(item.completed_at, now()) else null end,
        updated_at = now()
      from public.work_custom_task_status_option status
      where item.work_item_id = ${itemId}::uuid and item.item_type = 'task'
        and status.work_custom_task_type_id = ${action.customTaskTypeId}::uuid
        and status.work_custom_task_status_option_id = ${action.statusOptionId}::uuid
        and status.enabled
        and exists (
          select 1 from public.work_project_custom_task_type association
          where association.work_project_id = ${projectId}::uuid
            and association.work_custom_task_type_id = ${action.customTaskTypeId}::uuid
        )
      returning item.work_item_id
    `);
    if (!updated[0]) throw new Error("Task status not found");
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
  } else if (action.type === "send_webhook") {
    const task = await ruleSnapshot(itemId, projectId);
    await db.execute(sql`
      select public.enqueue_work_webhook_event(
        ${projectId}::uuid, 'rule.triggered', 'task', ${itemId}::uuid,
        ${JSON.stringify({
          message: action.message,
          taskTitle: task.title,
          assigneeEmployeeId: task.assigneeEmployeeId,
          dueAt: task.dueAt,
        })}::jsonb
      )
    `);
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
  if (action.type === "send_webhook") return;
  if (action.type === "complete") {
    const enabled = await featureEnabled("work.recurring_tasks", {
      userId: ctx.employeeId,
      clientId: await projectClientId(projectId),
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
  if (action.type === "assign")
    await queueAssignedWorkAiTeammate(ctx, itemId, action.employeeId);
}

async function validateRuleActions(
  projectId: string,
  actions: readonly WorkRuleAction[],
  ctx?: TrpcContext,
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
      if (action.type === "set_custom_task_status") {
        const association = store.projectCustomTaskTypes.get(
          customTaskTypeProjectKey(projectId, action.customTaskTypeId),
        );
        const status = store.customTaskTypes
          .get(action.customTaskTypeId)
          ?.statuses.find(
            (candidate) =>
              candidate.statusOptionId === action.statusOptionId &&
              candidate.enabled,
          );
        if (!association || !status)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Task status not found",
          });
        if (ctx)
          await requireCustomTaskTypeAccess(ctx, action.customTaskTypeId);
      }
      if (
        action.type === "assign" &&
        action.employeeId &&
        !ctx &&
        action.employeeId !== "c0000000-0000-4000-8000-000000000001" &&
        !isDemoWorkAiActor(action.employeeId)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Employee not found",
        });
      if (action.type === "assign" && action.employeeId && ctx)
        await requireAssignableEmployee(ctx, projectId, action.employeeId);
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
    } else if (action.type === "set_custom_task_status") {
      const rows = await db.execute(sql`
        select 1 from public.work_project_custom_task_type association
        join public.work_custom_task_status_option status
          on status.work_custom_task_type_id = association.work_custom_task_type_id
          and status.work_custom_task_status_option_id = ${action.statusOptionId}::uuid
          and status.enabled
        where association.work_project_id = ${projectId}::uuid
          and association.work_custom_task_type_id = ${action.customTaskTypeId}::uuid
      `);
      if (!rows[0])
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Task status not found",
        });
      if (ctx) await requireCustomTaskTypeAccess(ctx, action.customTaskTypeId);
    } else if (action.type === "assign" && action.employeeId) {
      if (ctx)
        await requireAssignableEmployee(ctx, projectId, action.employeeId);
      else {
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
}

async function validateCustomTaskRuleCondition(
  projectId: string,
  condition: WorkRuleBranch["conditions"][number],
  ctx?: TrpcContext,
) {
  if (
    !["customTaskTypeId", "customTaskStatusOptionId"].includes(
      condition.field,
    ) ||
    ["is_empty", "is_not_empty"].includes(condition.operator)
  )
    return;
  if (
    typeof condition.value !== "string" ||
    !uuid.safeParse(condition.value).success
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Custom task type condition is invalid",
    });
  const db = getDb();
  const customTaskTypeId = !db
    ? condition.field === "customTaskTypeId"
      ? getDemoWork().projectCustomTaskTypes.has(
          customTaskTypeProjectKey(projectId, condition.value),
        )
        ? condition.value
        : null
      : ([...getDemoWork().projectCustomTaskTypes.values()].find(
          (association) =>
            association.projectId === projectId &&
            getDemoWork()
              .customTaskTypes.get(association.customTaskTypeId)
              ?.statuses.some(
                (status) =>
                  status.statusOptionId === condition.value && status.enabled,
              ),
        )?.customTaskTypeId ?? null)
    : (
        await db.execute<{ customTaskTypeId: string }>(sql`
            select association.work_custom_task_type_id as "customTaskTypeId"
            from public.work_project_custom_task_type association
            ${
              condition.field === "customTaskStatusOptionId"
                ? sql`join public.work_custom_task_status_option status
                    on status.work_custom_task_type_id = association.work_custom_task_type_id
                    and status.work_custom_task_status_option_id = ${condition.value}::uuid
                    and status.enabled`
                : sql``
            }
            where association.work_project_id = ${projectId}::uuid
              ${
                condition.field === "customTaskTypeId"
                  ? sql`and association.work_custom_task_type_id = ${condition.value}::uuid`
                  : sql``
              }
            limit 1
          `)
      )[0]?.customTaskTypeId;
  if (!customTaskTypeId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Custom task type condition is not available in this project",
    });
  if (ctx) await requireCustomTaskTypeAccess(ctx, customTaskTypeId);
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

async function projectClientId(projectId: string): Promise<string | null> {
  const db = getDb();
  if (!db) return getDemoWork().projects.get(projectId)?.clientId ?? null;
  const [project] = await db.execute<{ clientId: string | null }>(sql`
    select client_id as "clientId" from public.work_project
    where work_project_id = ${projectId}::uuid and archived_at is null
  `);
  return project?.clientId ?? null;
}

async function requireScopedFeature(
  ctx: TrpcContext,
  featureKey: string,
  projectId: string | null,
) {
  if (
    !(await featureEnabled(featureKey, {
      userId: ctx.workBundleRollout ? undefined : ctx.employeeId,
      clientId: projectId ? await projectClientId(projectId) : ctx.clientId,
      roles: ctx.workBundleRollout ? undefined : ctx.roles,
    }))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `FEATURE_DISABLED:${featureKey}`,
    });
}

async function requireProjectCustomField(
  ctx: TrpcContext,
  projectId: string,
  customFieldId: string,
) {
  await requireScopedFeature(ctx, "work.custom_fields", projectId);
  const db = getDb();
  const field = !db
    ? getDemoWork().customFields.get(customFieldId)
    : (
        await db.execute<{ customFieldId: string; projectId: string }>(sql`
          select work_custom_field_id as "customFieldId",
            work_project_id as "projectId"
          from public.work_custom_field
          where work_custom_field_id = ${customFieldId}::uuid
            and work_project_id = ${projectId}::uuid
          limit 1
        `)
      )[0];
  if (!field || field.projectId !== projectId)
    throw new TRPCError({ code: "NOT_FOUND" });
}

type NumericReportField = {
  key: string;
  name: string;
  fieldIds: string[];
  projectIds: string[];
};

async function numericReportFields(
  ctx: TrpcContext,
  projectIds: string[],
  strictProject: boolean,
): Promise<NumericReportField[]> {
  if (!projectIds.length) return [];
  if (strictProject)
    await requireScopedFeature(ctx, "work.custom_fields", projectIds[0]!);
  else await requireScopedFeature(ctx, "work.custom_fields", null);
  const enabledProjectIds = (
    await Promise.all(
      projectIds.map(async (projectId) => ({
        projectId,
        enabled: await featureEnabled("work.custom_fields", {
          userId: ctx.employeeId,
          clientId: await projectClientId(projectId),
          roles: ctx.roles,
        }),
      })),
    )
  ).flatMap(({ projectId, enabled }) => (enabled ? [projectId] : []));
  if (!enabledProjectIds.length) return [];
  const db = getDb();
  const fields: WorkCustomField[] = !db
    ? [...getDemoWork().customFields.values()].filter(
        (field) =>
          enabledProjectIds.includes(field.projectId) &&
          field.fieldType === "number",
      )
    : await db.execute<WorkCustomField>(sql`
        select work_custom_field_id as "customFieldId",
          work_project_id as "projectId", name, field_type as "fieldType",
          options, is_required as "isRequired", position,
          source_platform as "sourcePlatform", external_id as "externalId"
        from public.work_custom_field
        where work_project_id = any(${enabledProjectIds}::uuid[])
          and field_type = 'number'
        order by lower(name), work_custom_field_id
      `);
  const grouped = new Map<string, NumericReportField>();
  for (const field of fields) {
    const key =
      field.sourcePlatform === "asana" && field.externalId
        ? `asana:${field.externalId}`
        : `field:${field.customFieldId}`;
    const group = grouped.get(key) ?? {
      key,
      name: field.name,
      fieldIds: [],
      projectIds: [],
    };
    group.fieldIds.push(field.customFieldId);
    if (!group.projectIds.includes(field.projectId))
      group.projectIds.push(field.projectId);
    grouped.set(key, group);
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveNumericReportFieldIds(
  ctx: TrpcContext,
  projectIds: string[],
  key: string,
  strictProject: boolean,
) {
  const field = (
    await numericReportFields(ctx, projectIds, strictProject)
  ).find((candidate) => candidate.key === key);
  if (!field) throw new TRPCError({ code: "NOT_FOUND" });
  return field.fieldIds;
}

async function requireDashboardAccess(
  ctx: TrpcContext,
  config: Record<string, unknown>,
) {
  const reportType =
    config.reportType === "projects" ||
    config.reportType === "goals" ||
    config.reportType === "portfolios"
      ? config.reportType
      : "tasks";
  const projectId = config.projectId;
  const portfolioId = config.portfolioId;
  if (reportType === "goals") {
    if (typeof projectId === "string" || typeof portfolioId === "string")
      throw new TRPCError({ code: "NOT_FOUND" });
    await requireScopedFeature(ctx, "work.goals", null);
  } else if (reportType === "portfolios") {
    if (typeof projectId === "string" || typeof portfolioId === "string")
      throw new TRPCError({ code: "NOT_FOUND" });
    await requireScopedFeature(ctx, "work.portfolios", null);
  } else if (reportType === "projects") {
    if (typeof projectId === "string")
      throw new TRPCError({ code: "NOT_FOUND" });
    await requireScopedFeature(ctx, "work.projects", null);
    if (typeof portfolioId === "string") {
      await requireScopedFeature(ctx, "work.portfolios", null);
      await requirePortfolioAccess(ctx, portfolioId);
    }
  } else {
    if ((typeof projectId === "string") === (typeof portfolioId === "string"))
      throw new TRPCError({ code: "NOT_FOUND" });
    if (typeof projectId === "string")
      await requireProjectAccess(ctx, projectId);
    else {
      await requireScopedFeature(ctx, "work.portfolios", null);
      await requirePortfolioAccess(ctx, portfolioId as string);
    }
  }
  const spec = config.spec;
  if (
    reportType !== "tasks" &&
    spec &&
    typeof spec === "object" &&
    Array.isArray((spec as Record<string, unknown>).objectIds)
  ) {
    const objectIds = (spec as Record<string, unknown>).objectIds as unknown[];
    for (const objectId of objectIds) {
      if (typeof objectId !== "string")
        throw new TRPCError({ code: "NOT_FOUND" });
      if (reportType === "projects") {
        await requireProjectAccess(ctx, objectId);
        await requireScopedFeature(ctx, "work.projects", objectId);
      } else if (reportType === "goals") await requireGoalAccess(ctx, objectId);
      else await requirePortfolioAccess(ctx, objectId);
    }
  }
  if (
    reportType === "projects" &&
    spec &&
    typeof spec === "object" &&
    typeof (spec as Record<string, unknown>).teamId === "string"
  ) {
    await requireScopedFeature(ctx, "work.teams", null);
    const objectIds = (spec as Record<string, unknown>).objectIds;
    if (Array.isArray(objectIds))
      for (const projectId of objectIds)
        if (typeof projectId === "string")
          await requireScopedFeature(ctx, "work.teams", projectId);
  }
  if (
    (reportType === "projects" || reportType === "portfolios") &&
    spec &&
    typeof spec === "object" &&
    (String((spec as Record<string, unknown>).groupBy).endsWith("_health") ||
      typeof (spec as Record<string, unknown>).status === "string")
  )
    await requireScopedFeature(ctx, "work.status_updates", null);
  if (
    spec &&
    typeof spec === "object" &&
    (spec as Record<string, unknown>).groupBy === "custom_field"
  ) {
    if (typeof projectId !== "string")
      throw new TRPCError({ code: "NOT_FOUND" });
    const customFieldId = (spec as Record<string, unknown>).customFieldId;
    if (typeof customFieldId !== "string")
      throw new TRPCError({ code: "NOT_FOUND" });
    await requireProjectCustomField(ctx, projectId, customFieldId);
  }
  if (reportType === "tasks" && typeof projectId === "string")
    await requireScopedFeature(ctx, "work.tasks", projectId);
  if (reportType === "tasks" && spec && typeof spec === "object") {
    const metric = String((spec as Record<string, unknown>).metric);
    if (["custom_field_sum", "custom_field_average"].includes(metric)) {
      const key = (spec as Record<string, unknown>).metricCustomFieldKey;
      if (typeof key !== "string") throw new TRPCError({ code: "NOT_FOUND" });
      const projectIds =
        typeof projectId === "string"
          ? [projectId]
          : await portfolioReportingProjectIds(ctx, portfolioId as string);
      await resolveNumericReportFieldIds(
        ctx,
        projectIds,
        key,
        typeof projectId === "string",
      );
    }
    if (typeof projectId === "string") {
      const itemType = (spec as Record<string, unknown>).itemType;
      if (itemType === "milestone" || itemType === "approval")
        await requireScopedFeature(ctx, `work.${itemType}s`, projectId);
      if (["estimated_minutes", "actual_minutes"].includes(metric))
        await requireScopedFeature(ctx, "work.time_tracking", projectId);
    }
  }
  return projectId ?? portfolioId ?? reportType;
}

async function portfolioReportingProjectIds(
  ctx: TrpcContext,
  portfolioId: string,
) {
  await requireScopedFeature(ctx, "work.portfolios", null);
  await requirePortfolioAccess(ctx, portfolioId);
  const db = getDb();
  const projectIds = !db
    ? [...(getDemoWork().portfolioProjects.get(portfolioId) ?? [])]
    : (
        await db.execute<{ projectId: string }>(sql`
          select work_project_id as "projectId"
          from public.work_portfolio_project
          where work_portfolio_id = ${portfolioId}::uuid
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
  return accessible;
}

async function reportRowsForProjects(
  ctx: TrpcContext,
  projectIds: string[],
  spec: WorkReportChartSpec,
  metricCustomFieldIds: string[] = [],
): Promise<WorkReportChartRow[]> {
  if (!projectIds.length) return [];
  const available = new Map<
    string,
    {
      tasks: boolean;
      milestones: boolean;
      approvals: boolean;
      timeTracking: boolean;
      customFields: boolean;
    }
  >();
  await Promise.all(
    projectIds.map(async (projectId) => {
      const scope = {
        userId: ctx.employeeId,
        clientId: await projectClientId(projectId),
        roles: ctx.roles,
      };
      const tasks = await featureEnabled("work.tasks", scope);
      available.set(projectId, {
        tasks,
        milestones: tasks && (await featureEnabled("work.milestones", scope)),
        approvals: tasks && (await featureEnabled("work.approvals", scope)),
        timeTracking:
          tasks && (await featureEnabled("work.time_tracking", scope)),
        customFields:
          tasks && (await featureEnabled("work.custom_fields", scope)),
      });
    }),
  );
  const enabledProjectIds = (
    key: "tasks" | "milestones" | "approvals" | "timeTracking" | "customFields",
  ) => projectIds.filter((projectId) => available.get(projectId)?.[key]);
  const taskProjectIds = enabledProjectIds("tasks");
  const milestoneProjectIds = enabledProjectIds("milestones");
  const approvalProjectIds = enabledProjectIds("approvals");
  const timeProjectIds = enabledProjectIds("timeTracking");
  const customFieldProjectIds = enabledProjectIds("customFields");
  const customMetric = ["custom_field_sum", "custom_field_average"].includes(
    spec.metric,
  );
  const timeMetric = ["estimated_minutes", "actual_minutes"].includes(
    spec.metric,
  );
  const db = getDb();
  const rows: WorkReportChartRow[] = !db
    ? (() => {
        const store = getDemoWork();
        return [...store.items.values()]
          .filter((item) => {
            const enabled = available.get(item.projectId);
            return (
              enabled?.tasks === true &&
              (!timeMetric || enabled.timeTracking) &&
              (!customMetric || enabled.customFields) &&
              (item.itemType === "task" ||
                (item.itemType === "milestone" && enabled.milestones) ||
                (item.itemType === "approval" && enabled.approvals))
            );
          })
          .map((item) => ({
            itemId: item.itemId,
            projectId: item.projectId,
            parentItemId: item.parentItemId,
            itemType: item.itemType,
            priority: item.priority,
            assigneeEmployeeId: item.assigneeEmployeeId,
            assigneeName: item.assigneeName,
            sectionName: item.sectionId
              ? (store.sections.get(item.sectionId)?.name ?? null)
              : null,
            projectName: store.projects.get(item.projectId)?.name ?? "Project",
            dueAt: item.dueAt,
            completedAt: item.completedAt,
            estimatedMinutes: item.estimatedMinutes ?? null,
            actualMinutes: [...store.timeEntries.values()]
              .filter(
                (entry) =>
                  timeProjectIds.includes(entry.projectId) &&
                  entry.itemId === item.itemId,
              )
              .reduce((sum, entry) => sum + entry.minutes, 0),
            customFieldValue: spec.customFieldId
              ? store.customFieldValues.get(
                  `${item.itemId}:${spec.customFieldId}`,
                )
              : undefined,
            metricCustomFieldValue: (() => {
              const fieldId = metricCustomFieldIds.find(
                (id) =>
                  store.customFields.get(id)?.projectId === item.projectId,
              );
              return fieldId
                ? store.customFieldValues.get(`${item.itemId}:${fieldId}`)
                : undefined;
            })(),
          }));
      })()
    : (
        await db.execute<
          Omit<WorkReportChartRow, "dueAt" | "completedAt"> & {
            dueAt: Date | string | null;
            completedAt: Date | string | null;
          }
        >(sql`
      select distinct on (item.work_item_id)
        item.work_item_id as "itemId",
        membership.work_project_id as "projectId",
        item.parent_work_item_id as "parentItemId",
        item.item_type as "itemType", item.priority,
        item.assignee_employee_id as "assigneeEmployeeId",
        employee.display_name as "assigneeName",
        section.name as "sectionName", project.name as "projectName",
        item.due_at as "dueAt", item.completed_at as "completedAt",
        item.estimated_minutes as "estimatedMinutes",
        custom_value.value as "customFieldValue",
        metric_custom_value.value as "metricCustomFieldValue",
        coalesce((select sum(entry.minutes)
          from public.time_entry entry
          where entry.work_project_id = any(${timeProjectIds}::uuid[])
            and entry.work_item_id = item.work_item_id), 0)::int
          as "actualMinutes"
      from public.work_project_item membership
      join public.work_project project
        on project.work_project_id = membership.work_project_id
      join public.work_item item
        on item.work_item_id = membership.work_item_id
      left join public.employee employee
        on employee.employee_id = item.assignee_employee_id
      left join public.work_section section
        on section.work_section_id = membership.work_section_id
      left join public.work_custom_field_value custom_value
        on custom_value.work_item_id = item.work_item_id
        and custom_value.work_custom_field_id = ${spec.customFieldId}::uuid
      left join lateral (
        select value.value
        from public.work_custom_field_value value
        join public.work_custom_field field
          on field.work_custom_field_id = value.work_custom_field_id
          and field.work_project_id = membership.work_project_id
        where value.work_item_id = item.work_item_id
          and value.work_custom_field_id = any(${metricCustomFieldIds}::uuid[])
        order by array_position(
          ${metricCustomFieldIds}::uuid[], value.work_custom_field_id
        )
        limit 1
      ) metric_custom_value on true
      where membership.work_project_id = any(${projectIds}::uuid[])
        and item.archived_at is null
        and (${!timeMetric}
          or membership.work_project_id = any(${timeProjectIds}::uuid[]))
        and (${!customMetric}
          or membership.work_project_id = any(${customFieldProjectIds}::uuid[]))
        and (
          (item.item_type = 'task'
            and membership.work_project_id = any(${taskProjectIds}::uuid[]))
          or (item.item_type = 'milestone'
            and membership.work_project_id = any(${milestoneProjectIds}::uuid[]))
          or (item.item_type = 'approval'
            and membership.work_project_id = any(${approvalProjectIds}::uuid[]))
        )
      order by item.work_item_id,
        array_position(${projectIds}::uuid[], membership.work_project_id)
    `)
      ).map((item) => ({
        ...item,
        dueAt: iso(item.dueAt),
        completedAt: iso(item.completedAt),
        estimatedMinutes: Number(item.estimatedMinutes ?? 0),
        actualMinutes: Number(item.actualMinutes),
      }));
  return rows;
}

function notificationFeatureKey(eventType: string) {
  if (eventType === "message") return "work.project_messages";
  if (eventType === "status_update") return "work.status_updates";
  if (eventType === "commented") return "work.comments";
  if (eventType === "followed") return "work.followers";
  return "work.tasks";
}

async function notificationFeatureEnabled(
  ctx: TrpcContext,
  eventType: string,
  projectId: string | null,
  featureClientId?: string | null,
  cache?: Map<string, Promise<boolean>>,
) {
  const featureKey = notificationFeatureKey(eventType);
  const clientId =
    featureClientId !== undefined
      ? featureClientId
      : projectId
        ? await projectClientId(projectId)
        : ctx.clientId;
  const cacheKey = `${featureKey}:${clientId ?? ""}`;
  const cached = cache?.get(cacheKey);
  if (cached) return cached;
  const result = featureEnabled(featureKey, {
    userId: ctx.employeeId,
    clientId,
    roles: ctx.roles,
  });
  cache?.set(cacheKey, result);
  return result;
}

async function visibleDemoNotification(
  ctx: TrpcContext,
  notification: WorkNotification,
  featureCache: Map<string, Promise<boolean>>,
) {
  try {
    if (notification.messageId)
      await messageScopeById(ctx, notification.messageId);
    else if (notification.itemId)
      await requireItemAccess(ctx, notification.itemId);
    else if (notification.projectId)
      await requireProjectAccess(ctx, notification.projectId);
    return notificationFeatureEnabled(
      ctx,
      notification.eventType,
      notification.projectId,
      undefined,
      featureCache,
    );
  } catch (error) {
    if (
      error instanceof TRPCError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN")
    )
      return false;
    throw error;
  }
}

function ruleTriggerFeatureKey(
  triggerType: WorkRule["triggerType"],
):
  | "work.rules.scheduled"
  | "work.rules.collaborator_trigger"
  | "work.custom_task_types"
  | null {
  if (triggerType === "scheduled") return "work.rules.scheduled";
  if (triggerType === "collaborator_added")
    return "work.rules.collaborator_trigger";
  if (triggerType === "custom_status_changed") return "work.custom_task_types";
  return null;
}

function ruleUsesCustomTaskTypes(
  rule: Pick<WorkRule, "triggerType" | "branches">,
) {
  return (
    rule.triggerType === "custom_status_changed" ||
    rule.branches.some(
      (branch) =>
        branch.conditions.some((condition) =>
          ["customTaskTypeId", "customTaskStatusOptionId"].includes(
            condition.field,
          ),
        ) ||
        branch.actions.some(
          (action) => action.type === "set_custom_task_status",
        ),
    )
  );
}

function ruleUsesExternalActions(rule: Pick<WorkRule, "branches">) {
  return rule.branches.some((branch) =>
    branch.actions.some((action) => action.type === "send_webhook"),
  );
}

async function requireExternalRuleFeatures(
  ctx: TrpcContext,
  projectId: string,
) {
  await Promise.all([
    requireScopedFeature(ctx, "work.rules.external_actions", projectId),
    requireScopedFeature(ctx, "work.api_webhooks", projectId),
  ]);
}

async function requireRuleTriggerFeature(
  ctx: TrpcContext,
  projectId: string,
  triggerType: WorkRule["triggerType"],
) {
  const featureKey = ruleTriggerFeatureKey(triggerType);
  if (
    featureKey &&
    !(await featureEnabled(featureKey, {
      userId: ctx.workBundleRollout ? undefined : ctx.employeeId,
      clientId: await projectClientId(projectId),
      roles: ctx.workBundleRollout ? undefined : ctx.roles,
    }))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `FEATURE_DISABLED:${featureKey}`,
    });
}

async function runProjectRules(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
  triggerType: WorkRule["triggerType"],
  onlyRuleId?: string,
) {
  const scope = {
    userId: ctx.employeeId,
    clientId: await projectClientId(projectId),
    roles: ctx.roles,
  };
  const triggerFeatureKey = ruleTriggerFeatureKey(triggerType);
  const customTaskTypesEnabled = await featureEnabled(
    "work.custom_task_types",
    scope,
  );
  const externalActionsEnabled =
    (await featureEnabled("work.rules.external_actions", scope)) &&
    (await featureEnabled("work.api_webhooks", scope));
  if (triggerType === "custom_status_changed" && !customTaskTypesEnabled)
    return;
  if (triggerType !== "collaborator_added" && triggerType !== "scheduled")
    await queueWorkAiStudioEvent(ctx, projectId, itemId, triggerType);
  if (
    !(await featureEnabled("work.rules", scope)) ||
    (triggerFeatureKey && !(await featureEnabled(triggerFeatureKey, scope)))
  ) {
    return;
  }
  const db = getDb();
  const rules = !db
    ? [...getDemoWork().rules.values()].filter(
        (rule) =>
          rule.projectId === projectId &&
          rule.triggerType === triggerType &&
          (!onlyRuleId || rule.ruleId === onlyRuleId) &&
          rule.isEnabled,
      )
    : await db.execute<WorkRule & { branches: unknown }>(sql`
        select work_rule_id as "ruleId", work_project_id as "projectId",
          name, trigger_type as "triggerType",
          schedule_minutes as "scheduleMinutes", branches,
          is_enabled as "isEnabled"
        from public.work_rule
        where work_project_id = ${projectId}::uuid
          and trigger_type = ${triggerType} and is_enabled = true
          and (${onlyRuleId ?? null}::uuid is null
            or work_rule_id = ${onlyRuleId ?? null}::uuid)
        order by created_at
      `);
  const item = await ruleSnapshot(itemId, projectId);
  const snapshot = {
    title: item.title,
    priority: item.priority,
    completed: Boolean(item.completedAt),
    sectionId: item.sectionId,
    itemType: item.itemType,
    customTaskTypeId: item.customTaskTypeId ?? null,
    customTaskStatusOptionId: item.customTaskStatusOptionId ?? null,
  };
  for (const candidate of rules) {
    const parsed = z.array(ruleBranchSchema).safeParse(candidate.branches);
    const rule = { ...candidate, branches: parsed.success ? parsed.data : [] };
    if (!customTaskTypesEnabled && ruleUsesCustomTaskTypes(rule)) continue;
    if (!externalActionsEnabled && ruleUsesExternalActions(rule)) continue;
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

const scheduledWorkRuleJobSchema = z.object({
  ruleId: uuid,
  actorEmployeeId: uuid,
});

export async function runScheduledWorkRuleJob(input: unknown) {
  const payload = scheduledWorkRuleJobSchema.parse(input);
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL missing");
  const [rule] = await db.execute<{
    ruleId: string;
    projectId: string;
    scheduleMinutes: number;
  }>(sql`
    select rule.work_rule_id as "ruleId",
      rule.work_project_id as "projectId",
      rule.schedule_minutes as "scheduleMinutes"
    from public.work_rule rule
    join public.work_project project
      on project.work_project_id = rule.work_project_id
      and project.archived_at is null
    join public.employee owner
      on owner.employee_id = rule.owner_employee_id and owner.is_active = true
    where rule.work_rule_id = ${payload.ruleId}::uuid
      and rule.owner_employee_id = ${payload.actorEmployeeId}::uuid
      and rule.trigger_type = 'scheduled' and rule.is_enabled = true
      and rule.schedule_minutes is not null
  `);
  if (!rule) return { recurring: false, tasksEvaluated: 0 };
  const roles = await db.execute<{ key: string }>(sql`
    select role.key from public.employee_role membership
    join public.role role on role.role_id = membership.role_id
    where membership.employee_id = ${payload.actorEmployeeId}::uuid
  `);
  const ctx: TrpcContext = {
    user: null,
    employeeId: payload.actorEmployeeId,
    roles: roles.map((role) => role.key),
    canViewMargin: false,
  };
  const scope = {
    userId: ctx.employeeId,
    clientId: await projectClientId(rule.projectId),
    roles: ctx.roles,
  };
  const [enabled, scheduleEnabled] = await Promise.all([
    featureEnabled("work.rules", scope),
    featureEnabled("work.rules.scheduled", scope),
  ]);
  if (!enabled || !scheduleEnabled)
    return {
      recurring: true,
      scheduleMinutes: Number(rule.scheduleMinutes),
      tasksEvaluated: 0,
      disabled: true,
    };
  const items = await db.execute<{ itemId: string }>(sql`
    select distinct item.work_item_id as "itemId"
    from public.work_project_item membership
    join public.work_item item on item.work_item_id = membership.work_item_id
    where membership.work_project_id = ${rule.projectId}::uuid
      and item.archived_at is null
    order by item.work_item_id
  `);
  for (const item of items)
    await runProjectRules(
      ctx,
      rule.projectId,
      item.itemId,
      "scheduled",
      rule.ruleId,
    );
  return {
    recurring: true,
    scheduleMinutes: Number(rule.scheduleMinutes),
    tasksEvaluated: items.length,
  };
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
      customTaskTypes: [...store.projectCustomTaskTypes.values()]
        .filter((association) => association.projectId === projectId)
        .flatMap((association) => {
          const type = store.customTaskTypes.get(association.customTaskTypeId);
          return type
            ? [
                {
                  customTaskTypeId: type.customTaskTypeId,
                  name: type.name,
                  icon: type.icon,
                  sourcePlatform: type.sourcePlatform,
                  isDefault: association.isDefault,
                  statuses: type.statuses.map(
                    ({ customTaskTypeId: _customTaskTypeId, ...status }) =>
                      status,
                  ),
                },
              ]
            : [];
        }),
      rules: [...store.rules.values()]
        .filter((rule) => rule.projectId === projectId)
        .map(({ name, triggerType, scheduleMinutes, branches }) => ({
          name,
          triggerType,
          scheduleMinutes,
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
  const [sections, customFields, customTaskTypeRows, rules, templates] =
    await Promise.all([
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
        customTaskTypeId: string;
        name: string;
        icon: string;
        sourcePlatform: "native" | "asana";
        isDefault: boolean;
        statusOptionId: string;
        statusName: string;
        color: string;
        completionState: "incomplete" | "complete";
        enabled: boolean;
        position: number;
      }>(sql`
      select type.work_custom_task_type_id as "customTaskTypeId",
        type.name, type.icon, type.source_platform as "sourcePlatform",
        association.is_default as "isDefault",
        status.work_custom_task_status_option_id as "statusOptionId",
        status.name as "statusName", status.color,
        status.completion_state as "completionState",
        status.enabled, status.position
      from public.work_project_custom_task_type association
      join public.work_custom_task_type type
        on type.work_custom_task_type_id = association.work_custom_task_type_id
        and type.archived_at is null
      join public.work_custom_task_status_option status
        on status.work_custom_task_type_id = type.work_custom_task_type_id
      where association.work_project_id = ${projectId}::uuid
      order by lower(type.name), status.position, status.created_at
    `),
      db.execute<{
        name: string;
        triggerType: WorkRule["triggerType"];
        scheduleMinutes: number | null;
        branches: unknown;
      }>(sql`
      select name, trigger_type as "triggerType",
        schedule_minutes as "scheduleMinutes", branches
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
  const customTaskTypes = new Map<
    string,
    z.infer<typeof bundleBlueprintSchema>["customTaskTypes"][number]
  >();
  for (const row of customTaskTypeRows) {
    const type = customTaskTypes.get(row.customTaskTypeId) ?? {
      customTaskTypeId: row.customTaskTypeId,
      name: row.name,
      icon: row.icon,
      sourcePlatform: row.sourcePlatform,
      isDefault: row.isDefault,
      statuses: [],
    };
    type.statuses.push({
      statusOptionId: row.statusOptionId,
      name: row.statusName,
      color: row.color,
      completionState: row.completionState,
      enabled: row.enabled,
      position: row.position,
    });
    customTaskTypes.set(row.customTaskTypeId, type);
  }
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
    customTaskTypes: [...customTaskTypes.values()],
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

async function requireBundleCustomTaskTypeAccess(
  ctx: TrpcContext,
  projectId: string,
  blueprint: z.infer<typeof bundleBlueprintSchema>,
) {
  if (!blueprint.customTaskTypes.length) return;
  await requireScopedFeature(ctx, "work.custom_task_types", projectId);
  if (ctx.workBundleRollout) return;
  await Promise.all(
    blueprint.customTaskTypes.map((type) =>
      requireCustomTaskTypeAccess(ctx, type.customTaskTypeId),
    ),
  );
}

async function workFormById(formId: string): Promise<WorkForm | null> {
  const db = getDb();
  if (!db) return getDemoWork().forms.get(formId) ?? null;
  const [raw] = await db.execute<WorkForm & { questions: unknown }>(sql`
    select work_form_id as "formId", work_project_id as "projectId",
      work_section_id as "sectionId", name, description,
      title_question_key as "titleQuestionKey", questions,
      default_assignee_employee_id as "defaultAssigneeEmployeeId",
      confirmation_message as "confirmationMessage", is_active as "isActive",
      access_level as "accessLevel",
      created_by_employee_id as "createdByEmployeeId"
    from public.work_form where work_form_id = ${formId}::uuid
  `);
  if (!raw) return null;
  const questions = z.array(formQuestionSchema).safeParse(raw.questions);
  return questions.success ? { ...raw, questions: questions.data } : null;
}

function formAttachments(
  questions: readonly WorkFormQuestion[],
  answers: Record<string, unknown>,
  itemId: string,
) {
  const files = questions.flatMap((question) =>
    question.type === "attachment"
      ? ((answers[question.key] ?? []) as WorkFormAttachmentAnswer[])
      : [],
  );
  if (files.length > 10)
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: "A submission can include up to 10 files",
    });
  let totalBytes = 0;
  return files.map((file) => {
    const body = Buffer.from(file.contentBase64, "base64");
    totalBytes += body.byteLength;
    if (body.byteLength > 10_000_000 || totalBytes > 25_000_000)
      throw new TRPCError({
        code: "PAYLOAD_TOO_LARGE",
        message: "Files are limited to 10 MB each and 25 MB per submission",
      });
    const attachmentId = randomUUID();
    const safeName = file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    return {
      attachment: {
        attachmentId,
        itemId,
        name: file.fileName,
        storagePath: `work/${itemId}/${attachmentId}-${safeName}`,
        externalUrl: null,
        contentType: file.contentType,
        sizeBytes: body.byteLength,
        createdAt: new Date().toISOString(),
      } satisfies WorkAttachment,
      body: new Uint8Array(body),
    };
  });
}

async function submitWorkForm(
  ctx: TrpcContext,
  input: { formId: string; answers: Record<string, unknown> },
  publicSubmission: boolean,
) {
  const raw = await workFormById(input.formId);
  if (!raw) throw new TRPCError({ code: "NOT_FOUND" });
  if (publicSubmission) {
    if (raw.accessLevel !== "anyone" || !raw.isActive)
      throw new TRPCError({ code: "NOT_FOUND" });
    await Promise.all([
      requireScopedFeature(ctx, "work.forms", raw.projectId),
      requireScopedFeature(ctx, "work.forms.public", raw.projectId),
    ]);
  } else {
    await requireProjectAccess(ctx, raw.projectId);
    if (raw.accessLevel === "deactivated" || !raw.isActive)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Form is unavailable",
      });
  }
  let answers: Record<string, unknown>;
  try {
    answers = normalizeFormAnswers(raw.questions, input.answers);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Answers are invalid",
    });
  }
  const title = answers[raw.titleQuestionKey];
  if (typeof title !== "string" || !title.trim())
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Task title is required",
    });
  let executionCtx = ctx;
  if (publicSubmission) {
    try {
      executionCtx = await workAiContextForEmployee(raw.createdByEmployeeId);
    } catch {
      executionCtx = {
        ...ctx,
        employeeId: raw.createdByEmployeeId,
        roles: [],
      };
    }
    executionCtx.clientId = await projectClientId(raw.projectId);
  }
  if (raw.defaultAssigneeEmployeeId)
    await requireAssignableEmployee(
      executionCtx,
      raw.projectId,
      raw.defaultAssigneeEmployeeId,
    );
  const description = raw.questions
    .flatMap((question) => {
      const answer = answers[question.key];
      if (answer === undefined) return [];
      const value =
        question.type === "attachment"
          ? (answer as WorkFormAttachmentAnswer[])
              .map((file) => file.fileName)
              .join(", ")
          : Array.isArray(answer)
            ? answer.join(", ")
            : String(answer);
      return [`${question.label}: ${value}`];
    })
    .join("\n");
  const itemId = randomUUID();
  const submissionId = randomUUID();
  const submittedByEmployeeId = publicSubmission ? null : actor(ctx);
  const createdByEmployeeId = submittedByEmployeeId ?? raw.createdByEmployeeId;
  const attachments = formAttachments(raw.questions, answers, itemId);
  const storedPaths: string[] = [];
  try {
    for (const { attachment, body } of attachments) {
      await getDemoStore().objectStore.put({
        path: attachment.storagePath!,
        body,
        contentType: attachment.contentType!,
      });
      storedPaths.push(attachment.storagePath!);
    }
    const db = getDb();
    if (!db) {
      if (publicSubmission) {
        const recent = [...getDemoWork().formSubmissions.values()].filter(
          (submission) =>
            submission.formId === raw.formId &&
            submission.submittedByEmployeeId === null &&
            Date.now() - new Date(submission.submittedAt).getTime() < 60_000,
        );
        if (recent.length >= 30)
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message: "Please wait before submitting again",
          });
      }
      getDemoWork().items.set(itemId, {
        itemId,
        parentItemId: null,
        title: title.trim(),
        description,
        itemType: "task",
        priority: null,
        assigneeEmployeeId: raw.defaultAssigneeEmployeeId,
        assigneeName: raw.defaultAssigneeEmployeeId ? "Assigned user" : null,
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
        submittedByEmployeeId,
        submittedAt: new Date().toISOString(),
      });
      for (const { attachment } of attachments)
        getDemoWork().attachments.set(attachment.attachmentId, attachment);
    } else {
      await db.transaction(async (tx) => {
        if (publicSubmission) {
          const accepted = await tx.execute(sql`
            insert into public.work_form_public_rate_limit (
              work_form_id, window_started_at, request_count
            ) values (${raw.formId}::uuid, now(), 1)
            on conflict (work_form_id) do update set
              window_started_at = case
                when work_form_public_rate_limit.window_started_at
                  <= now() - interval '1 minute' then now()
                else work_form_public_rate_limit.window_started_at end,
              request_count = case
                when work_form_public_rate_limit.window_started_at
                  <= now() - interval '1 minute' then 1
                else work_form_public_rate_limit.request_count + 1 end,
              updated_at = now()
            where work_form_public_rate_limit.window_started_at
                <= now() - interval '1 minute'
              or work_form_public_rate_limit.request_count < 30
            returning request_count
          `);
          if (!accepted[0])
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Please wait before submitting again",
            });
        }
        await tx.execute(sql`
          insert into public.work_item (
            work_item_id, title, description, item_type,
            assignee_employee_id, created_by_employee_id
          ) values (
            ${itemId}::uuid, ${title.trim()}, ${description}, 'task',
            ${raw.defaultAssigneeEmployeeId}::uuid,
            ${createdByEmployeeId}::uuid
          )
        `);
        await tx.execute(sql`
          insert into public.work_project_item (
            work_project_id, work_item_id, work_section_id, position
          ) values (
            ${raw.projectId}::uuid, ${itemId}::uuid, ${raw.sectionId}::uuid,
            (select coalesce(max(position), -1) + 1
             from public.work_project_item
             where work_project_id = ${raw.projectId}::uuid)
          )
        `);
        await tx.execute(sql`
          insert into public.work_form_submission (
            work_form_submission_id, work_form_id, submitted_by_employee_id,
            answers, work_item_id
          ) values (
            ${submissionId}::uuid, ${raw.formId}::uuid,
            ${submittedByEmployeeId}::uuid,
            ${JSON.stringify(answers)}::jsonb, ${itemId}::uuid
          )
        `);
        for (const { attachment } of attachments)
          await tx.execute(sql`
            insert into public.work_attachment (
              work_attachment_id, work_item_id, name, storage_path,
              content_type, size_bytes, uploaded_by_employee_id
            ) values (
              ${attachment.attachmentId}::uuid, ${itemId}::uuid,
              ${attachment.name}, ${attachment.storagePath},
              ${attachment.contentType}, ${attachment.sizeBytes},
              ${submittedByEmployeeId}::uuid
            )
          `);
      });
    }
  } catch (error) {
    await Promise.all(
      storedPaths.map((path) => getDemoStore().objectStore.remove?.(path)),
    );
    throw error;
  }
  await writeAudit({
    actorEmployeeId: submittedByEmployeeId,
    action: "work.form.submit",
    entityType: "work_form_submission",
    entityId: submissionId,
    before: null,
    after: { formId: raw.formId, itemId, publicSubmission },
    reason: null,
  });
  if (raw.defaultAssigneeEmployeeId) {
    await notifyItem(
      executionCtx,
      itemId,
      "assigned",
      `Assigned: ${title.trim()}`,
      publicSubmission,
    );
    await queueAssignedWorkAiTeammate(
      executionCtx,
      itemId,
      raw.defaultAssigneeEmployeeId,
      "A form submission created this task and assigned it to you. Review the request and propose the next useful actions.",
    );
  }
  await runProjectRules(executionCtx, raw.projectId, itemId, "task_added");
  return {
    submissionId,
    itemId,
    message: raw.confirmationMessage,
  };
}

export const workManagementRouter = router({
  projects: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      const visibleProjects = async (projects: WorkProject[]) =>
        (
          await Promise.all(
            projects.map(async (project) => {
              const featureScope = {
                userId: ctx.employeeId,
                clientId: project.clientId,
                roles: ctx.roles,
              };
              if (!(await featureEnabled("work.projects", featureScope)))
                return null;
              const latest = !db
                ? [...getDemoWork().statusUpdates.values()]
                    .filter((item) => item.projectId === project.projectId)
                    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
                : null;
              return {
                ...project,
                ownerName:
                  project.ownerName ??
                  (project.ownerEmployeeId === employeeId
                    ? (ctx.user?.displayName ?? "You")
                    : project.ownerEmployeeId
                      ? "Member"
                      : null),
                health: (await featureEnabled(
                  "work.status_updates",
                  featureScope,
                ))
                  ? (project.health ?? latest?.health ?? "on_track")
                  : null,
                teamIds: (await featureEnabled("work.teams", featureScope))
                  ? (project.teamIds ?? [])
                  : [],
              };
            }),
          )
        ).filter((project) => project !== null);
      if (!db)
        return visibleProjects(
          [...getDemoWork().projects.values()].filter(
            (project) => project.projectKind !== "personal",
          ),
        );
      const rows = await db.execute<WorkProject>(sql`
        select project.work_project_id as "projectId", project.name,
          project.description, project.color, project.privacy,
          project.client_id as "clientId",
          project.owner_employee_id as "ownerEmployeeId",
          owner.display_name as "ownerName", latest_status.health,
          project.source_platform as "sourcePlatform",
          project.start_date::text as "startDate",
          project.due_date::text as "dueDate",
          coalesce((
            select array_agg(team_project.work_team_id order by team_project.work_team_id)
            from public.work_team_project team_project
            where team_project.work_project_id = project.work_project_id
          ), array[]::uuid[]) as "teamIds",
          case
            when project.created_by_employee_id = ${employeeId}::uuid
              or project.owner_employee_id = ${employeeId}::uuid then 'admin'
            when member.access_level is not null then member.access_level
            when team_access.access_level is not null then team_access.access_level
            else 'viewer'
          end as "accessLevel",
          project.created_at as "createdAt"
        from public.work_project project
        left join public.employee owner
          on owner.employee_id = project.owner_employee_id
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
        left join lateral (
          select status.health
          from public.work_status_update status
          where status.work_project_id = project.work_project_id
          order by status.created_at desc
          limit 1
        ) latest_status on true
        where project.archived_at is null
          and project.project_kind = 'standard'
          and (
            project.privacy = 'organization'
            or project.created_by_employee_id = ${employeeId}::uuid
            or project.owner_employee_id = ${employeeId}::uuid
            or member.employee_id is not null
            or team_access.access_level is not null
          )
        order by lower(project.name)
      `);
      return visibleProjects(
        rows.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        })),
      );
    }),

    get: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        const project = await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        const enabledFeatureKeys = resolveFeatureCatalog(
          await listFeatureOverrides(),
          {
            userId: ctx.employeeId,
            clientId: project.clientId,
            roles: ctx.roles,
          },
        )
          .filter((feature) => feature.enabled)
          .map((feature) => feature.key);
        const enabled = new Set(enabledFeatureKeys);
        const showSections = enabled.has("work.sections");
        const showTasks = enabled.has("work.tasks");
        const showDependencies = enabled.has("work.dependencies");
        const showTime = enabled.has("work.time_tracking");
        if (!db) {
          const store = getDemoWork();
          return {
            project,
            enabledFeatureKeys,
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
          enabledFeatureKeys,
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
        if (input.assigneeEmployeeId)
          await requireAssignableEmployee(
            ctx,
            input.projectId,
            input.assigneeEmployeeId,
          );
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
          applyDemoDefaultCustomTaskType(item);
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
        await addMentionedItemFollowers(
          ctx,
          item.itemId,
          input.projectId,
          item.description,
        );
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
        if (input.assigneeEmployeeId)
          await requireAssignableEmployee(
            ctx,
            access.projectId,
            input.assigneeEmployeeId,
          );
        if (input.estimatedMinutes !== undefined)
          await requireWorkFeature(ctx, "work.time_tracking");
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          const item = store.items.get(input.itemId)!;
          const previousAssigneeEmployeeId = item.assigneeEmployeeId;
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
          if (
            input.assigneeEmployeeId !== undefined &&
            input.assigneeEmployeeId !== previousAssigneeEmployeeId
          )
            for (const [key, membership] of store.myTasksMemberships)
              if (membership.itemId === input.itemId)
                store.myTasksMemberships.delete(key);
          await audit(ctx, "work.task.update", "work_item", input.itemId, {
            fields: Object.keys(input).filter((key) => key !== "itemId"),
          });
          if (input.description !== undefined)
            await addMentionedItemFollowers(
              ctx,
              input.itemId,
              access.projectId,
              input.description,
            );
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
        if (input.description !== undefined)
          await addMentionedItemFollowers(
            ctx,
            input.itemId,
            access.projectId,
            input.description,
          );
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
        if (!db) {
          const item = getDemoWork().items.get(input.itemId)!;
          item.completedAt = input.completed ? new Date().toISOString() : null;
          syncDemoCustomTaskCompletion(item, input.completed);
        } else
          await db.execute(
            sql`update public.work_item set completed_at = ${input.completed ? new Date() : null}, updated_at = now() where work_item_id = ${input.itemId}::uuid`,
          );
        const recurrenceEnabled = await featureEnabled("work.recurring_tasks", {
          userId: ctx.employeeId,
          clientId: await projectClientId(access.projectId),
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
        const access = await requireItemAccess(ctx, input.itemId, "commenter");
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
        await addMentionedItemFollowers(
          ctx,
          input.itemId,
          access.projectId,
          input.body,
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
        let added = false;
        if (!db) {
          const followers =
            getDemoWork().followers.get(input.itemId) ?? new Set();
          added = !followers.has(employeeId);
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
          added = Boolean(rows[0]);
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
        if (added) {
          const projectIds = !db
            ? [getDemoWork().items.get(input.itemId)!.projectId]
            : (
                await db.execute<{ projectId: string }>(sql`
                  select work_project_id as "projectId"
                  from public.work_project_item
                  where work_item_id = ${input.itemId}::uuid
                `)
              ).map((row) => row.projectId);
          for (const projectId of projectIds)
            await runProjectRules(
              ctx,
              projectId,
              input.itemId,
              "collaborator_added",
            );
        }
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

  messages: router({
    teams: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db) return [];
      return db.execute<{
        teamId: string;
        name: string;
        messageSendPermission: "admins" | "members";
        role: "admin" | "member" | null;
        canPost: boolean;
      }>(sql`
        select team.work_team_id as "teamId", team.name,
          team.message_send_permission as "messageSendPermission",
          membership.role,
          (membership.role is not null and (
            team.message_send_permission = 'members'
            or membership.role = 'admin'
          )) as "canPost"
        from public.work_team team
        left join public.work_team_member membership
          on membership.work_team_id = team.work_team_id
          and membership.employee_id = ${employeeId}::uuid
        where team.archived_at is null
          and (team.privacy = 'public' or membership.employee_id is not null)
        order by lower(team.name)
      `);
    }),
    list: staffProcedure
      .input(messageScopeSchema)
      .query(async ({ input, ctx }) => {
        const scope = {
          projectId: input.projectId ?? null,
          teamId: input.teamId ?? null,
        };
        await requireMessageScope(ctx, scope);
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          return [...store.messages.values()]
            .filter(
              (message) =>
                message.projectId === scope.projectId &&
                message.teamId === scope.teamId,
            )
            .map((message) => {
              const people = store.likes.get(`message:${message.messageId}`);
              return {
                ...message,
                likeCount: people?.size ?? 0,
                likedByMe: people?.has(employeeId) ?? false,
              };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }
        const rows = await db.execute<
          Omit<WorkMessage, "createdAt"> & { createdAt: Date | string }
        >(sql`
          select message.work_message_id as "messageId",
            message.work_project_id as "projectId",
            message.work_team_id as "teamId", message.subject, message.body,
            message.is_announcement as "isAnnouncement",
            message.created_by_employee_id as "createdByEmployeeId",
            author.display_name as "authorName", message.created_at as "createdAt",
            (select count(*)::int from public.work_message_comment comment
              where comment.work_message_id = message.work_message_id
                and comment.deleted_at is null) as "commentCount",
            (select count(*)::int from public.work_like reaction
              where reaction.work_message_id = message.work_message_id) as "likeCount",
            exists(select 1 from public.work_like reaction
              where reaction.work_message_id = message.work_message_id
                and reaction.employee_id = ${employeeId}::uuid) as "likedByMe",
            exists(select 1 from public.work_message_follower follower
              where follower.work_message_id = message.work_message_id
                and follower.employee_id = ${employeeId}::uuid) as following
          from public.work_message message
          join public.employee author
            on author.employee_id = message.created_by_employee_id
          where message.archived_at is null
            and (${scope.projectId}::uuid is null
              or message.work_project_id = ${scope.projectId}::uuid)
            and (${scope.teamId}::uuid is null
              or message.work_team_id = ${scope.teamId}::uuid)
          order by message.created_at desc
          limit 200
        `);
        return rows.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      }),
    create: staffProcedure
      .input(
        messageScopeSchema.and(
          z.object({
            subject: z.string().trim().min(1).max(300),
            body: z.string().trim().max(50_000).default(""),
            isAnnouncement: z.boolean().default(false),
          }),
        ),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const scope = {
          projectId: input.projectId ?? null,
          teamId: input.teamId ?? null,
        };
        await requireMessageScope(ctx, scope, "post");
        const message: WorkMessage = {
          messageId: randomUUID(),
          ...scope,
          subject: input.subject,
          body: input.body,
          isAnnouncement: input.isAnnouncement,
          createdByEmployeeId: employeeId,
          authorName: ctx.user?.displayName ?? "You",
          createdAt: new Date().toISOString(),
          commentCount: 0,
          likeCount: 0,
          likedByMe: false,
          following: true,
        };
        const db = getDb();
        if (!db) getDemoWork().messages.set(message.messageId, message);
        else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_message (
                work_message_id, work_project_id, work_team_id, subject, body,
                is_announcement, created_by_employee_id
              ) values (
                ${message.messageId}::uuid, ${scope.projectId}::uuid,
                ${scope.teamId}::uuid, ${message.subject}, ${message.body},
                ${message.isAnnouncement}, ${employeeId}::uuid
              )
            `);
            await tx.execute(sql`
              insert into public.work_message_follower (work_message_id, employee_id)
              values (${message.messageId}::uuid, ${employeeId}::uuid)
              on conflict do nothing
            `);
            await tx.execute(sql`
              insert into public.work_notification (
                recipient_employee_id, actor_employee_id, work_project_id,
                work_message_id, event_type, message, payload
              )
              select distinct recipient.employee_id, ${employeeId}::uuid,
                ${scope.projectId}::uuid, ${message.messageId}::uuid, 'message',
                ${`New message: ${message.subject}`},
                jsonb_build_object('messageId', ${message.messageId}::text)
              from (
                select member.employee_id
                from public.work_project_member member
                where member.work_project_id = ${scope.projectId}::uuid
                union
                select team_member.employee_id
                from public.work_team_project team_project
                join public.work_team_member team_member
                  on team_member.work_team_id = team_project.work_team_id
                where team_project.work_project_id = ${scope.projectId}::uuid
                union
                select project.owner_employee_id
                from public.work_project project
                where project.work_project_id = ${scope.projectId}::uuid
                union
                select project.created_by_employee_id
                from public.work_project project
                where project.work_project_id = ${scope.projectId}::uuid
                union
                select team_member.employee_id
                from public.work_team_member team_member
                where team_member.work_team_id = ${scope.teamId}::uuid
              ) recipient
              where recipient.employee_id is not null
                and recipient.employee_id <> ${employeeId}::uuid
            `);
          });
        await audit(
          ctx,
          "work.message.create",
          "work_message",
          message.messageId,
          {
            ...scope,
            isAnnouncement: message.isAnnouncement,
          },
        );
        return message;
      }),
    comments: staffProcedure
      .input(z.object({ messageId: uuid }))
      .query(async ({ input, ctx }) => {
        await messageScopeById(ctx, input.messageId);
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          return [...store.messageComments.values()]
            .filter((comment) => comment.messageId === input.messageId)
            .map((comment) => {
              const people = store.likes.get(
                `message_comment:${comment.messageCommentId}`,
              );
              return {
                ...comment,
                likeCount: people?.size ?? 0,
                likedByMe: people?.has(employeeId) ?? false,
              };
            })
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }
        const rows = await db.execute<
          Omit<WorkMessageComment, "createdAt"> & {
            createdAt: Date | string;
          }
        >(sql`
          select comment.work_message_comment_id as "messageCommentId",
            comment.work_message_id as "messageId",
            comment.author_employee_id as "authorEmployeeId",
            author.display_name as "authorName", comment.body,
            comment.created_at as "createdAt",
            (select count(*)::int from public.work_like reaction
              where reaction.work_message_comment_id = comment.work_message_comment_id)
              as "likeCount",
            exists(select 1 from public.work_like reaction
              where reaction.work_message_comment_id = comment.work_message_comment_id
                and reaction.employee_id = ${employeeId}::uuid) as "likedByMe"
          from public.work_message_comment comment
          join public.employee author on author.employee_id = comment.author_employee_id
          where comment.work_message_id = ${input.messageId}::uuid
            and comment.deleted_at is null
          order by comment.created_at
        `);
        return rows.map((row) => ({
          ...row,
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      }),
    comment: staffProcedure
      .input(
        z.object({
          messageId: uuid,
          body: z.string().trim().min(1).max(20_000),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await messageScopeById(ctx, input.messageId, "comment");
        const employeeId = actor(ctx);
        const comment: WorkMessageComment = {
          messageCommentId: randomUUID(),
          messageId: input.messageId,
          authorEmployeeId: employeeId,
          authorName: ctx.user?.displayName ?? "You",
          body: input.body,
          createdAt: new Date().toISOString(),
          likeCount: 0,
          likedByMe: false,
        };
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          store.messageComments.set(comment.messageCommentId, comment);
          const message = store.messages.get(input.messageId)!;
          message.commentCount += 1;
          message.following = true;
        } else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_message_comment (
                work_message_comment_id, work_message_id, author_employee_id, body
              ) values (
                ${comment.messageCommentId}::uuid, ${input.messageId}::uuid,
                ${employeeId}::uuid, ${comment.body}
              )
            `);
            await tx.execute(sql`
              insert into public.work_message_follower (work_message_id, employee_id)
              values (${input.messageId}::uuid, ${employeeId}::uuid)
              on conflict do nothing
            `);
            await tx.execute(sql`
              insert into public.work_notification (
                recipient_employee_id, actor_employee_id, work_project_id,
                work_message_id, event_type, message, payload
              )
              select distinct recipient.employee_id, ${employeeId}::uuid,
                message.work_project_id, message.work_message_id, 'message',
                ${"New reply to a message"},
                jsonb_build_object('messageId', message.work_message_id::text)
              from public.work_message message
              cross join lateral (
                select follower.employee_id
                from public.work_message_follower follower
                where follower.work_message_id = message.work_message_id
                union select message.created_by_employee_id
              ) recipient
              where message.work_message_id = ${input.messageId}::uuid
                and recipient.employee_id <> ${employeeId}::uuid
            `);
          });
        await audit(
          ctx,
          "work.message.comment",
          "work_message_comment",
          comment.messageCommentId,
          { messageId: input.messageId },
        );
        return comment;
      }),
    setFollowing: staffProcedure
      .input(z.object({ messageId: uuid, following: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        await messageScopeById(ctx, input.messageId);
        const employeeId = actor(ctx);
        const db = getDb();
        if (!db)
          getDemoWork().messages.get(input.messageId)!.following =
            input.following;
        else if (input.following)
          await db.execute(sql`
            insert into public.work_message_follower (work_message_id, employee_id)
            values (${input.messageId}::uuid, ${employeeId}::uuid)
            on conflict do nothing
          `);
        else
          await db.execute(sql`
            delete from public.work_message_follower
            where work_message_id = ${input.messageId}::uuid
              and employee_id = ${employeeId}::uuid
          `);
        return { ok: true as const };
      }),
  }),

  likes: router({
    summary: staffProcedure
      .input(z.object({ targetType: likeTargetTypeSchema, targetId: uuid }))
      .query(async ({ input, ctx }) => {
        const projectId = await requireLikeTargetAccess(
          ctx,
          input.targetType,
          input.targetId,
          false,
        );
        await requireLikeFeatures(ctx, input.targetType, projectId);
        const employeeId = actor(ctx);
        const db = getDb();
        const key = `${input.targetType}:${input.targetId}`;
        if (!db) {
          const people = [...(getDemoWork().likes.get(key) ?? [])];
          return {
            count: people.length,
            likedByMe: people.includes(employeeId),
            people: people.map((id) => ({
              employeeId: id,
              displayName:
                id === employeeId ? (ctx.user?.displayName ?? "You") : "Member",
            })),
          };
        }
        const column =
          input.targetType === "item"
            ? sql`reaction.work_item_id`
            : input.targetType === "comment"
              ? sql`reaction.work_comment_id`
              : input.targetType === "attachment"
                ? sql`reaction.work_attachment_id`
                : input.targetType === "status_update"
                  ? sql`reaction.work_status_update_id`
                  : input.targetType === "message"
                    ? sql`reaction.work_message_id`
                    : sql`reaction.work_message_comment_id`;
        const people = await db.execute<{
          employeeId: string;
          displayName: string;
        }>(sql`
          select reaction.employee_id as "employeeId",
            employee.display_name as "displayName"
          from public.work_like reaction
          join public.employee employee on employee.employee_id = reaction.employee_id
          where ${column} = ${input.targetId}::uuid
          order by lower(employee.display_name)
        `);
        return {
          count: people.length,
          likedByMe: people.some((person) => person.employeeId === employeeId),
          people,
        };
      }),
    set: staffProcedure
      .input(
        z.object({
          targetType: likeTargetTypeSchema,
          targetId: uuid,
          liked: z.boolean(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const projectId = await requireLikeTargetAccess(
          ctx,
          input.targetType,
          input.targetId,
          true,
        );
        await requireLikeFeatures(ctx, input.targetType, projectId);
        const employeeId = actor(ctx);
        const db = getDb();
        const key = `${input.targetType}:${input.targetId}`;
        if (!db) {
          const people = getDemoWork().likes.get(key) ?? new Set<string>();
          if (input.liked) people.add(employeeId);
          else people.delete(employeeId);
          getDemoWork().likes.set(key, people);
        } else {
          const column =
            input.targetType === "item"
              ? sql`work_item_id`
              : input.targetType === "comment"
                ? sql`work_comment_id`
                : input.targetType === "attachment"
                  ? sql`work_attachment_id`
                  : input.targetType === "status_update"
                    ? sql`work_status_update_id`
                    : input.targetType === "message"
                      ? sql`work_message_id`
                      : sql`work_message_comment_id`;
          if (input.liked)
            await db.execute(sql`
              insert into public.work_like (employee_id, ${column})
              values (${employeeId}::uuid, ${input.targetId}::uuid)
              on conflict do nothing
            `);
          else
            await db.execute(sql`
              delete from public.work_like
              where employee_id = ${employeeId}::uuid
                and ${column} = ${input.targetId}::uuid
            `);
        }
        await audit(ctx, "work.like.set", "work_like", input.targetId, {
          targetType: input.targetType,
          targetId: input.targetId,
          liked: input.liked,
        });
        return { liked: input.liked };
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
          order by tag.name
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

  customTaskTypes: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          const associations = new Map(
            [...store.projectCustomTaskTypes.values()]
              .filter(
                (association) => association.projectId === input.projectId,
              )
              .map((association) => [
                association.customTaskTypeId,
                association,
              ]),
          );
          const typeIds = new Set([
            ...associations.keys(),
            ...[...store.items.values()].flatMap((item) =>
              item.projectId === input.projectId && item.customTaskTypeId
                ? [item.customTaskTypeId]
                : [],
            ),
          ]);
          const types = [...typeIds]
            .flatMap((customTaskTypeId) => {
              const type = store.customTaskTypes.get(customTaskTypeId);
              const association = associations.get(customTaskTypeId);
              return type
                ? [
                    {
                      ...type,
                      isAssociated: Boolean(association),
                      isDefault: association?.isDefault ?? false,
                    },
                  ]
                : [];
            })
            .sort((a, b) => a.name.localeCompare(b.name));
          return Promise.all(
            types.map(async (type) => ({
              ...type,
              accessLevel: await customTaskTypeAccess(
                ctx,
                type.customTaskTypeId,
              ),
            })),
          );
        }
        const rows = await db.execute<{
          customTaskTypeId: string;
          ownerProjectId: string | null;
          name: string;
          icon: string;
          sourcePlatform: "native" | "asana";
          defaultAccessLevel: CustomTaskTypeAccessLevel;
          isAssociated: boolean;
          isDefault: boolean;
          statusOptionId: string;
          statusName: string;
          statusColor: string;
          completionState: "incomplete" | "complete";
          enabled: boolean;
          position: number;
        }>(sql`
          select type.work_custom_task_type_id as "customTaskTypeId",
            type.owner_work_project_id as "ownerProjectId", type.name, type.icon,
            type.source_platform as "sourcePlatform",
            type.default_access_level as "defaultAccessLevel",
            association.work_project_custom_task_type_id is not null as "isAssociated",
            coalesce(association.is_default, false) as "isDefault",
            status.work_custom_task_status_option_id as "statusOptionId",
            status.name as "statusName", status.color as "statusColor",
            status.completion_state as "completionState", status.enabled, status.position
          from public.work_custom_task_type type
          left join public.work_project_custom_task_type association
            on association.work_custom_task_type_id = type.work_custom_task_type_id
            and association.work_project_id = ${input.projectId}::uuid
          join public.work_custom_task_status_option status
            on status.work_custom_task_type_id = type.work_custom_task_type_id
          where type.archived_at is null and (
            association.work_project_custom_task_type_id is not null
            or exists (
              select 1 from public.work_project_item membership
              join public.work_item item
                on item.work_item_id = membership.work_item_id
              where membership.work_project_id = ${input.projectId}::uuid
                and item.work_custom_task_type_id = type.work_custom_task_type_id
                and item.archived_at is null
            )
          )
          order by lower(type.name), status.position, status.created_at
        `);
        const types = new Map<
          string,
          WorkCustomTaskType & { isAssociated: boolean; isDefault: boolean }
        >();
        for (const row of rows) {
          const type = types.get(row.customTaskTypeId) ?? {
            customTaskTypeId: row.customTaskTypeId,
            ownerProjectId: row.ownerProjectId,
            name: row.name,
            icon: row.icon,
            sourcePlatform: row.sourcePlatform,
            defaultAccessLevel: row.defaultAccessLevel,
            isAssociated: row.isAssociated,
            isDefault: row.isDefault,
            statuses: [],
          };
          type.statuses.push({
            statusOptionId: row.statusOptionId,
            customTaskTypeId: row.customTaskTypeId,
            name: row.statusName,
            color: row.statusColor,
            completionState: row.completionState,
            enabled: row.enabled,
            position: row.position,
          });
          types.set(row.customTaskTypeId, type);
        }
        return Promise.all(
          [...types.values()].map(async (type) => ({
            ...type,
            accessLevel: await customTaskTypeAccess(ctx, type.customTaskTypeId),
          })),
        );
      }),

    access: staffProcedure
      .input(z.object({ projectId: uuid, customTaskTypeId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId, "admin");
        const db = getDb();
        if (!db) {
          const type = getDemoWork().customTaskTypes.get(
            input.customTaskTypeId,
          )!;
          return {
            defaultAccessLevel: type.defaultAccessLevel,
            members: [...getDemoWork().customTaskTypeMembers.values()].filter(
              (member) => member.customTaskTypeId === input.customTaskTypeId,
            ),
          };
        }
        const [type] = await db.execute<{
          defaultAccessLevel: CustomTaskTypeAccessLevel;
        }>(sql`
          select default_access_level as "defaultAccessLevel"
          from public.work_custom_task_type
          where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
            and archived_at is null
        `);
        if (!type) throw new TRPCError({ code: "NOT_FOUND" });
        const members = await db.execute<
          WorkCustomTaskTypeMember & { displayName: string }
        >(sql`
          select access.work_custom_task_type_id as "customTaskTypeId",
            access.member_type as "memberType",
            coalesce(access.employee_id, access.work_team_id) as "memberId",
            access.access_level as "accessLevel",
            coalesce(employee.display_name, team.name) as "displayName"
          from public.work_custom_task_type_member access
          left join public.employee employee on employee.employee_id = access.employee_id
          left join public.work_team team on team.work_team_id = access.work_team_id
          where access.work_custom_task_type_id = ${input.customTaskTypeId}::uuid
          order by access.member_type, lower(coalesce(employee.display_name, team.name))
        `);
        return { defaultAccessLevel: type.defaultAccessLevel, members };
      }),

    setDefaultAccess: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          customTaskTypeId: uuid,
          accessLevel: z.enum(["admin", "editor", "user", "none"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId, "admin");
        const db = getDb();
        if (!db) {
          const type = getDemoWork().customTaskTypes.get(
            input.customTaskTypeId,
          )!;
          const hasAdmin = [
            ...getDemoWork().customTaskTypeMembers.values(),
          ].some(
            (member) =>
              member.customTaskTypeId === input.customTaskTypeId &&
              member.memberType === "employee" &&
              member.accessLevel === "admin",
          );
          if (input.accessLevel !== "admin" && !hasAdmin)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A custom task type must keep at least one admin",
            });
          type.defaultAccessLevel = input.accessLevel;
        } else {
          await db.transaction(async (tx) => {
            const adminMembers = await tx.execute<{ count: number }>(sql`
              select count(*)::int as count
              from public.work_custom_task_type_member
              where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                and access_level = 'admin'
                and (
                  employee_id is not null or exists (
                    select 1 from public.work_team_member team_member
                    where team_member.work_team_id = work_custom_task_type_member.work_team_id
                  )
                )
            `);
            if (
              input.accessLevel !== "admin" &&
              (adminMembers[0]?.count ?? 0) === 0
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "A custom task type must keep at least one admin",
              });
            await tx.execute(sql`
              update public.work_custom_task_type
              set default_access_level = ${input.accessLevel}, updated_at = now()
              where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
            `);
          });
        }
        await audit(
          ctx,
          "work.customTaskType.defaultAccess",
          "work_custom_task_type",
          input.customTaskTypeId,
          { accessLevel: input.accessLevel },
        );
        return { ok: true as const };
      }),

    setMemberAccess: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          customTaskTypeId: uuid,
          memberType: z.enum(["employee", "team"]),
          memberId: uuid,
          accessLevel: z.enum(["admin", "editor", "user"]).nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId, "admin");
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          const key = customTaskTypeMemberKey(
            input.customTaskTypeId,
            input.memberType,
            input.memberId,
          );
          const current = store.customTaskTypeMembers.get(key);
          const otherAdmin = [...store.customTaskTypeMembers.entries()].some(
            ([candidateKey, member]) =>
              candidateKey !== key &&
              member.customTaskTypeId === input.customTaskTypeId &&
              member.memberType === "employee" &&
              member.accessLevel === "admin",
          );
          const defaultAdmin =
            store.customTaskTypes.get(input.customTaskTypeId)
              ?.defaultAccessLevel === "admin";
          if (
            current?.accessLevel === "admin" &&
            input.accessLevel !== "admin" &&
            !otherAdmin &&
            !defaultAdmin
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "A custom task type must keep at least one admin",
            });
          if (input.accessLevel)
            store.customTaskTypeMembers.set(key, {
              customTaskTypeId: input.customTaskTypeId,
              memberType: input.memberType,
              memberId: input.memberId,
              accessLevel: input.accessLevel,
            });
          else store.customTaskTypeMembers.delete(key);
        } else {
          await db.transaction(async (tx) => {
            const target =
              input.memberType === "employee"
                ? await tx.execute(sql`
                    select 1 from public.employee
                    where employee_id = ${input.memberId}::uuid and is_active
                  `)
                : await tx.execute(sql`
                    select 1 from public.work_team
                    where work_team_id = ${input.memberId}::uuid and archived_at is null
                      and (
                        privacy <> 'private'
                        or created_by_employee_id = ${actor(ctx)}::uuid
                        or exists (
                          select 1 from public.work_team_member member
                          where member.work_team_id = work_team.work_team_id
                            and member.employee_id = ${actor(ctx)}::uuid
                        )
                      )
                  `);
            if (!target[0])
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${input.memberType === "employee" ? "Employee" : "Team"} not found`,
              });
            if (!input.accessLevel) {
              await tx.execute(sql`
                delete from public.work_custom_task_type_member
                where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                  and member_type = ${input.memberType}
                  and ${
                    input.memberType === "employee"
                      ? sql`employee_id = ${input.memberId}::uuid`
                      : sql`work_team_id = ${input.memberId}::uuid`
                  }
              `);
            } else if (input.memberType === "employee") {
              await tx.execute(sql`
                insert into public.work_custom_task_type_member (
                  work_custom_task_type_id, member_type, employee_id, access_level
                ) values (
                  ${input.customTaskTypeId}::uuid, 'employee',
                  ${input.memberId}::uuid, ${input.accessLevel}
                ) on conflict (work_custom_task_type_id, employee_id)
                  where member_type = 'employee'
                do update set access_level = excluded.access_level, updated_at = now()
              `);
            } else {
              await tx.execute(sql`
                insert into public.work_custom_task_type_member (
                  work_custom_task_type_id, member_type, work_team_id, access_level
                ) values (
                  ${input.customTaskTypeId}::uuid, 'team',
                  ${input.memberId}::uuid, ${input.accessLevel}
                ) on conflict (work_custom_task_type_id, work_team_id)
                  where member_type = 'team'
                do update set access_level = excluded.access_level, updated_at = now()
              `);
            }
            const [remaining] = await tx.execute<{
              defaultAccessLevel: CustomTaskTypeAccessLevel;
              adminCount: number;
            }>(sql`
              select type.default_access_level as "defaultAccessLevel",
                count(access.work_custom_task_type_member_id) filter (
                  where access.access_level = 'admin' and (
                    access.employee_id is not null or exists (
                      select 1 from public.work_team_member team_member
                      where team_member.work_team_id = access.work_team_id
                    )
                  )
                )::int as "adminCount"
              from public.work_custom_task_type type
              left join public.work_custom_task_type_member access
                on access.work_custom_task_type_id = type.work_custom_task_type_id
              where type.work_custom_task_type_id = ${input.customTaskTypeId}::uuid
              group by type.default_access_level
            `);
            if (
              remaining?.defaultAccessLevel !== "admin" &&
              (remaining?.adminCount ?? 0) === 0
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "A custom task type must keep at least one admin",
              });
          });
        }
        await audit(
          ctx,
          "work.customTaskType.memberAccess",
          "work_custom_task_type",
          input.customTaskTypeId,
          {
            memberType: input.memberType,
            memberId: input.memberId,
            accessLevel: input.accessLevel,
          },
        );
        return { ok: true as const };
      }),

    assignments: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          return [...store.items.values()]
            .filter((item) => item.projectId === input.projectId)
            .map((item) => {
              const type = item.customTaskTypeId
                ? store.customTaskTypes.get(item.customTaskTypeId)
                : null;
              const status = type?.statuses.find(
                (candidate) =>
                  candidate.statusOptionId === item.customTaskStatusOptionId,
              );
              return {
                itemId: item.itemId,
                customTaskTypeId: type?.customTaskTypeId ?? null,
                statusOptionId: status?.statusOptionId ?? null,
                typeName: type?.name ?? null,
                typeIcon: type?.icon ?? null,
                statusName: status?.name ?? null,
                statusColor: status?.color ?? null,
                completionState: status?.completionState ?? null,
              };
            });
        }
        return db.execute<{
          itemId: string;
          customTaskTypeId: string | null;
          statusOptionId: string | null;
          typeName: string | null;
          typeIcon: string | null;
          statusName: string | null;
          statusColor: string | null;
          completionState: "incomplete" | "complete" | null;
        }>(sql`
          select item.work_item_id as "itemId",
            item.work_custom_task_type_id as "customTaskTypeId",
            item.work_custom_task_status_option_id as "statusOptionId",
            type.name as "typeName", type.icon as "typeIcon",
            status.name as "statusName", status.color as "statusColor",
            status.completion_state as "completionState"
          from public.work_project_item membership
          join public.work_item item on item.work_item_id = membership.work_item_id
          left join public.work_custom_task_type type
            on type.work_custom_task_type_id = item.work_custom_task_type_id
          left join public.work_custom_task_status_option status
            on status.work_custom_task_status_option_id = item.work_custom_task_status_option_id
          where membership.work_project_id = ${input.projectId}::uuid
            and item.archived_at is null
        `);
      }),

    create: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(120),
          icon: z.string().trim().min(1).max(16).default("◆"),
          statuses: z.array(customTaskStatusInput).min(2).max(20),
          isDefault: z.boolean().default(false),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        validateCustomTaskStatuses(input.statuses);
        const db = getDb();
        let type: WorkCustomTaskType & { isDefault: boolean };
        if (!db) {
          const store = getDemoWork();
          if (input.isDefault)
            for (const association of store.projectCustomTaskTypes.values())
              if (association.projectId === input.projectId)
                association.isDefault = false;
          const customTaskTypeId = randomUUID();
          type = {
            customTaskTypeId,
            ownerProjectId: input.projectId,
            name: input.name,
            icon: input.icon,
            sourcePlatform: "native",
            defaultAccessLevel: "user",
            isDefault: input.isDefault,
            statuses: input.statuses.map((status, position) => ({
              statusOptionId: status.statusOptionId ?? randomUUID(),
              customTaskTypeId,
              name: status.name,
              color: status.color,
              completionState: status.completionState,
              enabled: true,
              position,
            })),
          };
          store.customTaskTypes.set(customTaskTypeId, type);
          store.customTaskTypeMembers.set(
            customTaskTypeMemberKey(customTaskTypeId, "employee", actor(ctx)),
            {
              customTaskTypeId,
              memberType: "employee",
              memberId: actor(ctx),
              accessLevel: "admin",
            },
          );
          store.projectCustomTaskTypes.set(
            customTaskTypeProjectKey(input.projectId, customTaskTypeId),
            {
              projectId: input.projectId,
              customTaskTypeId,
              isDefault: input.isDefault,
            },
          );
        } else {
          type = await db.transaction(async (tx) => {
            if (input.isDefault)
              await tx.execute(sql`
                update public.work_project_custom_task_type set is_default = false,
                  updated_at = now()
                where work_project_id = ${input.projectId}::uuid and is_default
              `);
            const [created] = await tx.execute<{
              customTaskTypeId: string;
              ownerProjectId: string;
              name: string;
              icon: string;
              sourcePlatform: "native";
              defaultAccessLevel: CustomTaskTypeAccessLevel;
            }>(sql`
              insert into public.work_custom_task_type (
                owner_work_project_id, name, icon, created_by_employee_id
              ) values (
                ${input.projectId}::uuid, ${input.name}, ${input.icon}, ${actor(ctx)}::uuid
              ) returning work_custom_task_type_id as "customTaskTypeId",
                owner_work_project_id as "ownerProjectId", name, icon,
                source_platform as "sourcePlatform",
                default_access_level as "defaultAccessLevel"
            `);
            await tx.execute(sql`
              insert into public.work_custom_task_type_member (
                work_custom_task_type_id, member_type, employee_id, access_level
              ) values (
                ${created!.customTaskTypeId}::uuid, 'employee',
                ${actor(ctx)}::uuid, 'admin'
              )
            `);
            await tx.execute(sql`
              insert into public.work_project_custom_task_type (
                work_project_id, work_custom_task_type_id, is_default
              ) values (
                ${input.projectId}::uuid, ${created!.customTaskTypeId}::uuid,
                ${input.isDefault}
              )
            `);
            const statuses: WorkCustomTaskStatusOption[] = [];
            for (const [position, status] of input.statuses.entries()) {
              const [createdStatus] =
                await tx.execute<WorkCustomTaskStatusOption>(sql`
                  insert into public.work_custom_task_status_option (
                    work_custom_task_type_id, name, color, completion_state, position
                  ) values (
                    ${created!.customTaskTypeId}::uuid, ${status.name}, ${status.color},
                    ${status.completionState}, ${position}
                  ) returning work_custom_task_status_option_id as "statusOptionId",
                    work_custom_task_type_id as "customTaskTypeId", name, color,
                    completion_state as "completionState", enabled, position
                `);
              statuses.push(createdStatus!);
            }
            return { ...created!, isDefault: input.isDefault, statuses };
          });
        }
        await audit(
          ctx,
          "work.customTaskType.create",
          "work_custom_task_type",
          type.customTaskTypeId,
          { projectId: input.projectId, name: input.name },
        );
        return type;
      }),

    update: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          customTaskTypeId: uuid,
          name: z.string().trim().min(1).max(120),
          icon: z.string().trim().min(1).max(16),
          statuses: z.array(customTaskStatusInput).min(2).max(20),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireCustomTaskTypeAccess(
          ctx,
          input.customTaskTypeId,
          "editor",
        );
        validateCustomTaskStatuses(input.statuses);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          const type = store.customTaskTypes.get(input.customTaskTypeId);
          if (!type) throw new TRPCError({ code: "NOT_FOUND" });
          if (type.sourcePlatform !== "native")
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Asana-managed task types are updated by source sync",
            });
          validateCustomTaskStatusUpdate(input.statuses, type.statuses);
          const selectedIds = new Set(
            input.statuses.flatMap((status) =>
              status.statusOptionId ? [status.statusOptionId] : [],
            ),
          );
          for (const status of type.statuses)
            if (!selectedIds.has(status.statusOptionId)) status.enabled = false;
          type.statuses = [
            ...input.statuses.map((status, position) => {
              const current = status.statusOptionId
                ? type.statuses.find(
                    (candidate) =>
                      candidate.statusOptionId === status.statusOptionId,
                  )
                : null;
              return {
                statusOptionId: current?.statusOptionId ?? randomUUID(),
                customTaskTypeId: input.customTaskTypeId,
                name: status.name,
                color: status.color,
                completionState: status.completionState,
                enabled: true,
                position,
              } satisfies WorkCustomTaskStatusOption;
            }),
            ...type.statuses.filter(
              (status) => !selectedIds.has(status.statusOptionId),
            ),
          ];
          type.name = input.name;
          type.icon = input.icon;
          for (const item of store.items.values()) {
            if (item.customTaskTypeId !== input.customTaskTypeId) continue;
            const status = type.statuses.find(
              (candidate) =>
                candidate.statusOptionId === item.customTaskStatusOptionId,
            );
            if (!status?.enabled) continue;
            item.completedAt =
              status.completionState === "complete"
                ? (item.completedAt ?? new Date().toISOString())
                : null;
          }
        } else {
          await db.transaction(async (tx) => {
            const [type] = await tx.execute<{
              ownerProjectId: string | null;
              sourcePlatform: string;
            }>(sql`
              select owner_work_project_id as "ownerProjectId",
                source_platform as "sourcePlatform"
              from public.work_custom_task_type
              where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                and archived_at is null for update
            `);
            if (!type) throw new TRPCError({ code: "NOT_FOUND" });
            if (type.sourcePlatform !== "native")
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Asana-managed task types are updated by source sync",
              });
            const existing = await tx.execute<{
              statusOptionId: string;
              name: string;
            }>(sql`
              select work_custom_task_status_option_id as "statusOptionId", name
              from public.work_custom_task_status_option
              where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
            `);
            validateCustomTaskStatusUpdate(input.statuses, existing);
            await tx.execute(sql`
              update public.work_custom_task_type set name = ${input.name},
                icon = ${input.icon}, updated_at = now()
              where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
            `);
            const selectedIds: string[] = [];
            const selectedExistingIds = input.statuses.flatMap((status) =>
              status.statusOptionId ? [status.statusOptionId] : [],
            );
            if (selectedExistingIds.length)
              await tx.execute(sql`
                update public.work_custom_task_status_option
                set name = '__hrmny_edit_' || work_custom_task_status_option_id::text
                where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                  and work_custom_task_status_option_id in ${sql`(${sql.join(
                    selectedExistingIds.map((id) => sql`${id}::uuid`),
                    sql`, `,
                  )})`}
              `);
            for (const [position, status] of input.statuses.entries()) {
              if (status.statusOptionId) {
                await tx.execute(sql`
                  update public.work_custom_task_status_option
                  set name = ${status.name}, color = ${status.color},
                    completion_state = ${status.completionState}, enabled = true,
                    position = ${position}, updated_at = now()
                  where work_custom_task_status_option_id = ${status.statusOptionId}::uuid
                    and work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                `);
                selectedIds.push(status.statusOptionId);
              } else {
                const [created] = await tx.execute<{ id: string }>(sql`
                  insert into public.work_custom_task_status_option (
                    work_custom_task_type_id, name, color, completion_state, position
                  ) values (
                    ${input.customTaskTypeId}::uuid, ${status.name}, ${status.color},
                    ${status.completionState}, ${position}
                  ) returning work_custom_task_status_option_id as id
                `);
                selectedIds.push(created!.id);
              }
            }
            await tx.execute(sql`
              update public.work_custom_task_status_option set enabled = false,
                updated_at = now()
              where work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                and work_custom_task_status_option_id not in ${sql`(${sql.join(
                  selectedIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})`}
            `);
            await tx.execute(sql`
              update public.work_item item set completed_at = case
                when status.completion_state = 'complete'
                  then coalesce(item.completed_at, now())
                else null
              end, updated_at = now()
              from public.work_custom_task_status_option status
              where item.work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                and item.work_custom_task_status_option_id = status.work_custom_task_status_option_id
                and status.enabled
            `);
          });
        }
        await audit(
          ctx,
          "work.customTaskType.update",
          "work_custom_task_type",
          input.customTaskTypeId,
          { projectId: input.projectId, name: input.name },
        );
        return { ok: true as const };
      }),

    share: staffProcedure
      .input(
        z.object({
          sourceProjectId: uuid,
          targetProjectId: uuid,
          customTaskTypeId: uuid,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await Promise.all([
          requireScopedFeature(
            ctx,
            "work.custom_task_types",
            input.sourceProjectId,
          ),
          requireScopedFeature(
            ctx,
            "work.custom_task_types",
            input.targetProjectId,
          ),
        ]);
        await requireProjectAccess(ctx, input.sourceProjectId, "editor");
        await requireProjectAccess(ctx, input.targetProjectId, "editor");
        await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          if (
            !store.projectCustomTaskTypes.has(
              customTaskTypeProjectKey(
                input.sourceProjectId,
                input.customTaskTypeId,
              ),
            )
          )
            throw new TRPCError({ code: "NOT_FOUND" });
          store.projectCustomTaskTypes.set(
            customTaskTypeProjectKey(
              input.targetProjectId,
              input.customTaskTypeId,
            ),
            {
              projectId: input.targetProjectId,
              customTaskTypeId: input.customTaskTypeId,
              isDefault: false,
            },
          );
        } else {
          const source = await db.execute(sql`
            select 1 from public.work_project_custom_task_type
            where work_project_id = ${input.sourceProjectId}::uuid
              and work_custom_task_type_id = ${input.customTaskTypeId}::uuid limit 1
          `);
          if (!source[0]) throw new TRPCError({ code: "NOT_FOUND" });
          await db.execute(sql`
            insert into public.work_project_custom_task_type (
              work_project_id, work_custom_task_type_id
            ) values (${input.targetProjectId}::uuid, ${input.customTaskTypeId}::uuid)
            on conflict (work_project_id, work_custom_task_type_id) do nothing
          `);
        }
        await audit(
          ctx,
          "work.customTaskType.share",
          "work_custom_task_type",
          input.customTaskTypeId,
          {
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.targetProjectId,
          },
        );
        return { ok: true as const };
      }),

    removeFromProject: staffProcedure
      .input(z.object({ projectId: uuid, customTaskTypeId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        if (input.customTaskTypeId)
          await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId);
        const db = getDb();
        if (!db) {
          const removed = getDemoWork().projectCustomTaskTypes.delete(
            customTaskTypeProjectKey(input.projectId, input.customTaskTypeId),
          );
          if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        } else {
          const removed = await db.execute(sql`
            delete from public.work_project_custom_task_type
            where work_project_id = ${input.projectId}::uuid
              and work_custom_task_type_id = ${input.customTaskTypeId}::uuid
            returning work_project_custom_task_type_id
          `);
          if (!removed[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        await audit(
          ctx,
          "work.customTaskType.removeFromProject",
          "work_custom_task_type",
          input.customTaskTypeId,
          { projectId: input.projectId },
        );
        return { ok: true as const };
      }),

    setDefault: staffProcedure
      .input(z.object({ projectId: uuid, customTaskTypeId: nullableUuid }))
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        if (input.customTaskTypeId)
          await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId);
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          const selected = input.customTaskTypeId
            ? store.projectCustomTaskTypes.get(
                customTaskTypeProjectKey(
                  input.projectId,
                  input.customTaskTypeId,
                ),
              )
            : null;
          if (input.customTaskTypeId && !selected)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Custom task type is not available in this project",
            });
          for (const association of store.projectCustomTaskTypes.values())
            if (association.projectId === input.projectId)
              association.isDefault =
                association.customTaskTypeId === input.customTaskTypeId;
        } else {
          await db.transaction(async (tx) => {
            if (input.customTaskTypeId) {
              const selected = await tx.execute(sql`
                select 1 from public.work_project_custom_task_type
                where work_project_id = ${input.projectId}::uuid
                  and work_custom_task_type_id = ${input.customTaskTypeId}::uuid limit 1
              `);
              if (!selected[0])
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Custom task type is not available in this project",
                });
            }
            await tx.execute(sql`
              update public.work_project_custom_task_type
              set is_default = false, updated_at = now()
              where work_project_id = ${input.projectId}::uuid and is_default
            `);
            if (input.customTaskTypeId)
              await tx.execute(sql`
                update public.work_project_custom_task_type
                set is_default = true, updated_at = now()
                where work_project_id = ${input.projectId}::uuid
                  and work_custom_task_type_id = ${input.customTaskTypeId}::uuid
              `);
          });
        }
        await audit(
          ctx,
          "work.customTaskType.setDefault",
          "work_project",
          input.projectId,
          { customTaskTypeId: input.customTaskTypeId },
        );
        return { ok: true as const };
      }),

    setForTask: staffProcedure
      .input(
        z
          .object({
            projectId: uuid,
            itemId: uuid,
            customTaskTypeId: nullableUuid,
            statusOptionId: nullableUuid,
          })
          .refine(
            (value) =>
              Boolean(value.customTaskTypeId) === Boolean(value.statusOptionId),
            { message: "Choose both a custom task type and status" },
          ),
      )
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(
          ctx,
          "work.custom_task_types",
          input.projectId,
        );
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireItemInProject(ctx, input.itemId, input.projectId);
        if (input.customTaskTypeId)
          await requireCustomTaskTypeAccess(ctx, input.customTaskTypeId);
        const db = getDb();
        let completedAt: string | null = null;
        if (!db) {
          const store = getDemoWork();
          const item = store.items.get(input.itemId)!;
          if (item.itemType !== "task")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Custom task types can only be applied to tasks",
            });
          if (!input.customTaskTypeId) {
            item.customTaskTypeId = null;
            item.customTaskStatusOptionId = null;
          } else {
            const association = store.projectCustomTaskTypes.get(
              customTaskTypeProjectKey(input.projectId, input.customTaskTypeId),
            );
            const status = store.customTaskTypes
              .get(input.customTaskTypeId)
              ?.statuses.find(
                (candidate) =>
                  candidate.statusOptionId === input.statusOptionId &&
                  candidate.enabled,
              );
            if (
              (!association &&
                item.customTaskTypeId !== input.customTaskTypeId) ||
              !status
            )
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Custom task type or status is not available",
              });
            item.customTaskTypeId = input.customTaskTypeId;
            item.customTaskStatusOptionId = status.statusOptionId;
            item.completedAt =
              status.completionState === "complete"
                ? (item.completedAt ?? new Date().toISOString())
                : null;
          }
          completedAt = item.completedAt;
        } else if (!input.customTaskTypeId) {
          const [updated] = await db.execute<{
            completedAt: Date | string | null;
          }>(sql`
            update public.work_item set work_custom_task_type_id = null,
              work_custom_task_status_option_id = null, updated_at = now()
            where work_item_id = ${input.itemId}::uuid and item_type = 'task'
            returning completed_at as "completedAt"
          `);
          if (!updated)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Custom task types can only be applied to tasks",
            });
          completedAt = iso(updated.completedAt);
        } else {
          const [updated] = await db.execute<{
            completedAt: Date | string | null;
          }>(sql`
            update public.work_item item set
              work_custom_task_type_id = ${input.customTaskTypeId}::uuid,
              work_custom_task_status_option_id = ${input.statusOptionId}::uuid,
              completed_at = case
                when selected.completion_state = 'complete'
                  then coalesce(item.completed_at, now())
                when selected.completion_state = 'incomplete' then null
                else item.completed_at
              end,
              updated_at = now()
            from (
              select status.completion_state
              from public.work_custom_task_status_option status
              where status.work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                and status.work_custom_task_status_option_id = ${input.statusOptionId}::uuid
                and status.enabled
            ) selected
            where item.work_item_id = ${input.itemId}::uuid
              and item.item_type = 'task'
              and (
                item.work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                or exists (
                  select 1 from public.work_project_custom_task_type association
                  where association.work_project_id = ${input.projectId}::uuid
                    and association.work_custom_task_type_id = ${input.customTaskTypeId}::uuid
                )
              )
            returning item.completed_at as "completedAt"
          `);
          if (!updated)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Custom task type or status is not available",
            });
          completedAt = iso(updated.completedAt);
        }
        await audit(
          ctx,
          "work.customTaskType.assign",
          "work_item",
          input.itemId,
          {
            projectId: input.projectId,
            customTaskTypeId: input.customTaskTypeId,
            statusOptionId: input.statusOptionId,
          },
        );
        await notifyItem(
          ctx,
          input.itemId,
          "updated",
          "A task type or status was updated",
        );
        await runProjectRules(
          ctx,
          input.projectId,
          input.itemId,
          "custom_status_changed",
        );
        return { ok: true as const, completedAt };
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
        const attachment = await attachmentById(ctx, input.attachmentId);
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
        const attachment = await attachmentById(
          ctx,
          input.attachmentId,
          "editor",
        );
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

  proofing: router({
    list: staffProcedure
      .input(z.object({ attachmentId: uuid }))
      .query(async ({ input, ctx }) => {
        const attachment = await attachmentById(ctx, input.attachmentId);
        const access = await requireItemAccess(ctx, attachment.itemId);
        await requireProofingFeatures(ctx, access.projectId);
        if (!isProofableAttachment(attachment))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Proofing supports PDF, PNG, JPG, GIF, and BMP files",
          });
        const db = getDb();
        if (!db) {
          const store = getDemoWork();
          return [...store.proofAnnotations.values()]
            .filter(
              (annotation) => annotation.attachmentId === input.attachmentId,
            )
            .flatMap((annotation) => {
              const item = store.items.get(annotation.itemId);
              return item
                ? [
                    {
                      ...annotation,
                      title: item.title,
                      description: item.description,
                      assigneeEmployeeId: item.assigneeEmployeeId,
                      assigneeName: item.assigneeName,
                      dueAt: item.dueAt,
                      completedAt: item.completedAt,
                    },
                  ]
                : [];
            })
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        }
        const rows = await db.execute<
          WorkProofAnnotation & {
            xPosition: string | number;
            yPosition: string | number;
            createdAt: Date | string;
            title: string;
            description: string;
            assigneeEmployeeId: string | null;
            assigneeName: string | null;
            dueAt: Date | string | null;
            completedAt: Date | string | null;
          }
        >(sql`
          select proof.work_proof_annotation_id as "annotationId",
            proof.work_attachment_id as "attachmentId",
            proof.work_item_id as "itemId", proof.x_position as "xPosition",
            proof.y_position as "yPosition", proof.page_number as "pageNumber",
            proof.created_by_employee_id as "createdByEmployeeId",
            proof.created_at as "createdAt", item.title, item.description,
            item.assignee_employee_id as "assigneeEmployeeId",
            assignee.display_name as "assigneeName", item.due_at as "dueAt",
            item.completed_at as "completedAt"
          from public.work_proof_annotation proof
          join public.work_item item on item.work_item_id = proof.work_item_id
          left join public.employee assignee
            on assignee.employee_id = item.assignee_employee_id
          where proof.work_attachment_id = ${input.attachmentId}::uuid
            and item.archived_at is null
          order by proof.created_at
        `);
        return rows.map((row) => ({
          ...row,
          xPosition: Number(row.xPosition),
          yPosition: Number(row.yPosition),
          dueAt: iso(row.dueAt),
          completedAt: iso(row.completedAt),
          createdAt: new Date(row.createdAt).toISOString(),
        }));
      }),
    create: staffProcedure
      .input(
        z.object({
          attachmentId: uuid,
          xPosition: z.number().min(0).max(1),
          yPosition: z.number().min(0).max(1),
          pageNumber: z.number().int().min(1).max(10_000).nullable().optional(),
          feedback: z.string().trim().min(1).max(500),
          assigneeEmployeeId: nullableUuid.optional(),
          dueAt: z.string().datetime().nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const attachment = await attachmentById(
          ctx,
          input.attachmentId,
          "commenter",
        );
        const access = await requireItemAccess(
          ctx,
          attachment.itemId,
          "commenter",
        );
        await requireProofingFeatures(ctx, access.projectId);
        if (input.assigneeEmployeeId)
          await requireAssignableEmployee(
            ctx,
            access.projectId,
            input.assigneeEmployeeId,
          );
        if (!isProofableAttachment(attachment))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Proofing supports PDF, PNG, JPG, GIF, and BMP files",
          });
        const pageNumber = isPdfAttachment(attachment)
          ? (input.pageNumber ?? 1)
          : null;
        const annotation: WorkProofAnnotation = {
          annotationId: randomUUID(),
          attachmentId: attachment.attachmentId,
          itemId: randomUUID(),
          xPosition: input.xPosition,
          yPosition: input.yPosition,
          pageNumber,
          createdByEmployeeId: employeeId,
          createdAt: new Date().toISOString(),
        };
        const description = `Proofing feedback on ${attachment.name}${pageNumber ? `, page ${pageNumber}` : ""}.`;
        const db = getDb();
        let item: WorkItem;
        if (!db) {
          const store = getDemoWork();
          const parent = store.items.get(attachment.itemId)!;
          item = {
            itemId: annotation.itemId,
            parentItemId: attachment.itemId,
            title: input.feedback,
            description,
            itemType: "task",
            priority: null,
            assigneeEmployeeId: input.assigneeEmployeeId ?? null,
            assigneeName: input.assigneeEmployeeId ? "Assigned user" : null,
            startDate: null,
            dueAt: input.dueAt ?? null,
            completedAt: null,
            sectionId: parent.sectionId,
            position: [...store.items.values()].filter(
              (candidate) => candidate.projectId === access.projectId,
            ).length,
            projectId: access.projectId,
            recurrence: null,
            estimatedMinutes: null,
          };
          store.items.set(item.itemId, item);
          store.proofAnnotations.set(annotation.annotationId, annotation);
        } else {
          const [membership] = await db.execute<{
            sectionId: string | null;
          }>(sql`
            select work_section_id as "sectionId"
            from public.work_project_item
            where work_project_id = ${access.projectId}::uuid
              and work_item_id = ${attachment.itemId}::uuid
            limit 1
          `);
          if (!membership) throw new TRPCError({ code: "NOT_FOUND" });
          item = await db.transaction(async (tx) => {
            const [created] = await tx.execute<
              WorkItem & { dueAt: Date | string | null }
            >(sql`
              insert into public.work_item (
                work_item_id, parent_work_item_id, title, description,
                item_type, assignee_employee_id, created_by_employee_id, due_at
              ) values (
                ${annotation.itemId}::uuid, ${attachment.itemId}::uuid,
                ${input.feedback}, ${description}, 'task',
                ${input.assigneeEmployeeId ?? null}::uuid,
                ${employeeId}::uuid, ${input.dueAt ?? null}::timestamptz
              )
              returning work_item_id as "itemId",
                parent_work_item_id as "parentItemId", title, description,
                item_type as "itemType", priority, recurrence,
                estimated_minutes as "estimatedMinutes",
                assignee_employee_id as "assigneeEmployeeId",
                start_date as "startDate", due_at as "dueAt",
                completed_at as "completedAt"
            `);
            const [projectItem] = await tx.execute<{ position: number }>(sql`
              insert into public.work_project_item (
                work_project_id, work_item_id, work_section_id, position
              ) values (
                ${access.projectId}::uuid, ${annotation.itemId}::uuid,
                ${membership.sectionId}::uuid,
                (select coalesce(max(position), -1) + 1
                  from public.work_project_item
                  where work_project_id = ${access.projectId}::uuid)
              ) returning position
            `);
            if (!created || !projectItem)
              throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
            await tx.execute(sql`
              insert into public.work_proof_annotation (
                work_proof_annotation_id, work_attachment_id, work_item_id,
                x_position, y_position, page_number, created_by_employee_id
              ) values (
                ${annotation.annotationId}::uuid,
                ${annotation.attachmentId}::uuid, ${annotation.itemId}::uuid,
                ${annotation.xPosition}, ${annotation.yPosition},
                ${annotation.pageNumber}, ${employeeId}::uuid
              )
            `);
            let assigneeName: string | null = null;
            if (created.assigneeEmployeeId) {
              const [assignee] = await tx.execute<{ name: string }>(sql`
                select display_name as name from public.employee
                where employee_id = ${created.assigneeEmployeeId}::uuid
              `);
              assigneeName = assignee?.name ?? null;
            }
            return {
              ...created,
              assigneeName,
              startDate: created.startDate ? String(created.startDate) : null,
              dueAt: iso(created.dueAt),
              completedAt: iso(created.completedAt),
              sectionId: membership.sectionId,
              position: projectItem.position,
              projectId: access.projectId,
            };
          });
        }
        await audit(
          ctx,
          "work.proofing.create",
          "work_proof_annotation",
          annotation.annotationId,
          {
            attachmentId: annotation.attachmentId,
            itemId: annotation.itemId,
            pageNumber,
          },
        );
        await notifyItem(
          ctx,
          attachment.itemId,
          "commented",
          "New proofing feedback on a followed task",
        );
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
        await runProjectRules(ctx, access.projectId, item.itemId, "task_added");
        return {
          ...annotation,
          title: item.title,
          description: item.description,
          assigneeEmployeeId: item.assigneeEmployeeId,
          assigneeName: item.assigneeName,
          dueAt: item.dueAt,
          completedAt: item.completedAt,
        };
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
    quickAdd: staffProcedure
      .input(
        z.object({
          title: z.string().trim().min(1).max(500),
          description: z.string().trim().max(20_000).default(""),
          priority: z
            .enum(["low", "medium", "high", "urgent"])
            .nullable()
            .optional(),
          dueAt: z.string().datetime().nullable().optional(),
          personalSectionId: nullableUuid.optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireWorkFeature(ctx, "work.my_tasks.quick_add");
        await requireWorkFeature(ctx, "work.tasks");
        const db = getDb();
        let item: WorkItem & {
          projectName: string;
          projectKind: "personal";
          personalSectionId: string | null;
          personalPosition: number;
        };
        if (!db) {
          const store = getDemoWork();
          let project = [...store.projects.values()].find(
            (candidate) =>
              candidate.projectKind === "personal" &&
              candidate.ownerEmployeeId === employeeId,
          );
          if (!project) {
            project = {
              projectId: randomUUID(),
              name: "Private tasks",
              description: "Private tasks created from My Tasks.",
              color: "#C7702E",
              privacy: "private",
              clientId: null,
              ownerEmployeeId: employeeId,
              sourcePlatform: "native",
              projectKind: "personal",
              accessLevel: "admin",
              createdAt: new Date().toISOString(),
            };
            store.projects.set(project.projectId, project);
          }
          if (input.personalSectionId) {
            const section = store.myTasksSections.get(input.personalSectionId);
            if (!section || section.employeeId !== employeeId)
              throw new TRPCError({ code: "NOT_FOUND" });
          }
          const itemId = randomUUID();
          const position = [...store.items.values()].filter(
            (candidate) => candidate.projectId === project.projectId,
          ).length;
          const created: WorkItem = {
            itemId,
            parentItemId: null,
            title: input.title,
            description: input.description,
            itemType: "task",
            priority: input.priority ?? null,
            assigneeEmployeeId: employeeId,
            assigneeName: ctx.user?.displayName ?? "You",
            startDate: null,
            dueAt: input.dueAt ?? null,
            completedAt: null,
            sectionId: null,
            position,
            projectId: project.projectId,
            recurrence: null,
            estimatedMinutes: null,
          };
          store.items.set(itemId, created);
          if (input.personalSectionId)
            store.myTasksMemberships.set(
              myTasksMembershipKey(employeeId, itemId),
              {
                employeeId,
                itemId,
                sectionId: input.personalSectionId,
                position: 0,
              },
            );
          item = {
            ...created,
            projectName: "Private task",
            projectKind: "personal",
            personalSectionId: input.personalSectionId ?? null,
            personalPosition: 0,
          };
        } else {
          item = await db.transaction(async (tx) => {
            if (input.personalSectionId) {
              const section = await tx.execute(sql`
                select 1 from public.work_my_tasks_section
                where work_my_tasks_section_id = ${input.personalSectionId}::uuid
                  and employee_id = ${employeeId}::uuid limit 1
              `);
              if (!section[0]) throw new TRPCError({ code: "NOT_FOUND" });
            }
            const projects = await tx.execute<{ projectId: string }>(sql`
              insert into public.work_project (
                name, description, color, privacy, owner_employee_id,
                created_by_employee_id, project_kind
              ) values (
                'Private tasks', 'Private tasks created from My Tasks.',
                '#C7702E', 'private', ${employeeId}::uuid,
                ${employeeId}::uuid, 'personal'
              ) on conflict (owner_employee_id) where project_kind = 'personal'
              do update set archived_at = null, updated_at = now()
              returning work_project_id as "projectId"
            `);
            const projectId = projects[0]!.projectId;
            await tx.execute(sql`
              insert into public.work_project_member (
                work_project_id, employee_id, access_level
              ) values (${projectId}::uuid, ${employeeId}::uuid, 'admin')
              on conflict (work_project_id, employee_id) do update set
                access_level = 'admin', updated_at = now()
            `);
            const rows = await tx.execute<WorkItem>(sql`
              insert into public.work_item (
                title, description, item_type, priority,
                assignee_employee_id, created_by_employee_id, due_at
              ) values (
                ${input.title}, ${input.description}, 'task',
                ${input.priority ?? null}, ${employeeId}::uuid,
                ${employeeId}::uuid, ${input.dueAt ?? null}::timestamptz
              ) returning work_item_id as "itemId",
                parent_work_item_id as "parentItemId", title, description,
                item_type as "itemType", priority,
                assignee_employee_id as "assigneeEmployeeId",
                null::text as "assigneeName", start_date as "startDate",
                due_at as "dueAt", completed_at as "completedAt", recurrence,
                estimated_minutes as "estimatedMinutes"
            `);
            const created = rows[0]!;
            const memberships = await tx.execute<{ position: number }>(sql`
              insert into public.work_project_item (
                work_project_id, work_item_id, position
              ) values (
                ${projectId}::uuid, ${created.itemId}::uuid,
                (select coalesce(max(position), -1) + 1
                  from public.work_project_item
                  where work_project_id = ${projectId}::uuid)
              ) returning position
            `);
            if (input.personalSectionId)
              await tx.execute(sql`
                insert into public.work_my_tasks_membership (
                  employee_id, work_item_id, work_my_tasks_section_id, position
                ) values (
                  ${employeeId}::uuid, ${created.itemId}::uuid,
                  ${input.personalSectionId}::uuid, 0
                )
              `);
            return {
              ...created,
              assigneeName: ctx.user?.displayName ?? "You",
              startDate: created.startDate ? String(created.startDate) : null,
              dueAt: iso(created.dueAt),
              completedAt: iso(created.completedAt),
              sectionId: null,
              position: memberships[0]!.position,
              projectId,
              projectName: "Private task",
              projectKind: "personal" as const,
              personalSectionId: input.personalSectionId ?? null,
              personalPosition: 0,
            };
          });
        }
        await audit(ctx, "work.my_tasks.quick_add", "work_item", item.itemId, {
          personalSectionId: item.personalSectionId,
          dueAt: item.dueAt,
        });
        return item;
      }),

    focus: router({
      get: staffProcedure
        .input(z.object({ weekStart: z.string().date() }))
        .query(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.focus");
          const db = getDb();
          if (!db)
            return (
              getDemoWork().myTasksFocus.get(
                `${employeeId}:${input.weekStart}`,
              ) ?? {
                employeeId,
                weekStart: input.weekStart,
                focusText: "",
                updatedAt: new Date().toISOString(),
              }
            );
          const rows = await db.execute<
            WorkMyTasksFocus & { updatedAt: Date | string }
          >(sql`
            select employee_id as "employeeId", week_start as "weekStart",
              focus_text as "focusText", updated_at as "updatedAt"
            from public.work_my_tasks_focus
            where employee_id = ${employeeId}::uuid
              and week_start = ${input.weekStart}::date
            limit 1
          `);
          return rows[0]
            ? {
                ...rows[0],
                weekStart: String(rows[0].weekStart),
                updatedAt: iso(rows[0].updatedAt)!,
              }
            : {
                employeeId,
                weekStart: input.weekStart,
                focusText: "",
                updatedAt: new Date().toISOString(),
              };
        }),

      save: staffProcedure
        .input(
          z.object({
            weekStart: z.string().date(),
            focusText: z.string().trim().max(500),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.focus");
          const db = getDb();
          let focus: WorkMyTasksFocus;
          if (!db) {
            focus = {
              employeeId,
              ...input,
              updatedAt: new Date().toISOString(),
            };
            getDemoWork().myTasksFocus.set(
              `${employeeId}:${input.weekStart}`,
              focus,
            );
          } else {
            const rows = await db.execute<
              WorkMyTasksFocus & { updatedAt: Date | string }
            >(sql`
              insert into public.work_my_tasks_focus (
                employee_id, week_start, focus_text
              ) values (
                ${employeeId}::uuid, ${input.weekStart}::date, ${input.focusText}
              ) on conflict (employee_id, week_start) do update set
                focus_text = excluded.focus_text, updated_at = now()
              returning employee_id as "employeeId", week_start as "weekStart",
                focus_text as "focusText", updated_at as "updatedAt"
            `);
            focus = {
              ...rows[0]!,
              weekStart: String(rows[0]!.weekStart),
              updatedAt: iso(rows[0]!.updatedAt)!,
            };
          }
          await audit(
            ctx,
            "work.my_tasks.focus.save",
            "work_my_tasks_focus",
            employeeId,
            { weekStart: input.weekStart, hasFocus: Boolean(input.focusText) },
          );
          return focus;
        }),
    }),

    myTaskSections: router({
      list: staffProcedure.query(async ({ ctx }) => {
        const employeeId = actor(ctx);
        await requireWorkFeature(ctx, "work.my_tasks.sections");
        const db = getDb();
        if (!db)
          return [...getDemoWork().myTasksSections.values()]
            .filter((section) => section.employeeId === employeeId)
            .sort(
              (a, b) =>
                a.position - b.position ||
                a.createdAt.localeCompare(b.createdAt),
            );
        const rows = await db.execute<
          WorkMyTasksSection & { createdAt: Date | string }
        >(sql`
          select work_my_tasks_section_id as "sectionId",
            employee_id as "employeeId", name, position,
            created_at as "createdAt"
          from public.work_my_tasks_section
          where employee_id = ${employeeId}::uuid
          order by position, created_at
        `);
        return rows.map((row) => ({
          ...row,
          createdAt: iso(row.createdAt)!,
        }));
      }),

      create: staffProcedure
        .input(z.object({ name: z.string().trim().min(1).max(120) }))
        .mutation(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.sections");
          const db = getDb();
          let section: WorkMyTasksSection;
          if (!db) {
            const store = getDemoWork();
            if (
              [...store.myTasksSections.values()].some(
                (candidate) =>
                  candidate.employeeId === employeeId &&
                  candidate.name.toLowerCase() === input.name.toLowerCase(),
              )
            )
              throw new TRPCError({
                code: "CONFLICT",
                message: "A My Tasks section already uses that name",
              });
            section = {
              sectionId: randomUUID(),
              employeeId,
              name: input.name,
              position: [...store.myTasksSections.values()].filter(
                (candidate) => candidate.employeeId === employeeId,
              ).length,
              createdAt: new Date().toISOString(),
            };
            store.myTasksSections.set(section.sectionId, section);
          } else {
            const duplicate = await db.execute(sql`
              select 1 from public.work_my_tasks_section
              where employee_id = ${employeeId}::uuid
                and lower(name) = lower(${input.name}) limit 1
            `);
            if (duplicate[0])
              throw new TRPCError({
                code: "CONFLICT",
                message: "A My Tasks section already uses that name",
              });
            const rows = await db.execute<
              WorkMyTasksSection & { createdAt: Date | string }
            >(sql`
              insert into public.work_my_tasks_section (
                employee_id, name, position
              ) values (
                ${employeeId}::uuid, ${input.name},
                (select coalesce(max(position), -1) + 1
                  from public.work_my_tasks_section
                  where employee_id = ${employeeId}::uuid)
              ) returning work_my_tasks_section_id as "sectionId",
                employee_id as "employeeId", name, position,
                created_at as "createdAt"
            `);
            section = {
              ...rows[0]!,
              createdAt: iso(rows[0]!.createdAt)!,
            };
          }
          await audit(
            ctx,
            "work.my_tasks.section.create",
            "work_my_tasks_section",
            section.sectionId,
            { name: section.name },
          );
          return section;
        }),

      rename: staffProcedure
        .input(
          z.object({
            sectionId: uuid,
            name: z.string().trim().min(1).max(120),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.sections");
          const db = getDb();
          if (!db) {
            const store = getDemoWork();
            const section = store.myTasksSections.get(input.sectionId);
            if (!section || section.employeeId !== employeeId)
              throw new TRPCError({ code: "NOT_FOUND" });
            if (
              [...store.myTasksSections.values()].some(
                (candidate) =>
                  candidate.sectionId !== input.sectionId &&
                  candidate.employeeId === employeeId &&
                  candidate.name.toLowerCase() === input.name.toLowerCase(),
              )
            )
              throw new TRPCError({ code: "CONFLICT" });
            section.name = input.name;
          } else {
            const rows = await db.execute<{ sectionId: string }>(sql`
              update public.work_my_tasks_section set
                name = ${input.name}, updated_at = now()
              where work_my_tasks_section_id = ${input.sectionId}::uuid
                and employee_id = ${employeeId}::uuid
                and not exists (
                  select 1 from public.work_my_tasks_section duplicate
                  where duplicate.employee_id = ${employeeId}::uuid
                    and duplicate.work_my_tasks_section_id <> ${input.sectionId}::uuid
                    and lower(duplicate.name) = lower(${input.name})
                )
              returning work_my_tasks_section_id as "sectionId"
            `);
            if (!rows[0])
              throw new TRPCError({
                code: "NOT_FOUND",
                message: "Section was not found or that name is already used",
              });
          }
          await audit(
            ctx,
            "work.my_tasks.section.rename",
            "work_my_tasks_section",
            input.sectionId,
            { name: input.name },
          );
          return { sectionId: input.sectionId, name: input.name };
        }),

      remove: staffProcedure
        .input(z.object({ sectionId: uuid }))
        .mutation(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.sections");
          const db = getDb();
          if (!db) {
            const store = getDemoWork();
            const section = store.myTasksSections.get(input.sectionId);
            if (!section || section.employeeId !== employeeId)
              throw new TRPCError({ code: "NOT_FOUND" });
            store.myTasksSections.delete(input.sectionId);
            for (const [key, membership] of store.myTasksMemberships)
              if (membership.sectionId === input.sectionId)
                store.myTasksMemberships.delete(key);
          } else {
            const rows = await db.execute<{ sectionId: string }>(sql`
              delete from public.work_my_tasks_section
              where work_my_tasks_section_id = ${input.sectionId}::uuid
                and employee_id = ${employeeId}::uuid
              returning work_my_tasks_section_id as "sectionId"
            `);
            if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
          }
          await audit(
            ctx,
            "work.my_tasks.section.remove",
            "work_my_tasks_section",
            input.sectionId,
            { movedToRecentlyAssigned: true },
          );
          return { ok: true as const };
        }),

      reorder: staffProcedure
        .input(
          z.object({
            sectionIds: z
              .array(uuid)
              .min(1)
              .max(100)
              .refine((ids) => new Set(ids).size === ids.length),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.sections");
          const db = getDb();
          if (!db) {
            const owned = [...getDemoWork().myTasksSections.values()]
              .filter((section) => section.employeeId === employeeId)
              .map((section) => section.sectionId)
              .sort();
            if (owned.join() !== [...input.sectionIds].sort().join())
              throw new TRPCError({ code: "BAD_REQUEST" });
            input.sectionIds.forEach((sectionId, position) => {
              getDemoWork().myTasksSections.get(sectionId)!.position = position;
            });
          } else {
            await db.transaction(async (tx) => {
              const owned = await tx.execute<{ sectionId: string }>(sql`
                select work_my_tasks_section_id as "sectionId"
                from public.work_my_tasks_section
                where employee_id = ${employeeId}::uuid
              `);
              if (
                owned
                  .map((row) => row.sectionId)
                  .sort()
                  .join() !== [...input.sectionIds].sort().join()
              )
                throw new TRPCError({ code: "BAD_REQUEST" });
              for (const [position, sectionId] of input.sectionIds.entries())
                await tx.execute(sql`
                  update public.work_my_tasks_section
                  set position = ${position}, updated_at = now()
                  where work_my_tasks_section_id = ${sectionId}::uuid
                    and employee_id = ${employeeId}::uuid
                `);
            });
          }
          await audit(
            ctx,
            "work.my_tasks.section.reorder",
            "work_my_tasks_section",
            input.sectionIds[0]!,
            { sectionIds: input.sectionIds },
          );
          return { ok: true as const };
        }),

      moveTask: staffProcedure
        .input(
          z.object({
            itemId: uuid,
            sectionId: nullableUuid,
            position: z.number().int().min(0).max(1_000_000).default(0),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const employeeId = actor(ctx);
          await requireWorkFeature(ctx, "work.my_tasks.sections");
          await requireItemAccess(ctx, input.itemId);
          const db = getDb();
          if (!db) {
            const store = getDemoWork();
            const item = store.items.get(input.itemId)!;
            if (item.assigneeEmployeeId !== employeeId)
              throw new TRPCError({ code: "FORBIDDEN" });
            if (input.sectionId) {
              const section = store.myTasksSections.get(input.sectionId);
              if (!section || section.employeeId !== employeeId)
                throw new TRPCError({ code: "NOT_FOUND" });
              store.myTasksMemberships.set(
                myTasksMembershipKey(employeeId, input.itemId),
                {
                  employeeId,
                  itemId: input.itemId,
                  sectionId: input.sectionId,
                  position: input.position,
                },
              );
            } else {
              store.myTasksMemberships.delete(
                myTasksMembershipKey(employeeId, input.itemId),
              );
            }
          } else {
            const assigned = await db.execute(sql`
              select 1 from public.work_item
              where work_item_id = ${input.itemId}::uuid
                and assignee_employee_id = ${employeeId}::uuid
                and archived_at is null limit 1
            `);
            if (!assigned[0]) throw new TRPCError({ code: "FORBIDDEN" });
            if (input.sectionId) {
              const section = await db.execute(sql`
                select 1 from public.work_my_tasks_section
                where work_my_tasks_section_id = ${input.sectionId}::uuid
                  and employee_id = ${employeeId}::uuid limit 1
              `);
              if (!section[0]) throw new TRPCError({ code: "NOT_FOUND" });
              await db.execute(sql`
                insert into public.work_my_tasks_membership (
                  employee_id, work_item_id, work_my_tasks_section_id, position
                ) values (
                  ${employeeId}::uuid, ${input.itemId}::uuid,
                  ${input.sectionId}::uuid, ${input.position}
                ) on conflict (employee_id, work_item_id) do update set
                  work_my_tasks_section_id = excluded.work_my_tasks_section_id,
                  position = excluded.position, updated_at = now()
              `);
            } else {
              await db.execute(sql`
                delete from public.work_my_tasks_membership
                where employee_id = ${employeeId}::uuid
                  and work_item_id = ${input.itemId}::uuid
              `);
            }
          }
          await audit(
            ctx,
            "work.my_tasks.task.move",
            "work_item",
            input.itemId,
            { sectionId: input.sectionId, position: input.position },
          );
          return { ok: true as const };
        }),
    }),

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
        if (!db) {
          const store = getDemoWork();
          return [...store.items.values()]
            .filter(
              (item) =>
                item.assigneeEmployeeId === employeeId &&
                (input?.includeCompleted || !item.completedAt) &&
                (!input?.query ||
                  item.title.toLowerCase().includes(input.query.toLowerCase())),
            )
            .map((item) => {
              const membership = store.myTasksMemberships.get(
                myTasksMembershipKey(employeeId, item.itemId),
              );
              const project = store.projects.get(item.projectId);
              return {
                ...item,
                projectName:
                  project?.projectKind === "personal"
                    ? "Private task"
                    : (project?.name ?? "Work"),
                projectKind: project?.projectKind ?? "standard",
                personalSectionId: membership?.sectionId ?? null,
                personalPosition: membership?.position ?? 0,
              };
            });
        }
        const pattern = `%${input?.query ?? ""}%`;
        const rows = await db.execute<
          WorkItem & {
            projectName: string;
            projectKind: "standard" | "personal";
            personalSectionId: string | null;
            personalPosition: number;
          }
        >(sql`
          select item.work_item_id as "itemId",
            item.parent_work_item_id as "parentItemId", item.title,
            item.description, item.item_type as "itemType", item.priority,
            item.assignee_employee_id as "assigneeEmployeeId",
            assignee.display_name as "assigneeName", item.start_date as "startDate",
            item.due_at as "dueAt", item.completed_at as "completedAt",
            chosen."sectionId", chosen.position,
            chosen."projectId",
            case when chosen."projectKind" = 'personal'
              then 'Private task' else chosen."projectName" end as "projectName",
            chosen."projectKind",
            personal.work_my_tasks_section_id as "personalSectionId",
            coalesce(personal.position, 0) as "personalPosition",
            item.recurrence
          from public.work_item item
          join lateral (
            select project_item.work_section_id as "sectionId",
              project_item.position,
              project.work_project_id as "projectId",
              project.name as "projectName",
              project.project_kind as "projectKind"
            from public.work_project_item project_item
            join public.work_project project
              on project.work_project_id = project_item.work_project_id
            where project_item.work_item_id = item.work_item_id
              and project.archived_at is null
              and (
                project.privacy = 'organization'
                or project.created_by_employee_id = ${employeeId}::uuid
                or project.owner_employee_id = ${employeeId}::uuid
                or exists (
                  select 1 from public.work_project_member member
                  where member.work_project_id = project.work_project_id
                    and member.employee_id = ${employeeId}::uuid
                )
                or exists (
                  select 1 from public.work_team_project team_project
                  join public.work_team_member team_member
                    on team_member.work_team_id = team_project.work_team_id
                  where team_project.work_project_id = project.work_project_id
                    and team_member.employee_id = ${employeeId}::uuid
                )
              )
            order by (project.project_kind = 'personal'),
              project_item.created_at, lower(project.name)
            limit 1
          ) chosen on true
          left join public.work_my_tasks_membership personal
            on personal.work_item_id = item.work_item_id
            and personal.employee_id = ${employeeId}::uuid
          left join public.employee assignee
            on assignee.employee_id = item.assignee_employee_id
          where item.assignee_employee_id = ${employeeId}::uuid
            and item.archived_at is null
            and (${input?.includeCompleted ?? false} or item.completed_at is null)
            and lower(item.title) like lower(${pattern})
          order by item.completed_at nulls first, personal.position,
            item.due_at nulls last, lower(item.title)
        `);
        return rows.map((item) => ({
          ...item,
          startDate: item.startDate ? String(item.startDate) : null,
          dueAt: iso(item.dueAt),
          completedAt: iso(item.completedAt),
        }));
      }),
    inbox: staffProcedure
      .input(
        z
          .object({
            unreadOnly: z.boolean().default(false),
            kinds: z
              .array(z.enum(["tasks", "messages", "status_updates"]))
              .min(1)
              .max(3)
              .optional(),
          })
          .optional(),
      )
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        if (input?.kinds)
          await requireScopedFeature(
            ctx,
            "work.inbox.message_status_filters",
            null,
          );
        const kinds = input?.kinds ?? ["tasks", "messages", "status_updates"];
        const taskEvents = kinds.includes("tasks");
        const messageEvents = kinds.includes("messages");
        const statusEvents = kinds.includes("status_updates");
        const visibleKind = (notification: WorkNotification) =>
          notification.eventType === "message"
            ? messageEvents
            : notification.eventType === "status_update"
              ? statusEvents
              : taskEvents;
        const featureCache = new Map<string, Promise<boolean>>();
        const db = getDb();
        if (!db) {
          const candidates = [...getDemoWork().notifications.values()].filter(
            (notification) =>
              notification.recipientEmployeeId === employeeId &&
              (!input?.unreadOnly || !notification.readAt) &&
              visibleKind(notification),
          );
          const visibility = await Promise.all(
            candidates.map((notification) =>
              visibleDemoNotification(ctx, notification, featureCache),
            ),
          );
          return candidates
            .filter((_, index) => visibility[index])
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        }
        const rows = await db.execute<
          WorkNotification & {
            createdAt: Date | string;
            readAt: Date | string | null;
            featureClientId: string | null;
          }
        >(sql`
          select notification.work_notification_id as "notificationId",
            notification.work_item_id as "itemId",
            notification.work_project_id as "projectId",
            notification.work_message_id as "messageId",
            notification.event_type as "eventType", notification.message,
            notification.read_at as "readAt", notification.created_at as "createdAt",
            notification_project.client_id as "featureClientId"
          from public.work_notification notification
          left join public.work_project notification_project
            on notification_project.work_project_id = notification.work_project_id
          where notification.recipient_employee_id = ${employeeId}::uuid
            and notification.dismissed_at is null
            and (${input?.unreadOnly ?? false} = false or notification.read_at is null)
            and (
              (${taskEvents} and notification.event_type not in ('message', 'status_update'))
              or (${messageEvents} and notification.event_type = 'message')
              or (${statusEvents} and notification.event_type = 'status_update')
            )
            and (
              notification.work_project_id is null
              or exists (
                select 1 from public.work_project project
                left join public.work_project_member member
                  on member.work_project_id = project.work_project_id
                  and member.employee_id = ${employeeId}::uuid
                left join lateral (
                  select 1 as allowed
                  from public.work_team_project team_project
                  join public.work_team_member team_member
                    on team_member.work_team_id = team_project.work_team_id
                  where team_project.work_project_id = project.work_project_id
                    and team_member.employee_id = ${employeeId}::uuid
                  limit 1
                ) team_access on true
                where project.work_project_id = notification.work_project_id
                  and project.archived_at is null
                  and (
                    project.privacy = 'organization'
                    or project.created_by_employee_id = ${employeeId}::uuid
                    or project.owner_employee_id = ${employeeId}::uuid
                    or member.employee_id is not null
                    or team_access.allowed is not null
                  )
              )
            )
            and (
              notification.work_message_id is null
              or exists (
                select 1 from public.work_message message
                left join public.work_team team
                  on team.work_team_id = message.work_team_id
                left join public.work_team_member team_member
                  on team_member.work_team_id = message.work_team_id
                  and team_member.employee_id = ${employeeId}::uuid
                where message.work_message_id = notification.work_message_id
                  and message.archived_at is null
                  and (
                    (message.work_project_id is not null
                      and message.work_project_id = notification.work_project_id)
                    or (message.work_team_id is not null
                      and team.archived_at is null
                      and (team.privacy = 'public'
                        or team_member.employee_id is not null))
                  )
              )
            )
            and (
              notification.work_item_id is null
              or exists (
                select 1 from public.work_project_item project_item
                where project_item.work_item_id = notification.work_item_id
                  and project_item.work_project_id = notification.work_project_id
              )
            )
          order by notification.created_at desc
          limit 200
        `);
        const visibility = await Promise.all(
          rows.map((row) =>
            notificationFeatureEnabled(
              ctx,
              row.eventType,
              row.projectId,
              row.featureClientId,
              featureCache,
            ),
          ),
        );
        return rows.flatMap((row, index) =>
          visibility[index]
            ? [
                {
                  notificationId: row.notificationId,
                  itemId: row.itemId,
                  projectId: row.projectId,
                  messageId: row.messageId,
                  eventType: row.eventType,
                  message: row.message,
                  readAt: iso(row.readAt),
                  createdAt: new Date(row.createdAt).toISOString(),
                },
              ]
            : [],
        );
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
        const project = await requireProjectAccess(ctx, input.projectId);
        const aiTeammatesEnabled = await featureEnabled("work.ai.teammates", {
          userId: ctx.employeeId,
          clientId: project.clientId,
          roles: ctx.roles,
        });
        const db = getDb();
        if (!db)
          return [...getDemoWork().forms.values()]
            .filter((form) => form.projectId === input.projectId)
            .map((form) => ({
              ...form,
              defaultAssigneeEmployeeId:
                aiTeammatesEnabled ||
                !form.defaultAssigneeEmployeeId ||
                !isDemoWorkAiActor(form.defaultAssigneeEmployeeId)
                  ? form.defaultAssigneeEmployeeId
                  : null,
            }));
        const rows = await db.execute<
          WorkForm & { questions: unknown; defaultAssigneeIsAi: boolean }
        >(sql`
          select work_form_id as "formId", work_project_id as "projectId",
            work_section_id as "sectionId", name, description,
            title_question_key as "titleQuestionKey", questions,
            default_assignee_employee_id as "defaultAssigneeEmployeeId",
            exists (
              select 1 from public.work_ai_teammate teammate
              where teammate.employee_id = form.default_assignee_employee_id
                and teammate.archived_at is null
            ) as "defaultAssigneeIsAi",
            confirmation_message as "confirmationMessage", is_active as "isActive",
            access_level as "accessLevel",
            created_by_employee_id as "createdByEmployeeId"
          from public.work_form form
          where form.work_project_id = ${input.projectId}::uuid
          order by lower(name)
        `);
        return rows.map((form) => {
          const questions = z
            .array(formQuestionSchema)
            .safeParse(form.questions);
          const { defaultAssigneeIsAi, ...visible } = form;
          return {
            ...visible,
            defaultAssigneeEmployeeId:
              aiTeammatesEnabled || !defaultAssigneeIsAi
                ? form.defaultAssigneeEmployeeId
                : null,
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
          accessLevel: z
            .enum(["organization", "anyone", "deactivated"])
            .default("organization"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        if (input.accessLevel === "anyone")
          await requireScopedFeature(ctx, "work.forms.public", input.projectId);
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
          if (question.multiple && question.type !== "attachment")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${question.label} cannot accept multiple files`,
            });
          if (question.showWhen && !keys.has(question.showWhen.key))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `${question.label} has an unknown branch question`,
            });
        }
        if (input.defaultAssigneeEmployeeId)
          await requireAssignableEmployee(
            ctx,
            input.projectId,
            input.defaultAssigneeEmployeeId,
          );
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
          isActive: input.accessLevel !== "deactivated",
          accessLevel: input.accessLevel,
          createdByEmployeeId: actor(ctx),
        };
        const db = getDb();
        if (!db) {
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
          await db.execute(sql`
            insert into public.work_form (
              work_form_id, work_project_id, work_section_id, name, description,
              title_question_key, questions, default_assignee_employee_id,
              confirmation_message, access_level, is_active,
              created_by_employee_id
            ) values (
              ${form.formId}::uuid, ${form.projectId}::uuid, ${form.sectionId}::uuid,
              ${form.name}, ${form.description}, ${form.titleQuestionKey},
              ${JSON.stringify(form.questions)}::jsonb,
              ${form.defaultAssigneeEmployeeId}::uuid, ${form.confirmationMessage},
              ${form.accessLevel}, ${form.isActive},
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
    setAccess: staffProcedure
      .input(
        z.object({
          formId: uuid,
          accessLevel: z.enum(["organization", "anyone", "deactivated"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const form = await workFormById(input.formId);
        if (!form) throw new TRPCError({ code: "NOT_FOUND" });
        await requireProjectAccess(ctx, form.projectId, "editor");
        if (input.accessLevel === "anyone")
          await requireScopedFeature(ctx, "work.forms.public", form.projectId);
        const isActive = input.accessLevel !== "deactivated";
        const db = getDb();
        if (!db)
          Object.assign(getDemoWork().forms.get(input.formId)!, {
            accessLevel: input.accessLevel,
            isActive,
          });
        else
          await db.execute(sql`
            update public.work_form
            set access_level = ${input.accessLevel}, is_active = ${isActive},
              updated_at = now()
            where work_form_id = ${input.formId}::uuid
          `);
        await audit(ctx, "work.form.access", "work_form", input.formId, {
          accessLevel: input.accessLevel,
        });
        return { formId: input.formId, accessLevel: input.accessLevel };
      }),
    setActive: staffProcedure
      .input(z.object({ formId: uuid, active: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const form = await workFormById(input.formId);
        if (!form) throw new TRPCError({ code: "NOT_FOUND" });
        await requireProjectAccess(ctx, form.projectId, "editor");
        const accessLevel = input.active
          ? form.accessLevel === "deactivated"
            ? "organization"
            : form.accessLevel
          : "deactivated";
        const db = getDb();
        if (!db)
          Object.assign(getDemoWork().forms.get(input.formId)!, {
            isActive: input.active,
            accessLevel,
          });
        else
          await db.execute(sql`
            update public.work_form set is_active = ${input.active},
              access_level = ${accessLevel}, updated_at = now()
            where work_form_id = ${input.formId}::uuid
          `);
        await audit(ctx, "work.form.active", "work_form", input.formId, {
          active: input.active,
          accessLevel,
        });
        return { ok: true as const };
      }),
    submit: staffProcedure
      .input(formSubmissionSchema)
      .mutation(({ input, ctx }) => submitWorkForm(ctx, input, false)),
    publicView: publicProcedure
      .input(z.object({ formId: uuid }))
      .query(async ({ input, ctx }) => {
        const form = await workFormById(input.formId);
        if (!form || form.accessLevel !== "anyone" || !form.isActive)
          throw new TRPCError({ code: "NOT_FOUND" });
        await Promise.all([
          requireScopedFeature(ctx, "work.forms", form.projectId),
          requireScopedFeature(ctx, "work.forms.public", form.projectId),
        ]);
        return {
          formId: form.formId,
          name: form.name,
          description: form.description,
          questions: form.questions,
          confirmationMessage: form.confirmationMessage,
        };
      }),
    publicSubmit: publicProcedure
      .input(formSubmissionSchema)
      .mutation(({ input, ctx }) => submitWorkForm(ctx, input, true)),
  }),

  rules: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        const project = await requireProjectAccess(ctx, input.projectId);
        const scope = {
          userId: ctx.employeeId,
          clientId: project.clientId,
          roles: ctx.roles,
        };
        const [
          scheduledEnabled,
          collaboratorEnabled,
          customTypesEnabled,
          externalActionsEnabled,
          apiWebhooksEnabled,
        ] = await Promise.all([
          featureEnabled("work.rules.scheduled", scope),
          featureEnabled("work.rules.collaborator_trigger", scope),
          featureEnabled("work.custom_task_types", scope),
          featureEnabled("work.rules.external_actions", scope),
          featureEnabled("work.api_webhooks", scope),
        ]);
        const visible = (rule: WorkRule) =>
          (rule.triggerType !== "scheduled" || scheduledEnabled) &&
          (rule.triggerType !== "collaborator_added" || collaboratorEnabled) &&
          (customTypesEnabled || !ruleUsesCustomTaskTypes(rule)) &&
          (externalActionsEnabled && apiWebhooksEnabled
            ? true
            : !ruleUsesExternalActions(rule));
        const db = getDb();
        if (!db)
          return [...getDemoWork().rules.values()].filter(
            (rule) => rule.projectId === input.projectId && visible(rule),
          );
        const rows = await db.execute<WorkRule & { branches: unknown }>(sql`
          select work_rule_id as "ruleId", work_project_id as "projectId",
            name, trigger_type as "triggerType",
            schedule_minutes as "scheduleMinutes", branches,
            is_enabled as "isEnabled"
          from public.work_rule
          where work_project_id = ${input.projectId}::uuid
          order by lower(name)
        `);
        return rows.flatMap((rule) => {
          const branches = z.array(ruleBranchSchema).safeParse(rule.branches);
          const normalized = {
            ...rule,
            branches: branches.success ? branches.data : [],
          };
          return visible(normalized) ? [normalized] : [];
        });
      }),
    create: staffProcedure
      .input(
        z
          .object({
            projectId: uuid,
            name: z.string().trim().min(1).max(160),
            branches: z.array(ruleBranchSchema).min(1).max(20),
          })
          .and(workRuleScheduleSchema),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "editor");
        await requireRuleTriggerFeature(
          ctx,
          input.projectId,
          input.triggerType,
        );
        for (const branch of input.branches) {
          if (branch.actions.some((action) => action.type === "send_webhook"))
            await requireExternalRuleFeatures(ctx, input.projectId);
          if (
            branch.conditions.some((condition) =>
              ["customTaskTypeId", "customTaskStatusOptionId"].includes(
                condition.field,
              ),
            ) ||
            branch.actions.some(
              (action) => action.type === "set_custom_task_status",
            )
          )
            await requireScopedFeature(
              ctx,
              "work.custom_task_types",
              input.projectId,
            );
          await validateRuleActions(input.projectId, branch.actions, ctx);
          for (const condition of branch.conditions)
            await validateCustomTaskRuleCondition(
              input.projectId,
              condition,
              ctx,
            );
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
          ownerEmployeeId: actor(ctx),
          name: input.name,
          triggerType: input.triggerType,
          scheduleMinutes: input.scheduleMinutes,
          branches: input.branches,
          isEnabled: true,
        };
        const db = getDb();
        if (!db) getDemoWork().rules.set(rule.ruleId, rule);
        else {
          const employeeId = actor(ctx);
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              insert into public.work_rule (
                work_rule_id, work_project_id, name, trigger_type,
                schedule_minutes, branches, owner_employee_id
              ) values (
                ${rule.ruleId}::uuid, ${rule.projectId}::uuid, ${rule.name},
                ${rule.triggerType}, ${rule.scheduleMinutes},
                ${JSON.stringify(rule.branches)}::jsonb, ${employeeId}::uuid
              )
            `);
            if (rule.triggerType === "scheduled")
              await tx.execute(sql`
                insert into public.scheduled_job (job_key, kind, run_at, payload)
                values (
                  ${`work-rule-schedule:${rule.ruleId}`}, 'work_rule',
                  now() + (${rule.scheduleMinutes}::text || ' minutes')::interval,
                  ${JSON.stringify({
                    ruleId: rule.ruleId,
                    actorEmployeeId: employeeId,
                  })}::jsonb
                ) on conflict (job_key) do update set status = 'pending',
                  run_at = excluded.run_at, payload = excluded.payload,
                  attempts = 0, locked_at = null, completed_at = null,
                  last_error = null, updated_at = now()
              `);
          });
        }
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
              await db.execute<{
                projectId: string;
                triggerType: WorkRule["triggerType"];
                scheduleMinutes: number | null;
                ownerEmployeeId: string;
                branches: unknown;
              }>(sql`
                select work_project_id as "projectId",
                  trigger_type as "triggerType",
                  schedule_minutes as "scheduleMinutes",
                  owner_employee_id as "ownerEmployeeId", branches
                from public.work_rule
                where work_rule_id = ${input.ruleId}::uuid
              `)
            )[0];
        if (!rule) throw new TRPCError({ code: "NOT_FOUND" });
        await requireProjectAccess(ctx, rule.projectId, "editor");
        const parsedBranches = z
          .array(ruleBranchSchema)
          .safeParse(rule.branches);
        const hasExternalActions =
          parsedBranches.success &&
          ruleUsesExternalActions({ branches: parsedBranches.data });
        if (hasExternalActions)
          await requireExternalRuleFeatures(ctx, rule.projectId);
        if (
          hasExternalActions &&
          rule.ownerEmployeeId &&
          rule.ownerEmployeeId !== actor(ctx)
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the external rule owner can change it",
          });
        if (input.enabled)
          await requireRuleTriggerFeature(
            ctx,
            rule.projectId,
            rule.triggerType,
          );
        if (input.enabled) {
          if (
            ruleUsesCustomTaskTypes({
              triggerType: rule.triggerType,
              branches: parsedBranches.success ? parsedBranches.data : [],
            })
          )
            await requireScopedFeature(
              ctx,
              "work.custom_task_types",
              rule.projectId,
            );
          if (parsedBranches.success)
            for (const branch of parsedBranches.data) {
              await validateRuleActions(rule.projectId, branch.actions, ctx);
              for (const condition of branch.conditions)
                await validateCustomTaskRuleCondition(
                  rule.projectId,
                  condition,
                  ctx,
                );
            }
        }
        if (!db)
          getDemoWork().rules.get(input.ruleId)!.isEnabled = input.enabled;
        else
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              update public.work_rule set is_enabled = ${input.enabled}, updated_at = now()
              where work_rule_id = ${input.ruleId}::uuid
            `);
            await tx.execute(sql`
              update public.scheduled_job set status = 'completed',
                completed_at = now(), locked_at = null, updated_at = now()
              where job_key = ${`work-rule-schedule:${input.ruleId}`}
                and status in ('pending', 'running')
            `);
            if (input.enabled && rule.triggerType === "scheduled")
              await tx.execute(sql`
                insert into public.scheduled_job (job_key, kind, run_at, payload)
                values (
                  ${`work-rule-schedule:${input.ruleId}`}, 'work_rule',
                  now() + (${rule.scheduleMinutes}::text || ' minutes')::interval,
                  ${JSON.stringify({
                    ruleId: input.ruleId,
                    actorEmployeeId:
                      "ownerEmployeeId" in rule
                        ? rule.ownerEmployeeId
                        : actor(ctx),
                  })}::jsonb
                ) on conflict (job_key) do update set status = 'pending',
                  run_at = excluded.run_at, payload = excluded.payload,
                  attempts = 0, locked_at = null, completed_at = null,
                  last_error = null, updated_at = now()
              `);
          });
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
        const project = await requireProjectAccess(ctx, input.projectId);
        const scope = {
          userId: ctx.employeeId,
          clientId: project.clientId,
          roles: ctx.roles,
        };
        const [
          scheduledEnabled,
          collaboratorEnabled,
          externalActionsEnabled,
          apiWebhooksEnabled,
        ] = await Promise.all([
          featureEnabled("work.rules.scheduled", scope),
          featureEnabled("work.rules.collaborator_trigger", scope),
          featureEnabled("work.rules.external_actions", scope),
          featureEnabled("work.api_webhooks", scope),
        ]);
        const visible = (run: WorkRuleRun, rule?: WorkRule) =>
          (run.triggerType !== "scheduled" || scheduledEnabled) &&
          (run.triggerType !== "collaborator_added" || collaboratorEnabled) &&
          (externalActionsEnabled && apiWebhooksEnabled
            ? true
            : !rule || !ruleUsesExternalActions(rule));
        const db = getDb();
        if (!db) {
          const rules = new Map(
            [...getDemoWork().rules.values()]
              .filter((rule) => rule.projectId === input.projectId)
              .map((rule) => [rule.ruleId, rule]),
          );
          return [...getDemoWork().ruleRuns.values()]
            .filter((run) => {
              const rule = rules.get(run.ruleId);
              return rule && visible(run, rule);
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, input.limit);
        }
        const rows = await db.execute<
          WorkRuleRun & { createdAt: Date | string; branches: unknown }
        >(sql`
          select run.work_rule_run_id as "ruleRunId",
            run.work_rule_id as "ruleId", run.work_item_id as "itemId",
            run.trigger_type as "triggerType", run.status, run.output,
            run.error_message as "errorMessage", run.created_at as "createdAt",
            rule.branches
          from public.work_rule_run run
          join public.work_rule rule on rule.work_rule_id = run.work_rule_id
          where rule.work_project_id = ${input.projectId}::uuid
          order by run.created_at desc limit ${input.limit}
        `);
        return rows.flatMap(({ branches, ...run }) => {
          const parsed = z.array(ruleBranchSchema).safeParse(branches);
          const rule = {
            ruleId: run.ruleId,
            projectId: input.projectId,
            name: "",
            triggerType: run.triggerType,
            scheduleMinutes: null,
            branches: parsed.success ? parsed.data : [],
            isEnabled: true,
          } satisfies WorkRule;
          return visible(run, rule)
            ? [{ ...run, createdAt: new Date(run.createdAt).toISOString() }]
            : [];
        });
      }),
  }),

  templates: router({
    list: staffProcedure
      .input(z.object({ projectId: uuid.optional() }).optional())
      .query(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        if (input?.projectId) await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        const templates = !db
          ? [...getDemoWork().templates.values()].filter(
              (template) =>
                (template.templateType === "project" &&
                  template.createdByEmployeeId === employeeId) ||
                template.projectId === input?.projectId,
            )
          : await db.execute<WorkTemplate>(sql`
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
        return Promise.all(
          templates.map(async (template) => {
            const parsed = projectTemplateBlueprintSchema.safeParse(
              template.blueprint,
            );
            if (template.templateType !== "project" || !parsed.success)
              return { ...template, rolePlaceholders: [] };
            const rolePlaceholdersEnabled = await featureEnabled(
              "work.templates.roles",
              {
                userId: ctx.employeeId,
                clientId: parsed.data.clientId,
                roles: ctx.roles,
              },
            );
            return {
              ...template,
              blueprint: rolePlaceholdersEnabled
                ? parsed.data
                : {
                    ...parsed.data,
                    roles: [],
                    tasks: parsed.data.tasks.map((task) => ({
                      ...task,
                      assigneeRoleId: null,
                    })),
                  },
              rolePlaceholders: rolePlaceholdersEnabled
                ? parsed.data.roles
                : [],
            };
          }),
        );
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
          await validateRuleActions(
            input.projectId,
            [
              {
                type: "assign",
                employeeId: input.blueprint.assigneeEmployeeId,
              },
            ],
            ctx,
          );
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
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(160),
          roles: z
            .array(
              z.object({
                employeeId: uuid,
                name: z.string().trim().min(1).max(120),
              }),
            )
            .max(100)
            .default([]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const project = await requireProjectAccess(
          ctx,
          input.projectId,
          "editor",
        );
        if (input.roles.length) {
          await requireScopedFeature(
            ctx,
            "work.templates.roles",
            input.projectId,
          );
          if (
            new Set(input.roles.map((role) => role.employeeId)).size !==
              input.roles.length ||
            new Set(input.roles.map((role) => role.name.toLowerCase())).size !==
              input.roles.length
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Template roles must have unique people and names",
            });
          await validateRuleActions(
            input.projectId,
            input.roles.map((role) => ({
              type: "assign" as const,
              employeeId: role.employeeId,
            })),
            ctx,
          );
        }
        const roles = input.roles.map((role) => ({
          roleId: randomUUID(),
          name: role.name,
          employeeId: role.employeeId,
        }));
        const roleByEmployeeId = new Map(
          roles.map((role) => [role.employeeId, role.roleId]),
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
            clientId: project.clientId,
            roles: roles.map(({ roleId, name }) => ({ roleId, name })),
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
                assigneeRoleId: item.assigneeEmployeeId
                  ? (roleByEmployeeId.get(item.assigneeEmployeeId) ?? null)
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
            assigneeEmployeeId: string | null;
          }>(sql`
            select item.title, item.description, item.item_type as "itemType",
              item.priority, section.name as "sectionName", item.due_at as "dueAt",
              item.assignee_employee_id as "assigneeEmployeeId"
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
            clientId: project.clientId,
            roles: roles.map(({ roleId, name }) => ({ roleId, name })),
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
              assigneeRoleId: task.assigneeEmployeeId
                ? (roleByEmployeeId.get(task.assigneeEmployeeId) ?? null)
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
            roles: blueprint.roles.length,
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
        if (parsed.data.assigneeEmployeeId)
          await requireAssignableEmployee(
            ctx,
            input.projectId,
            parsed.data.assigneeEmployeeId,
          );
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
        if (parsed.data.assigneeEmployeeId)
          await queueAssignedWorkAiTeammate(
            ctx,
            itemId,
            parsed.data.assigneeEmployeeId,
          );
        await runProjectRules(ctx, input.projectId, itemId, "task_added");
        return { itemId };
      }),
    instantiateProject: staffProcedure
      .input(
        z.object({
          templateId: uuid,
          name: z.string().trim().min(1).max(160),
          referenceDate: z.string().date(),
          roleAssignments: z.record(uuid, nullableUuid).default({}),
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
        for (const featureKey of ["work.projects", "work.templates"])
          if (
            !(await featureEnabled(featureKey, {
              userId: ctx.employeeId,
              clientId: parsed.data.clientId,
              roles: ctx.roles,
            }))
          )
            throw new TRPCError({
              code: "FORBIDDEN",
              message: `FEATURE_DISABLED:${featureKey}`,
            });
        const roleIds = new Set(parsed.data.roles.map((role) => role.roleId));
        if (
          Object.keys(input.roleAssignments).some(
            (roleId) => !roleIds.has(roleId),
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Template role not found",
          });
        const assignedEmployeeIds = Object.values(input.roleAssignments).filter(
          (employeeId): employeeId is string => Boolean(employeeId),
        );
        if (assignedEmployeeIds.length) {
          if (
            !(await featureEnabled("work.templates.roles", {
              userId: ctx.employeeId,
              clientId: parsed.data.clientId,
              roles: ctx.roles,
            }))
          )
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "FEATURE_DISABLED:work.templates.roles",
            });
          await validateRuleActions(
            randomUUID(),
            assignedEmployeeIds.map((employeeId) => ({
              type: "assign" as const,
              employeeId,
            })),
          );
        }
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
            clientId: parsed.data.clientId,
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
            const assigneeEmployeeId = task.assigneeRoleId
              ? (input.roleAssignments[task.assigneeRoleId] ?? null)
              : null;
            store.items.set(itemId, {
              itemId,
              parentItemId: null,
              title: task.title,
              description: task.description,
              itemType: task.itemType,
              priority: task.priority,
              assigneeEmployeeId,
              assigneeName: assigneeEmployeeId ? "Assigned user" : null,
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
                client_id, owner_employee_id, created_by_employee_id
              ) values (
                ${projectId}::uuid, ${input.name}, ${parsed.data.description},
                ${parsed.data.color}, ${parsed.data.privacy},
                ${parsed.data.clientId}::uuid, ${actor(ctx)}::uuid,
                ${actor(ctx)}::uuid
              )
            `);
            await tx.execute(sql`
              insert into public.work_project_member (
                work_project_id, employee_id, access_level
              ) values (${projectId}::uuid, ${actor(ctx)}::uuid, 'admin')
            `);
            for (const employeeId of new Set(assignedEmployeeIds)) {
              if (employeeId === actor(ctx)) continue;
              await tx.execute(sql`
                insert into public.work_project_member (
                  work_project_id, employee_id, access_level
                ) values (${projectId}::uuid, ${employeeId}::uuid, 'editor')
                on conflict (work_project_id, employee_id) do nothing
              `);
            }
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
              const assigneeEmployeeId = task.assigneeRoleId
                ? (input.roleAssignments[task.assigneeRoleId] ?? null)
                : null;
              await tx.execute(sql`
                insert into public.work_item (
                  work_item_id, title, description, item_type, priority,
                  assignee_employee_id, created_by_employee_id, due_at
                ) values (
                  ${itemId}::uuid, ${task.title}, ${task.description},
                  ${task.itemType}, ${task.priority},
                  ${assigneeEmployeeId}::uuid, ${actor(ctx)}::uuid,
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
          assignedRoles: assignedEmployeeIds.length,
        });
        return { projectId };
      }),
  }),

  bundles: router({
    list: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db) {
        const store = getDemoWork();
        return [...store.bundles.values()]
          .filter(
            (bundle) =>
              bundle.visibility === "organization" ||
              bundle.createdByEmployeeId === employeeId,
          )
          .map((bundle) => {
            const installations = [...store.projectBundles.entries()].filter(
              ([key]) => key.endsWith(`:${bundle.bundleId}`),
            );
            return {
              ...bundle,
              installedProjectCount: installations.length,
              currentProjectCount: installations.filter(
                ([, installation]) => installation.version === bundle.version,
              ).length,
            };
          });
      }
      const rows = await db.execute<WorkBundle & { blueprint: unknown }>(sql`
        select bundle.work_bundle_id as "bundleId", bundle.name,
          bundle.description, bundle.visibility,
          bundle.created_by_employee_id as "createdByEmployeeId",
          latest.version, latest.blueprint,
          (select count(*)::int from public.work_project_bundle installation
            where installation.work_bundle_id = bundle.work_bundle_id)
            as "installedProjectCount",
          (select count(*)::int from public.work_project_bundle installation
            where installation.work_bundle_id = bundle.work_bundle_id
              and installation.applied_version = latest.version)
            as "currentProjectCount"
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
        await requireBundleCustomTaskTypeAccess(
          ctx,
          input.projectId,
          blueprint,
        );
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
        await requireBundleCustomTaskTypeAccess(
          ctx,
          input.sourceProjectId,
          blueprint,
        );
        const version = bundle.version + 1;
        const installedProjectIds = !db
          ? [...getDemoWork().projectBundles.keys()]
              .filter((key) => key.endsWith(`:${input.bundleId}`))
              .map((key) => key.slice(0, -input.bundleId.length - 1))
          : (
              await db.execute<{ projectId: string }>(sql`
                select work_project_id as "projectId"
                from public.work_project_bundle
                where work_bundle_id = ${input.bundleId}::uuid
              `)
            ).map((installation) => installation.projectId);
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
        const rollout = await rolloutPublishedBundle(
          ctx,
          input.bundleId,
          installedProjectIds,
        );
        await audit(ctx, "work.bundle.publish", "work_bundle", input.bundleId, {
          sourceProjectId: input.sourceProjectId,
          version,
          rollout,
        });
        return { bundleId: input.bundleId, version, rollout };
      }),
    applyToProject: staffProcedure
      .input(z.object({ bundleId: uuid, projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const automaticRollout =
          ctx.workBundleRollout?.bundleId === input.bundleId;
        if (!automaticRollout)
          await requireProjectAccess(ctx, input.projectId, "editor");
        else {
          const db = getDb();
          const exists = !db
            ? getDemoWork().projects.has(input.projectId)
            : Boolean(
                (
                  await db.execute(sql`
                    select 1 from public.work_project
                    where work_project_id = ${input.projectId}::uuid
                      and archived_at is null
                  `)
                )[0],
              );
          if (!exists) throw new TRPCError({ code: "NOT_FOUND" });
        }
        await requireScopedFeature(ctx, "work.bundles", input.projectId);
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
        if (parsed.data.sections.length)
          await requireScopedFeature(ctx, "work.sections", input.projectId);
        if (parsed.data.customFields.length)
          await requireScopedFeature(
            ctx,
            "work.custom_fields",
            input.projectId,
          );
        if (parsed.data.rules.length)
          await requireScopedFeature(ctx, "work.rules", input.projectId);
        if (parsed.data.taskTemplates.length)
          await requireScopedFeature(ctx, "work.templates", input.projectId);
        await requireBundleCustomTaskTypeAccess(
          ctx,
          input.projectId,
          parsed.data,
        );
        const bundledTypeIds = new Set(
          parsed.data.customTaskTypes.map((type) => type.customTaskTypeId),
        );
        const bundledStatusTypeIds = new Map(
          parsed.data.customTaskTypes.flatMap((type) =>
            type.statuses
              .filter((status) => status.enabled)
              .map((status) => [status.statusOptionId, type.customTaskTypeId]),
          ),
        );
        const bundleHasAction = (action: WorkRuleAction) =>
          action.type === "set_custom_task_status" &&
          bundledTypeIds.has(action.customTaskTypeId) &&
          bundledStatusTypeIds.get(action.statusOptionId) ===
            action.customTaskTypeId;
        const bundleHasCondition = (
          condition: WorkRuleBranch["conditions"][number],
        ) =>
          typeof condition.value === "string" &&
          ((condition.field === "customTaskTypeId" &&
            bundledTypeIds.has(condition.value)) ||
            (condition.field === "customTaskStatusOptionId" &&
              bundledStatusTypeIds.has(condition.value)));
        if (parsed.data.customTaskTypes.length) {
          if (!db) {
            for (const captured of parsed.data.customTaskTypes) {
              const live = getDemoWork().customTaskTypes.get(
                captured.customTaskTypeId,
              );
              if (
                !live ||
                captured.statuses.some(
                  (status) =>
                    !live.statuses.some(
                      (candidate) =>
                        candidate.statusOptionId === status.statusOptionId,
                    ),
                )
              )
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "A bundled custom task type is no longer available",
                });
            }
          } else {
            for (const captured of parsed.data.customTaskTypes) {
              const [live] = await db.execute<{ statusCount: number }>(sql`
                select count(status.work_custom_task_status_option_id)::int
                  as "statusCount"
                from public.work_custom_task_type type
                join public.work_custom_task_status_option status
                  on status.work_custom_task_type_id = type.work_custom_task_type_id
                where type.work_custom_task_type_id = ${captured.customTaskTypeId}::uuid
                  and type.archived_at is null
                  and status.work_custom_task_status_option_id in ${sql`(${sql.join(
                    captured.statuses.map(
                      (status) => sql`${status.statusOptionId}::uuid`,
                    ),
                    sql`, `,
                  )})`}
              `);
              if ((live?.statusCount ?? 0) !== captured.statuses.length)
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: "A bundled custom task type is no longer available",
                });
            }
          }
        }
        for (const rule of parsed.data.rules) {
          await requireRuleTriggerFeature(
            ctx,
            input.projectId,
            rule.triggerType,
          );
          if (ruleUsesExternalActions(rule))
            await requireExternalRuleFeatures(ctx, input.projectId);
          if (ruleUsesCustomTaskTypes(rule)) {
            await requireScopedFeature(
              ctx,
              "work.custom_task_types",
              input.projectId,
            );
            for (const branch of rule.branches) {
              await validateRuleActions(
                input.projectId,
                branch.actions.filter(
                  (action) =>
                    action.type === "set_custom_task_status" &&
                    !bundleHasAction(action),
                ),
                ctx,
              );
              for (const condition of branch.conditions)
                if (!bundleHasCondition(condition))
                  await validateCustomTaskRuleCondition(
                    input.projectId,
                    condition,
                    ctx,
                  );
            }
          }
        }
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
          for (const type of parsed.data.customTaskTypes) {
            const hasDefault = [...store.projectCustomTaskTypes.values()].some(
              (association) =>
                association.projectId === input.projectId &&
                association.isDefault,
            );
            store.projectCustomTaskTypes.set(
              customTaskTypeProjectKey(input.projectId, type.customTaskTypeId),
              {
                projectId: input.projectId,
                customTaskTypeId: type.customTaskTypeId,
                isDefault: type.isDefault && !hasDefault,
              },
            );
          }
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
              ownerEmployeeId: employeeId,
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
            for (const type of parsed.data.customTaskTypes)
              await tx.execute(sql`
                insert into public.work_project_custom_task_type (
                  work_project_id, work_custom_task_type_id, is_default
                ) values (
                  ${input.projectId}::uuid, ${type.customTaskTypeId}::uuid,
                  ${type.isDefault} and not exists (
                    select 1 from public.work_project_custom_task_type
                    where work_project_id = ${input.projectId}::uuid and is_default
                  )
                ) on conflict (work_project_id, work_custom_task_type_id)
                do update set
                  is_default = work_project_custom_task_type.is_default
                    or excluded.is_default,
                  updated_at = now()
              `);
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
              const [upserted] = await tx.execute<{
                ruleId: string;
                ownerEmployeeId: string;
                isEnabled: boolean;
              }>(sql`
                insert into public.work_rule (
                  work_project_id, name, trigger_type, schedule_minutes,
                  branches, owner_employee_id
                ) values (
                  ${input.projectId}::uuid, ${rule.name}, ${rule.triggerType},
                  ${rule.scheduleMinutes}, ${JSON.stringify(branches)}::jsonb,
                  ${employeeId}::uuid
                ) on conflict (work_project_id, name) do update
                  set trigger_type = excluded.trigger_type,
                    schedule_minutes = excluded.schedule_minutes,
                    branches = excluded.branches, updated_at = now()
                returning work_rule_id as "ruleId",
                  owner_employee_id as "ownerEmployeeId",
                  is_enabled as "isEnabled"
              `);
              await tx.execute(sql`
                update public.scheduled_job set status = 'completed',
                  completed_at = now(), locked_at = null, updated_at = now()
                where job_key = ${`work-rule-schedule:${upserted!.ruleId}`}
                  and status in ('pending', 'running')
              `);
              if (rule.triggerType === "scheduled" && upserted!.isEnabled)
                await tx.execute(sql`
                  insert into public.scheduled_job (job_key, kind, run_at, payload)
                  values (
                    ${`work-rule-schedule:${upserted!.ruleId}`}, 'work_rule',
                    now() + (${rule.scheduleMinutes}::text || ' minutes')::interval,
                    ${JSON.stringify({
                      ruleId: upserted!.ruleId,
                      actorEmployeeId: upserted!.ownerEmployeeId,
                    })}::jsonb
                  ) on conflict (job_key) do update set status = 'pending',
                    run_at = excluded.run_at, payload = excluded.payload,
                    attempts = 0, locked_at = null, completed_at = null,
                    last_error = null, updated_at = now()
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
          automaticRollout,
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
            select goal.work_goal_id as "goalId",
              goal.parent_work_goal_id as "parentGoalId", goal.name,
              goal.description, goal.scope,
              goal.owner_employee_id as "ownerEmployeeId",
              owner.display_name as "ownerName", goal.status, goal.progress,
              goal.start_date::text as "startDate",
              goal.due_date::text as "dueDate", goal.privacy,
              goal.created_by_employee_id as "createdByEmployeeId",
              goal.created_at as "createdAt"
            from public.work_goal goal
            left join public.employee owner
              on owner.employee_id = goal.owner_employee_id
            where goal.archived_at is null and (
              goal.privacy = 'organization' or goal.owner_employee_id = ${employeeId}::uuid
              or goal.created_by_employee_id = ${employeeId}::uuid
            )
            order by goal.due_date nulls last, lower(goal.name)
          `);
      return Promise.all(
        goals.map(async (goal) => ({
          ...goal,
          ownerName:
            goal.ownerName ??
            (goal.ownerEmployeeId === employeeId
              ? (ctx.user?.displayName ?? "You")
              : goal.ownerEmployeeId
                ? "Member"
                : null),
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
            select portfolio.work_portfolio_id as "portfolioId",
              portfolio.name, portfolio.description, portfolio.color,
              portfolio.privacy,
              portfolio.owner_employee_id as "ownerEmployeeId",
              owner.display_name as "ownerName",
              portfolio.created_by_employee_id as "createdByEmployeeId",
              portfolio.created_at as "createdAt"
            from public.work_portfolio portfolio
            left join public.employee owner
              on owner.employee_id = portfolio.owner_employee_id
            where portfolio.archived_at is null and (
              portfolio.privacy = 'organization'
              or portfolio.owner_employee_id = ${employeeId}::uuid
              or portfolio.created_by_employee_id = ${employeeId}::uuid
            ) order by lower(portfolio.name)
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
            ownerName:
              portfolio.ownerName ??
              (portfolio.ownerEmployeeId === employeeId
                ? (ctx.user?.displayName ?? "You")
                : portfolio.ownerEmployeeId
                  ? "Member"
                  : null),
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
        if (input.targetType === "project") {
          await requireScopedFeature(
            ctx,
            "work.status_updates",
            input.targetId,
          );
          await requireProjectAccess(ctx, input.targetId);
        } else if (input.targetType === "portfolio")
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
        if (input.targetType === "project") {
          await requireScopedFeature(
            ctx,
            "work.status_updates",
            input.targetId,
          );
          await requireProjectAccess(ctx, input.targetId, "editor");
        } else if (input.targetType === "portfolio")
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
        await notifyStatusUpdate(ctx, update);
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
    numericFields: staffProcedure
      .input(
        z
          .object({ projectId: uuid.optional(), portfolioId: uuid.optional() })
          .refine(
            (value) => Boolean(value.projectId) !== Boolean(value.portfolioId),
            "Choose one reporting scope",
          ),
      )
      .query(async ({ input, ctx }) => {
        const strictProject = Boolean(input.projectId);
        let projectIds: string[];
        if (input.projectId) {
          await requireProjectAccess(ctx, input.projectId);
          projectIds = [input.projectId];
        } else {
          projectIds = await portfolioReportingProjectIds(
            ctx,
            input.portfolioId!,
          );
        }
        return (await numericReportFields(ctx, projectIds, strictProject)).map(
          ({ key, name, projectIds }) => ({
            key,
            name,
            projectCount: projectIds.length,
          }),
        );
      }),
    chart: staffProcedure
      .input(z.object({ projectId: uuid, spec: reportChartSpecSchema }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        if (input.spec.groupBy === "custom_field")
          await requireProjectCustomField(
            ctx,
            input.projectId,
            input.spec.customFieldId!,
          );
        const metricCustomFieldIds = input.spec.metricCustomFieldKey
          ? await resolveNumericReportFieldIds(
              ctx,
              [input.projectId],
              input.spec.metricCustomFieldKey,
              true,
            )
          : [];
        const rows = await reportRowsForProjects(
          ctx,
          [input.projectId],
          input.spec,
          metricCustomFieldIds,
        );
        return buildWorkReportChart(rows, input.spec);
      }),
    portfolioChart: staffProcedure
      .input(z.object({ portfolioId: uuid, spec: reportChartSpecSchema }))
      .query(async ({ input, ctx }) => {
        if (input.spec.groupBy === "custom_field")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Custom-field charts require a single project",
          });
        const projectIds = await portfolioReportingProjectIds(
          ctx,
          input.portfolioId,
        );
        const metricCustomFieldIds = input.spec.metricCustomFieldKey
          ? await resolveNumericReportFieldIds(
              ctx,
              projectIds,
              input.spec.metricCustomFieldKey,
              false,
            )
          : [];
        return buildWorkReportChart(
          await reportRowsForProjects(
            ctx,
            projectIds,
            input.spec,
            metricCustomFieldIds,
          ),
          input.spec,
        );
      }),
    dashboards: staffProcedure.query(async ({ ctx }) => {
      const employeeId = actor(ctx);
      const db = getDb();
      const dashboards = !db
        ? [...getDemoWork().dashboards.values()].flatMap((item) =>
            item.ownerEmployeeId === employeeId ||
            item.visibility === "organization" ||
            item.viewerEmployeeIds.includes(employeeId)
              ? [
                  {
                    ...item,
                    viewerEmployeeIds:
                      item.ownerEmployeeId === employeeId
                        ? item.viewerEmployeeIds
                        : [],
                    currentAccess:
                      item.ownerEmployeeId === employeeId
                        ? ("admin" as const)
                        : ("viewer" as const),
                  },
                ]
              : [],
          )
        : await db.execute<WorkDashboard>(sql`
            select dashboard.work_reporting_dashboard_id as "dashboardId",
              dashboard.owner_employee_id as "ownerEmployeeId",
              dashboard.name, dashboard.config, dashboard.visibility,
              case when dashboard.owner_employee_id = ${employeeId}::uuid
                then 'admin' else 'viewer' end as "currentAccess",
              case when dashboard.owner_employee_id = ${employeeId}::uuid
                then coalesce((select array_agg(viewer.employee_id order by viewer.created_at)
                  from public.work_reporting_dashboard_viewer viewer
                  where viewer.work_reporting_dashboard_id = dashboard.work_reporting_dashboard_id
                ), array[]::uuid[])
                else array[]::uuid[] end as "viewerEmployeeIds"
            from public.work_reporting_dashboard dashboard
            where dashboard.owner_employee_id = ${employeeId}::uuid
              or dashboard.visibility = 'organization'
              or exists (
                select 1 from public.work_reporting_dashboard_viewer viewer
                where viewer.work_reporting_dashboard_id = dashboard.work_reporting_dashboard_id
                  and viewer.employee_id = ${employeeId}::uuid
              )
            order by lower(dashboard.name)
          `);
      const visible: WorkDashboard[] = [];
      for (const dashboard of dashboards) {
        try {
          await requireDashboardAccess(ctx, dashboard.config);
          visible.push(dashboard);
        } catch (error) {
          if (!(error instanceof TRPCError)) throw error;
        }
      }
      return visible;
    }),
    saveDashboard: staffProcedure
      .input(
        z.object({
          dashboardId: uuid.optional(),
          name: z.string().trim().min(1).max(160),
          config: dashboardConfigSchema,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        await requireDashboardAccess(ctx, input.config);
        const dashboard: WorkDashboard = {
          dashboardId: input.dashboardId ?? randomUUID(),
          ownerEmployeeId: employeeId,
          name: input.name,
          config: input.config,
          visibility: "private",
          viewerEmployeeIds: [],
          currentAccess: "admin",
        };
        const db = getDb();
        if (!db) {
          const existing = getDemoWork().dashboards.get(dashboard.dashboardId);
          if (existing && existing.ownerEmployeeId !== employeeId)
            throw new TRPCError({ code: "NOT_FOUND" });
          if (existing) {
            dashboard.visibility = existing.visibility;
            dashboard.viewerEmployeeIds = existing.viewerEmployeeIds;
          }
          getDemoWork().dashboards.set(dashboard.dashboardId, dashboard);
        } else {
          const [saved] = await db.execute<{
            visibility: WorkDashboard["visibility"];
          }>(sql`
            insert into public.work_reporting_dashboard (
              work_reporting_dashboard_id, owner_employee_id, name, config
            ) values (
              ${dashboard.dashboardId}::uuid, ${employeeId}::uuid,
              ${dashboard.name}, ${JSON.stringify(dashboard.config)}::jsonb
            ) on conflict (work_reporting_dashboard_id) do update
              set name = excluded.name, config = excluded.config, updated_at = now()
              where work_reporting_dashboard.owner_employee_id = ${employeeId}::uuid
            returning visibility
          `);
          if (!saved) throw new TRPCError({ code: "NOT_FOUND" });
          dashboard.visibility = saved.visibility;
          dashboard.viewerEmployeeIds = (
            await db.execute<{ employeeId: string }>(sql`
              select employee_id as "employeeId"
              from public.work_reporting_dashboard_viewer
              where work_reporting_dashboard_id = ${dashboard.dashboardId}::uuid
              order by created_at
            `)
          ).map((viewer) => viewer.employeeId);
        }
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
    shareDashboard: staffProcedure
      .input(
        z.object({
          dashboardId: uuid,
          visibility: z.enum(["private", "organization"]),
          viewerEmployeeIds: z.array(uuid).max(500).default([]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx);
        const viewerEmployeeIds = [
          ...new Set(input.viewerEmployeeIds.filter((id) => id !== employeeId)),
        ];
        const db = getDb();
        let dashboard: WorkDashboard;
        if (!db) {
          const existing = getDemoWork().dashboards.get(input.dashboardId);
          if (!existing || existing.ownerEmployeeId !== employeeId)
            throw new TRPCError({ code: "NOT_FOUND" });
          await requireDashboardAccess(ctx, existing.config);
          dashboard = {
            ...existing,
            visibility: input.visibility,
            viewerEmployeeIds,
            currentAccess: "admin",
          };
          getDemoWork().dashboards.set(input.dashboardId, dashboard);
        } else {
          const [existing] = await db.execute<{
            dashboardId: string;
            ownerEmployeeId: string;
            name: string;
            config: Record<string, unknown>;
          }>(sql`
            select work_reporting_dashboard_id as "dashboardId",
              owner_employee_id as "ownerEmployeeId", name, config
            from public.work_reporting_dashboard
            where work_reporting_dashboard_id = ${input.dashboardId}::uuid
              and owner_employee_id = ${employeeId}::uuid
            limit 1
          `);
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          await requireDashboardAccess(ctx, existing.config);
          await db.transaction(async (tx) => {
            if (viewerEmployeeIds.length) {
              const active = await tx.execute<{ employeeId: string }>(sql`
                select employee_id as "employeeId"
                from public.employee
                where employee_id = any(${viewerEmployeeIds}::uuid[])
                  and is_active = true
              `);
              if (active.length !== viewerEmployeeIds.length)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "One or more viewers are unavailable",
                });
            }
            const [updated] = await tx.execute<{ dashboardId: string }>(sql`
              update public.work_reporting_dashboard
              set visibility = ${input.visibility}, updated_at = now()
              where work_reporting_dashboard_id = ${input.dashboardId}::uuid
                and owner_employee_id = ${employeeId}::uuid
              returning work_reporting_dashboard_id as "dashboardId"
            `);
            if (!updated) throw new TRPCError({ code: "NOT_FOUND" });
            await tx.execute(sql`
              delete from public.work_reporting_dashboard_viewer
              where work_reporting_dashboard_id = ${input.dashboardId}::uuid
            `);
            if (viewerEmployeeIds.length)
              await tx.execute(sql`
                insert into public.work_reporting_dashboard_viewer (
                  work_reporting_dashboard_id, employee_id, added_by_employee_id
                )
                select ${input.dashboardId}::uuid, viewer_id, ${employeeId}::uuid
                from unnest(${viewerEmployeeIds}::uuid[]) viewer_id
              `);
          });
          dashboard = {
            ...existing,
            visibility: input.visibility,
            viewerEmployeeIds,
            currentAccess: "admin",
          };
        }
        await audit(
          ctx,
          "work.dashboard.share",
          "work_reporting_dashboard",
          dashboard.dashboardId,
          {
            visibility: dashboard.visibility,
            viewerCount: dashboard.viewerEmployeeIds.length,
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
          await requireDashboardAccess(ctx, dashboard.config);
          getDemoWork().dashboards.delete(input.dashboardId);
        } else {
          const [dashboard] = await db.execute<{
            config: Record<string, unknown>;
          }>(sql`
            select config from public.work_reporting_dashboard
            where work_reporting_dashboard_id = ${input.dashboardId}::uuid
              and owner_employee_id = ${employeeId}::uuid
            limit 1
          `);
          if (!dashboard) throw new TRPCError({ code: "NOT_FOUND" });
          await requireDashboardAccess(ctx, dashboard.config);
          await db.execute(sql`
            delete from public.work_reporting_dashboard
            where work_reporting_dashboard_id = ${input.dashboardId}::uuid
              and owner_employee_id = ${employeeId}::uuid
          `);
        }
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
        return workloadForProjects(ctx, [input.projectId], input.weekStart);
      }),
    portfolio: staffProcedure
      .input(z.object({ portfolioId: uuid, weekStart: z.string().date() }))
      .query(async ({ input, ctx }) => {
        await requireScopedFeature(ctx, "work.portfolios", null);
        await requirePortfolioAccess(ctx, input.portfolioId);
        const db = getDb();
        const projectIds = !db
          ? [...(getDemoWork().portfolioProjects.get(input.portfolioId) ?? [])]
          : (
              await db.execute<{ projectId: string }>(sql`
                select work_project_id as "projectId"
                from public.work_portfolio_project
                where work_portfolio_id = ${input.portfolioId}::uuid
                order by position
              `)
            ).map((item) => item.projectId);
        const accessible: string[] = [];
        for (const projectId of projectIds) {
          try {
            await requireProjectAccess(ctx, projectId);
            await requireScopedFeature(ctx, "work.portfolios", projectId);
            accessible.push(projectId);
          } catch (error) {
            if (!(error instanceof TRPCError)) throw error;
          }
        }
        return workloadForProjects(ctx, accessible, input.weekStart);
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
    rates: staffProcedure
      .input(z.object({ projectId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId);
        const db = getDb();
        if (!db) {
          const prefix = `${input.projectId}:`;
          return [...getDemoWork().projectRates.entries()]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, hourlyCostRate]) => ({
              projectId: input.projectId,
              employeeId: key.slice(prefix.length),
              employeeName: "Dev Partner",
              hourlyCostRate,
            }));
        }
        const rows = await db.execute<{
          projectId: string;
          employeeId: string;
          employeeName: string;
          hourlyCostRate: string | number;
        }>(sql`
          select rate.work_project_id as "projectId",
            rate.employee_id as "employeeId",
            employee.display_name as "employeeName",
            rate.hourly_cost_rate as "hourlyCostRate"
          from public.work_project_rate rate
          join public.employee employee on employee.employee_id = rate.employee_id
          where rate.work_project_id = ${input.projectId}::uuid
          order by lower(employee.display_name)
        `);
        return rows.map((row) => ({
          ...row,
          hourlyCostRate: Number(row.hourlyCostRate),
        }));
      }),
    setRate: staffProcedure
      .input(
        z.object({
          projectId: uuid,
          employeeId: uuid,
          hourlyCostRate: z.number().min(0).max(1_000_000_000).nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireProjectAccess(ctx, input.projectId, "admin");
        const db = getDb();
        if (!db) {
          if (input.employeeId !== "c0000000-0000-4000-8000-000000000001")
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Employee not found",
            });
          const key = `${input.projectId}:${input.employeeId}`;
          if (input.hourlyCostRate === null)
            getDemoWork().projectRates.delete(key);
          else getDemoWork().projectRates.set(key, input.hourlyCostRate);
        } else
          await db.transaction(async (tx) => {
            const [employee] = await tx.execute(sql`
              select 1 from public.employee
              where employee_id = ${input.employeeId}::uuid and is_active = true
            `);
            if (!employee)
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "Employee not found",
              });
            if (input.hourlyCostRate === null)
              await tx.execute(sql`
                delete from public.work_project_rate
                where work_project_id = ${input.projectId}::uuid
                  and employee_id = ${input.employeeId}::uuid
              `);
            else
              await tx.execute(sql`
                insert into public.work_project_rate (
                  work_project_id, employee_id, hourly_cost_rate,
                  set_by_employee_id
                ) values (
                  ${input.projectId}::uuid, ${input.employeeId}::uuid,
                  ${input.hourlyCostRate}, ${actor(ctx)}::uuid
                ) on conflict (work_project_id, employee_id) do update
                  set hourly_cost_rate = excluded.hourly_cost_rate,
                    set_by_employee_id = excluded.set_by_employee_id,
                    updated_at = now()
              `);
          });
        await audit(
          ctx,
          "work.budget.rate.set",
          "work_project",
          input.projectId,
          {
            employeeId: input.employeeId,
            hourlyCostRate: input.hourlyCostRate,
          },
        );
        return {
          projectId: input.projectId,
          employeeId: input.employeeId,
          hourlyCostRate: input.hourlyCostRate,
        };
      }),
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

  accessibility: router({
    get: staffProcedure.query(async ({ ctx }) => {
      await requireScopedFeature(ctx, "work.accessibility", null);
      const employeeId = actor(ctx);
      const fallback: WorkAccessibilityPreference = {
        employeeId,
        theme: "system",
        colorblindMode: false,
        reducedMotion: false,
        updatedAt: new Date(0).toISOString(),
      };
      const db = getDb();
      if (!db) return getDemoWork().accessibility.get(employeeId) ?? fallback;
      const [preference] = await db.execute<WorkAccessibilityPreference>(sql`
        select employee_id as "employeeId", theme,
          colorblind_mode as "colorblindMode",
          reduced_motion as "reducedMotion", updated_at as "updatedAt"
        from public.work_accessibility_preference
        where employee_id = ${employeeId}::uuid
      `);
      return preference ?? fallback;
    }),
    update: staffProcedure
      .input(
        z.object({
          theme: z.enum(["system", "light", "dark"]),
          colorblindMode: z.boolean(),
          reducedMotion: z.boolean(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(ctx, "work.accessibility", null);
        const employeeId = actor(ctx);
        const preference: WorkAccessibilityPreference = {
          employeeId,
          ...input,
          updatedAt: new Date().toISOString(),
        };
        const db = getDb();
        if (!db) getDemoWork().accessibility.set(employeeId, preference);
        else
          await db.execute(sql`
            insert into public.work_accessibility_preference (
              employee_id, theme, colorblind_mode, reduced_motion
            ) values (
              ${employeeId}::uuid, ${input.theme}, ${input.colorblindMode},
              ${input.reducedMotion}
            ) on conflict (employee_id) do update set
              theme = excluded.theme,
              colorblind_mode = excluded.colorblind_mode,
              reduced_motion = excluded.reduced_motion,
              updated_at = now()
          `);
        await audit(
          ctx,
          "work.accessibility.update",
          "work_accessibility_preference",
          employeeId,
          preference,
        );
        return preference;
      }),
  }),

  outOfOffice: router({
    list: staffProcedure.query(async ({ ctx }) => {
      await requireScopedFeature(ctx, "work.out_of_office", null);
      const employeeId = actor(ctx);
      const db = getDb();
      if (!db)
        return [...getDemoWork().outOfOffice.values()]
          .filter((period) => period.employeeId === employeeId)
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .map(withOutOfOfficeStatus);
      return db.execute<
        WorkOutOfOffice & { status: "active" | "upcoming" | "past" }
      >(sql`
        select work_out_of_office_id as "outOfOfficeId",
          employee_id as "employeeId", start_date::text as "startDate",
          end_date::text as "endDate", note, created_at as "createdAt",
          updated_at as "updatedAt",
          case when current_date between start_date and end_date then 'active'
            when start_date > current_date then 'upcoming' else 'past'
          end as status
        from public.work_out_of_office
        where employee_id = ${employeeId}::uuid
        order by start_date desc, created_at desc
      `);
    }),
    create: staffProcedure
      .input(outOfOfficeSchema)
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(ctx, "work.out_of_office", null);
        const employeeId = actor(ctx);
        const now = new Date().toISOString();
        const period: WorkOutOfOffice = {
          outOfOfficeId: randomUUID(),
          employeeId,
          startDate: input.startDate,
          endDate: input.endDate,
          note: input.note,
          createdAt: now,
          updatedAt: now,
        };
        const db = getDb();
        if (!db) getDemoWork().outOfOffice.set(period.outOfOfficeId, period);
        else
          await db.execute(sql`
            insert into public.work_out_of_office (
              work_out_of_office_id, employee_id, start_date, end_date, note
            ) values (
              ${period.outOfOfficeId}::uuid, ${employeeId}::uuid,
              ${input.startDate}::date, ${input.endDate}::date, ${input.note}
            )
          `);
        await audit(
          ctx,
          "work.out_of_office.create",
          "work_out_of_office",
          period.outOfOfficeId,
          period,
        );
        return withOutOfOfficeStatus(period);
      }),
    update: staffProcedure
      .input(updateOutOfOfficeSchema)
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(ctx, "work.out_of_office", null);
        const employeeId = actor(ctx);
        const db = getDb();
        let period: WorkOutOfOffice | undefined;
        if (!db) {
          const existing = getDemoWork().outOfOffice.get(input.outOfOfficeId);
          if (existing?.employeeId === employeeId) {
            period = {
              ...existing,
              startDate: input.startDate,
              endDate: input.endDate,
              note: input.note,
              updatedAt: new Date().toISOString(),
            };
            getDemoWork().outOfOffice.set(period.outOfOfficeId, period);
          }
        } else {
          [period] = await db.execute<WorkOutOfOffice>(sql`
            update public.work_out_of_office set
              start_date = ${input.startDate}::date,
              end_date = ${input.endDate}::date,
              note = ${input.note}, updated_at = now()
            where work_out_of_office_id = ${input.outOfOfficeId}::uuid
              and employee_id = ${employeeId}::uuid
            returning work_out_of_office_id as "outOfOfficeId",
              employee_id as "employeeId", start_date::text as "startDate",
              end_date::text as "endDate", note, created_at as "createdAt",
              updated_at as "updatedAt"
          `);
        }
        if (!period) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "work.out_of_office.update",
          "work_out_of_office",
          period.outOfOfficeId,
          period,
        );
        return withOutOfOfficeStatus(period);
      }),
    remove: staffProcedure
      .input(z.object({ outOfOfficeId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireScopedFeature(ctx, "work.out_of_office", null);
        const employeeId = actor(ctx);
        const db = getDb();
        let removed = false;
        if (!db) {
          const period = getDemoWork().outOfOffice.get(input.outOfOfficeId);
          if (period?.employeeId === employeeId) {
            getDemoWork().outOfOffice.delete(input.outOfOfficeId);
            removed = true;
          }
        } else {
          const rows = await db.execute<{ outOfOfficeId: string }>(sql`
            delete from public.work_out_of_office
            where work_out_of_office_id = ${input.outOfOfficeId}::uuid
              and employee_id = ${employeeId}::uuid
            returning work_out_of_office_id as "outOfOfficeId"
          `);
          removed = rows.length > 0;
        }
        if (!removed) throw new TRPCError({ code: "NOT_FOUND" });
        await audit(
          ctx,
          "work.out_of_office.remove",
          "work_out_of_office",
          input.outOfOfficeId,
          {},
        );
        return { ok: true as const };
      }),
  }),

  members: router({
    listTeams: staffProcedure.query(async ({ ctx }) => {
      const db = getDb();
      if (!db) return [] as Array<{ teamId: string; name: string }>;
      const employeeId = actor(ctx);
      return db.execute<{ teamId: string; name: string }>(sql`
        select work_team_id as "teamId", name
        from public.work_team
        where archived_at is null
          and (
            privacy <> 'private'
            or created_by_employee_id = ${employeeId}::uuid
            or exists (
              select 1 from public.work_team_member member
              where member.work_team_id = work_team.work_team_id
                and member.employee_id = ${employeeId}::uuid
            )
          )
        order by lower(name)
      `);
    }),
    listEmployees: staffProcedure
      .input(z.object({ projectId: uuid.optional() }).optional())
      .query(async ({ input, ctx }) => {
        const project = input?.projectId
          ? await requireProjectAccess(ctx, input.projectId)
          : null;
        const scope = {
          userId: ctx.employeeId,
          clientId: project?.clientId ?? ctx.clientId,
          roles: ctx.roles,
        };
        const [outOfOfficeEnabled, aiTeammatesEnabled] = await Promise.all([
          featureEnabled("work.out_of_office", scope),
          featureEnabled("work.ai.teammates", scope),
        ]);
        const db = getDb();
        if (!db) {
          const employeeId = "c0000000-0000-4000-8000-000000000001";
          const away = outOfOfficeEnabled
            ? [...getDemoWork().outOfOffice.values()]
                .filter(
                  (period) =>
                    period.employeeId === employeeId &&
                    withOutOfOfficeStatus(period).status === "active",
                )
                .sort((a, b) => b.endDate.localeCompare(a.endDate))[0]
            : undefined;
          return [
            {
              employeeId,
              displayName: "Dev Partner",
              displayLabel: away
                ? `Dev Partner · Away through ${away.endDate}`
                : "Dev Partner",
              outOfOfficeUntil: away?.endDate ?? null,
              outOfOfficeNote: away?.note ?? null,
            },
          ];
        }
        return db.execute<{
          employeeId: string;
          displayName: string;
          displayLabel: string;
          outOfOfficeUntil: string | null;
          outOfOfficeNote: string | null;
        }>(sql`
        select employee.employee_id as "employeeId",
          employee.display_name as "displayName",
          employee.display_name || case when away.end_date is not null
            then ' · Away through ' || away.end_date::text else '' end
            as "displayLabel",
          away.end_date::text as "outOfOfficeUntil",
          away.note as "outOfOfficeNote"
        from public.employee employee
        left join lateral (
          select period.end_date, period.note
          from public.work_out_of_office period
          where period.employee_id = employee.employee_id
            and current_date between period.start_date and period.end_date
          order by period.end_date desc limit 1
        ) away on ${outOfOfficeEnabled}
        where employee.is_active = true
          and (
            employee.email not like '%@teammate.hrmny.internal'
            or (
              ${aiTeammatesEnabled}
              and exists (
                select 1 from public.work_ai_teammate teammate
                join public.work_ai_teammate_member member
                  on member.work_ai_teammate_id = teammate.work_ai_teammate_id
                  and member.employee_id = ${actor(ctx)}::uuid
                where teammate.employee_id = employee.employee_id
                  and teammate.status = 'active' and teammate.archived_at is null
                  and (${input?.projectId ?? null}::uuid is null or exists (
                    select 1 from public.work_ai_teammate_project_access access
                    where access.work_ai_teammate_id = teammate.work_ai_teammate_id
                      and access.work_project_id = ${input?.projectId ?? null}::uuid
                  ))
              )
            )
          )
        order by lower(employee.display_name)
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

type BundleRolloutResult = {
  installedProjectCount: number;
  updatedProjectCount: number;
  failures: { projectId: string; message: string }[];
};

async function rolloutPublishedBundle(
  ctx: TrpcContext,
  bundleId: string,
  projectIds: readonly string[],
): Promise<BundleRolloutResult> {
  const caller = createCallerFactory(workManagementRouter)({
    ...ctx,
    workBundleRollout: { bundleId },
  });
  const failures: BundleRolloutResult["failures"] = [];
  let updatedProjectCount = 0;
  for (const projectId of projectIds) {
    try {
      await caller.bundles.applyToProject({ bundleId, projectId });
      updatedProjectCount += 1;
    } catch (error) {
      failures.push({
        projectId,
        message:
          error instanceof Error ? error.message : "Bundle update failed",
      });
    }
  }
  return {
    installedProjectCount: projectIds.length,
    updatedProjectCount,
    failures,
  };
}

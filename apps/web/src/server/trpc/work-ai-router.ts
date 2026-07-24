import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  featureEnabled,
  listFeatureOverrides,
  resolveFeatureCatalog,
} from "../features";
import { createGoogleWorkspaceFile } from "../google-workspace-ai";
import { writeAudit } from "../m1-persistence";
import { isWorkViewOnlyMember } from "../work-governance";
import {
  scheduleWorkAiTeammateFollowUp,
  workAiTeammateExecutionContext,
} from "../work-ai-teammates";
import {
  beginWorkAiAction,
  featureKeyForWorkAiKind,
  finishWorkAiAction,
  generateWorkAi,
  getWorkAiRun,
  listWorkAiRuns,
  rejectWorkAiRun,
  requireWorkAiFeature,
  type WorkAiContextSource,
  workAiKinds,
} from "../work-ai";
import { getGoogleWorkspaceAccessToken } from "./connections-router";
import { workManagementRouter } from "./work-management-router";
import {
  createCallerFactory,
  router,
  staffProcedure,
  type TrpcContext,
} from "./trpc";

const uuid = z.string().uuid();
const createWorkCaller = createCallerFactory(workManagementRouter);
const imageMediaType = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

function detectImageMediaType(body: Buffer) {
  if (body.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return "image/png";
  if (body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff)
    return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(body.subarray(0, 6).toString("ascii")))
    return "image/gif";
  if (
    body.subarray(0, 4).toString("ascii") === "RIFF" &&
    body.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  return null;
}

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}

async function requireFeature(ctx: TrpcContext, featureKey: string) {
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

export const workAiRouter = router({
  history: staffProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ input, ctx }) => {
      const enabled = new Set(
        resolveFeatureCatalog(await listFeatureOverrides(), {
          userId: ctx.employeeId,
          clientId: ctx.clientId,
          roles: ctx.roles,
        })
          .filter((feature) => feature.enabled)
          .map((feature) => feature.key),
      );
      const runs = await listWorkAiRuns(actor(ctx), input.limit);
      return runs.filter((run) =>
        enabled.has(featureKeyForWorkAiKind(run.kind)),
      );
    }),

  generate: staffProcedure
    .input(
      z.object({
        kind: z.enum(workAiKinds),
        requestText: z.string().trim().min(1).max(10_000),
        projectIds: z.array(uuid).max(10).default([]),
        itemId: uuid.nullable().default(null),
        statusTarget: z
          .object({
            targetType: z.enum(["project", "portfolio", "goal"]),
            targetId: uuid,
          })
          .nullable()
          .default(null),
        summaryPortfolioId: uuid.nullable().default(null),
        includeInbox: z.boolean().default(false),
        images: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(255),
              mediaType: imageMediaType,
              dataBase64: z
                .string()
                .min(1)
                .max(4_000_000)
                .regex(
                  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
                ),
            }),
          )
          .max(3)
          .default([]),
        allProjects: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireWorkAiFeature(ctx, input.kind);
      const {
        summaryPortfolioId,
        includeInbox,
        images: requestedImages,
        allProjects,
        projectIds: selectedProjectIds,
        ...generation
      } = input;
      const projectIds = [...selectedProjectIds];
      const externalSources: WorkAiContextSource[] = [];
      let imageBytes = 0;
      const images = requestedImages.map((image, index) => {
        const body = Buffer.from(image.dataBase64, "base64");
        imageBytes += body.byteLength;
        if (detectImageMediaType(body) !== image.mediaType)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid image: ${image.name}`,
          });
        externalSources.push({
          id: `image:${index}`,
          type: "image",
          label: image.name,
          content: JSON.stringify({
            mediaType: image.mediaType,
            sizeBytes: body.byteLength,
          }),
        });
        return {
          mediaType: image.mediaType,
          dataBase64: image.dataBase64,
        };
      });
      if (images.length) {
        if (input.kind !== "smart_chat")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Image analysis is available in Smart Chat",
          });
        // ponytail: 3 MB raw stays below Vercel's 4.5 MB request cap; use direct uploads if larger images become necessary.
        if (imageBytes > 3_000_000)
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: "Images are limited to 3 MB per request",
          });
        await requireFeature(ctx, "work.attachments");
      }
      if (input.kind === "smart_summaries") {
        const work = createWorkCaller(ctx);
        if (summaryPortfolioId) {
          await requireFeature(ctx, "work.portfolios");
          const [portfolios, projects] = await Promise.all([
            work.portfolios.list(),
            work.projects.list(),
          ]);
          const portfolio = portfolios.find(
            (candidate) => candidate.portfolioId === summaryPortfolioId,
          );
          if (!portfolio) throw new TRPCError({ code: "NOT_FOUND" });
          const visibleProjectIds = new Set(
            projects.map((project) => project.projectId),
          );
          const portfolioProjectIds = portfolio.projectIds.filter((projectId) =>
            visibleProjectIds.has(projectId),
          );
          for (const projectId of portfolioProjectIds)
            if (!projectIds.includes(projectId) && projectIds.length < 10)
              projectIds.push(projectId);
          externalSources.push({
            id: portfolio.portfolioId,
            type: "portfolio" as const,
            label: portfolio.name,
            content: JSON.stringify({
              description: portfolio.description,
              progress: portfolio.progress,
              health: portfolio.health,
              projectIds: portfolioProjectIds,
            }),
          });
        }
        if (includeInbox) {
          await requireFeature(ctx, "work.inbox");
          const notifications = await work.personal.inbox({});
          externalSources.push({
            id: `inbox:${actor(ctx)}`,
            type: "inbox" as const,
            label: "Inbox",
            content: JSON.stringify(
              notifications.map(
                ({ eventType, message, readAt, createdAt, projectId }) => ({
                  eventType,
                  message,
                  readAt,
                  createdAt,
                  projectId,
                }),
              ),
            ),
          });
        }
      }
      if (allProjects) {
        if (
          !["smart_chat", "smart_summaries", "risk_reports", "dash"].includes(
            input.kind,
          )
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Workspace context is unavailable for this capability",
          });
        await requireFeature(ctx, "work.projects");
        const work = createWorkCaller(ctx);
        const terms = [
          ...new Set(
            input.requestText
              .toLowerCase()
              .match(/[a-z0-9]+/g)
              ?.filter((term) => term.length > 2) ?? [],
          ),
        ];
        const visibleProjects = await work.projects.list();
        const eligibleProjects = images.length
          ? (
              await Promise.all(
                visibleProjects.map(async (project) =>
                  (await featureEnabled("work.attachments", {
                    userId: ctx.employeeId,
                    clientId: project.clientId,
                    roles: ctx.roles,
                  }))
                    ? project
                    : null,
                ),
              )
            ).filter((project) => project !== null)
          : visibleProjects;
        const projects = eligibleProjects
          .map((project) => ({
            project,
            score: terms.reduce(
              (score, term) =>
                score +
                Number(project.description.toLowerCase().includes(term)) +
                Number(project.name.toLowerCase().includes(term)) * 5,
              0,
            ),
          }))
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.project.name.localeCompare(right.project.name),
          );
        for (const { project } of projects)
          if (!projectIds.includes(project.projectId) && projectIds.length < 10)
            projectIds.push(project.projectId);
        // ponytail: the prompt window holds 100 project summaries; add indexed retrieval when larger workspaces appear.
        for (const { project } of projects.slice(0, 100))
          externalSources.push({
            id: project.projectId,
            type: "project",
            label: project.name,
            content: JSON.stringify({
              description: project.description.slice(0, 300),
              health: project.health,
              startDate: project.startDate,
              dueDate: project.dueDate,
              privacy: project.privacy,
              sourcePlatform: project.sourcePlatform,
            }),
          });
      }
      return generateWorkAi({
        ...generation,
        ctx,
        projectIds,
        externalSources,
        images,
      });
    }),

  reject: staffProcedure
    .input(z.object({ runId: uuid }))
    .mutation(async ({ input, ctx }) => {
      const employeeId = actor(ctx);
      const run = await getWorkAiRun(input.runId, employeeId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkAiFeature(ctx, run.kind);
      if (!(await rejectWorkAiRun(input.runId, employeeId)))
        throw new TRPCError({
          code: "CONFLICT",
          message: "AI proposal is no longer available to reject",
        });
      await writeAudit({
        actorEmployeeId: employeeId,
        action: "work.ai.reject",
        entityType: "work_ai_run",
        entityId: input.runId,
        before: null,
        after: { kind: run.kind },
        reason: "AI proposal rejected",
      });
      return { ok: true as const };
    }),

  applyAction: staffProcedure
    .input(
      z.object({
        runId: uuid,
        actionIndex: z.number().int().min(0).max(29),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const employeeId = actor(ctx);
      if (await isWorkViewOnlyMember(employeeId))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "FORBIDDEN: Work access is view-only",
        });
      const run = await getWorkAiRun(input.runId, employeeId);
      if (!run?.result) throw new TRPCError({ code: "NOT_FOUND" });
      await requireWorkAiFeature(ctx, run.kind);
      if (run.status !== "proposed" && run.status !== "partially_applied")
        throw new TRPCError({
          code: "CONFLICT",
          message: "AI proposal is no longer available to apply",
        });
      const action = run.result.actions[input.actionIndex];
      if (!action)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "AI action does not exist",
        });
      if (!(await beginWorkAiAction(run.runId, input.actionIndex, employeeId)))
        throw new TRPCError({
          code: "CONFLICT",
          message: "AI action was already applied or is being applied",
        });
      const work = createWorkCaller(
        await workAiTeammateExecutionContext(ctx, run, action),
      );
      try {
        let result: unknown;
        switch (action.type) {
          case "create_task":
            await requireFeature(ctx, "work.tasks");
            result = await work.tasks.create({
              projectId: action.projectId,
              title: action.title,
              description: action.description,
              priority: action.priority,
              dueAt: action.dueAt,
              itemType: "task",
            });
            break;
          case "update_task":
            await requireFeature(ctx, "work.tasks");
            result = await work.tasks.update(action);
            break;
          case "delete_task":
            await requireFeature(ctx, "work.tasks");
            result = await work.tasks.archive({ itemId: action.itemId });
            break;
          case "create_subtask":
            await requireFeature(ctx, "work.subtasks");
            result = await work.tasks.create({
              projectId: action.projectId,
              parentItemId: action.parentItemId,
              title: action.title,
              description: action.description,
              priority: action.priority,
              assigneeEmployeeId: action.assigneeEmployeeId,
              dueAt: action.dueAt,
              itemType: "task",
            });
            break;
          case "create_comment":
            await requireFeature(ctx, "work.comments");
            result = await work.comments.create({
              itemId: action.itemId,
              body: action.body,
            });
            break;
          case "set_custom_field":
            await requireFeature(ctx, "work.custom_fields");
            result = await work.customFields.setValue({
              itemId: action.itemId,
              customFieldId: action.customFieldId,
              value: action.value,
            });
            break;
          case "set_custom_task_status":
            await requireFeature(ctx, "work.custom_task_types");
            result = await work.customTaskTypes.setForTask(action);
            break;
          case "add_to_project":
            await requireFeature(ctx, "work.multi_home");
            result = await work.tasks.addToProject({
              itemId: action.itemId,
              projectId: action.projectId,
              sectionId: action.sectionId,
            });
            break;
          case "add_follower":
            await requireFeature(ctx, "work.followers");
            result = await work.followers.follow({
              itemId: action.itemId,
              employeeId: action.employeeId,
            });
            break;
          case "remove_follower":
            await requireFeature(ctx, "work.followers");
            result = await work.followers.unfollow({
              itemId: action.itemId,
              employeeId: action.employeeId,
            });
            break;
          case "create_section":
            await requireFeature(ctx, "work.sections");
            result = await work.sections.create({
              projectId: action.projectId,
              name: action.name,
            });
            break;
          case "update_section":
            await requireFeature(ctx, "work.sections");
            result = await work.sections.update({
              projectId: action.projectId,
              sectionId: action.sectionId,
              name: action.name,
            });
            break;
          case "bulk_update_tasks": {
            await requireFeature(ctx, "work.tasks");
            const updated = [];
            for (const update of action.updates) {
              const { completed, ...fields } = update;
              if (Object.keys(fields).length > 1)
                updated.push(await work.tasks.update(fields));
              if (completed !== undefined)
                updated.push(
                  await work.tasks.complete({
                    itemId: update.itemId,
                    completed,
                  }),
                );
            }
            result = updated;
            break;
          }
          case "add_dependency":
            await requireFeature(ctx, "work.dependencies");
            result = await work.dependencies.add({
              itemId: action.itemId,
              dependsOnItemId: action.dependsOnItemId,
            });
            break;
          case "create_milestone":
            await requireFeature(ctx, "work.milestones");
            result = await work.tasks.create({
              projectId: action.projectId,
              title: action.title,
              description: action.description,
              dueAt: action.dueAt,
              itemType: "milestone",
            });
            break;
          case "attach_file":
            await requireFeature(ctx, "work.attachments");
            result = await work.attachments.addLink({
              itemId: action.itemId,
              name: action.name,
              url: action.url,
            });
            break;
          case "schedule_follow_up":
            result = await scheduleWorkAiTeammateFollowUp({
              ctx,
              run,
              action,
              actionIndex: input.actionIndex,
            });
            break;
          case "create_external_file": {
            await Promise.all([
              requireFeature(ctx, "work.ai.connectors"),
              requireFeature(ctx, "work.attachments"),
            ]);
            const accessToken = await getGoogleWorkspaceAccessToken(employeeId);
            if (!accessToken)
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Connect Google Workspace before creating this file",
              });
            const file = await createGoogleWorkspaceFile({
              accessToken,
              actionKey: `${run.runId}:${input.actionIndex}`,
              fileType: action.fileType,
              name: action.name,
              content: action.content,
            });
            const attachment =
              (await work.attachments.list({ itemId: action.itemId })).find(
                (candidate) => candidate.externalUrl === file.url,
              ) ??
              (await work.attachments.addLink({
                itemId: action.itemId,
                name: file.name,
                url: file.url,
              }));
            result = { file, attachment };
            break;
          }
          case "create_status":
            await requireFeature(ctx, "work.status_updates");
            {
              const targetId =
                action.targetId ??
                (action.targetType === "project" ? action.projectId : null);
              if (!targetId)
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: "Status proposal has no target",
                });
              result = await work.statusUpdates.create({
                targetType: action.targetType,
                targetId,
                health: action.health,
                progress: action.progress,
                title: action.title,
                body: action.body,
              });
            }
            break;
          case "create_goal":
            await requireFeature(ctx, "work.goals");
            result = await work.goals.create({
              name: action.name,
              description: action.description,
              scope: action.scope,
              dueDate: action.dueDate,
              status: "on_track",
              progress: 0,
              privacy: "organization",
            });
            break;
          case "create_custom_field":
            await requireFeature(ctx, "work.custom_fields");
            result = await work.customFields.create({
              projectId: action.projectId,
              name: action.name,
              fieldType:
                action.fieldType === "checkbox"
                  ? "boolean"
                  : action.fieldType === "select"
                    ? "single_select"
                    : action.fieldType,
              options: action.options,
              isRequired: action.isRequired,
            });
            break;
          case "create_rule":
            await requireFeature(ctx, "work.rules");
            result = await work.rules.create({
              projectId: action.projectId,
              name: action.name,
              triggerType: action.triggerType,
              branches: action.branches,
            });
            break;
          case "create_project": {
            await Promise.all([
              requireFeature(ctx, "work.projects"),
              requireFeature(ctx, "work.tasks"),
              ...(action.sections.length
                ? [requireFeature(ctx, "work.sections")]
                : []),
            ]);
            const project = await work.projects.create({
              name: action.name,
              description: action.description,
              privacy: action.privacy,
              color: "#C7702E",
            });
            const initial = await work.projects.get({
              projectId: project.projectId,
            });
            const sections = new Map(
              initial.sections.map((section) => [
                section.name.toLowerCase(),
                section.sectionId,
              ]),
            );
            for (const name of action.sections) {
              if (sections.has(name.toLowerCase())) continue;
              const section = await work.sections.create({
                projectId: project.projectId,
                name,
              });
              sections.set(name.toLowerCase(), section.sectionId);
            }
            const tasks = [];
            for (const task of action.tasks) {
              tasks.push(
                await work.tasks.create({
                  projectId: project.projectId,
                  sectionId: task.section
                    ? (sections.get(task.section.toLowerCase()) ?? null)
                    : null,
                  title: task.title,
                  description: task.description,
                  priority: task.priority,
                  itemType: "task",
                }),
              );
            }
            result = { project, tasks };
            break;
          }
        }
        await finishWorkAiAction({
          run,
          actionIndex: input.actionIndex,
          employeeId,
          result,
        });
        await writeAudit({
          actorEmployeeId: employeeId,
          action: "work.ai.action.apply",
          entityType: "work_ai_run",
          entityId: run.runId,
          before: null,
          after: {
            kind: run.kind,
            actionIndex: input.actionIndex,
            actionType: action.type,
          },
          reason: "Explicit human approval",
        });
        return { ok: true as const, result };
      } catch (error) {
        await finishWorkAiAction({
          run,
          actionIndex: input.actionIndex,
          employeeId,
          error: error instanceof Error ? error.message : "AI action failed",
        });
        throw error;
      }
    }),
});

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  featureEnabled,
  listFeatureOverrides,
  resolveFeatureCatalog,
} from "../features";
import { writeAudit } from "../m1-persistence";
import { isWorkViewOnlyMember } from "../work-governance";
import { workAiTeammateExecutionContext } from "../work-ai-teammates";
import {
  beginWorkAiAction,
  featureKeyForWorkAiKind,
  finishWorkAiAction,
  generateWorkAi,
  getWorkAiRun,
  listWorkAiRuns,
  rejectWorkAiRun,
  requireWorkAiFeature,
  workAiKinds,
} from "../work-ai";
import { workManagementRouter } from "./work-management-router";
import {
  createCallerFactory,
  router,
  staffProcedure,
  type TrpcContext,
} from "./trpc";

const uuid = z.string().uuid();
const createWorkCaller = createCallerFactory(workManagementRouter);

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
      }),
    )
    .mutation(({ input, ctx }) => generateWorkAi({ ...input, ctx })),

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
          case "create_comment":
            await requireFeature(ctx, "work.comments");
            result = await work.comments.create({
              itemId: action.itemId,
              body: action.body,
            });
            break;
          case "create_status":
            await requireFeature(ctx, "work.status_updates");
            result = await work.statusUpdates.create({
              targetType: "project",
              targetId: action.projectId,
              health: action.health,
              progress: action.progress,
              title: action.title,
              body: action.body,
            });
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

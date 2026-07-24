import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isWorkViewOnlyMember } from "../work-governance";
import {
  archiveWorkAiStudioWorkflow,
  createWorkAiStudioWorkflow,
  draftWorkAiStudioWorkflow,
  listWorkAiStudioWorkflows,
  runWorkAiStudioWorkflow,
  setWorkAiStudioWorkflowStatus,
  updateWorkAiStudioWorkflow,
  workAiStudioWorkflowInputSchema,
} from "../work-ai-studio";
import { router, staffProcedure, type TrpcContext } from "./trpc";

const uuid = z.string().uuid();

async function requireBuilder(ctx: TrpcContext) {
  if (await isWorkViewOnlyMember(ctx.employeeId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: Work access is view-only",
    });
}

export const workAiStudioRouter = router({
  list: staffProcedure.query(({ ctx }) => listWorkAiStudioWorkflows(ctx)),

  create: staffProcedure
    .input(workAiStudioWorkflowInputSchema)
    .mutation(async ({ input, ctx }) => {
      await requireBuilder(ctx);
      return createWorkAiStudioWorkflow(ctx, input);
    }),

  update: staffProcedure
    .input(
      z.object({
        workflowId: uuid,
        workflow: workAiStudioWorkflowInputSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireBuilder(ctx);
      return updateWorkAiStudioWorkflow(ctx, input.workflowId, input.workflow);
    }),

  setStatus: staffProcedure
    .input(
      z.object({
        workflowId: uuid,
        status: z.enum(["published", "paused"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireBuilder(ctx);
      return setWorkAiStudioWorkflowStatus(ctx, input.workflowId, input.status);
    }),

  archive: staffProcedure
    .input(z.object({ workflowId: uuid }))
    .mutation(async ({ input, ctx }) => {
      await requireBuilder(ctx);
      return archiveWorkAiStudioWorkflow(ctx, input.workflowId);
    }),

  draft: staffProcedure
    .input(z.object({ requestText: z.string().trim().min(1).max(10_000) }))
    .mutation(async ({ input, ctx }) => {
      await requireBuilder(ctx);
      return draftWorkAiStudioWorkflow(ctx, input.requestText);
    }),

  run: staffProcedure
    .input(
      z.object({
        workflowId: uuid,
        itemId: uuid.nullable().default(null),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireBuilder(ctx);
      return runWorkAiStudioWorkflow({
        ctx,
        workflowId: input.workflowId,
        itemId: input.itemId,
        allowDraft: true,
      });
    }),
});

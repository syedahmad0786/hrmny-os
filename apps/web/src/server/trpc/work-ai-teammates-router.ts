import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { isWorkViewOnlyMember } from "../work-governance";
import { requireWorkAiFeature } from "../work-ai";
import {
  archiveWorkAiTeammate,
  createWorkAiTeammate,
  deleteWorkAiTeammateSkill,
  forgetWorkAiTeammateMemory,
  listWorkAiTeammateDirectory,
  listWorkAiTeammateMembers,
  listWorkAiTeammateMemories,
  listWorkAiTeammateProjectAccess,
  listWorkAiTeammates,
  listWorkAiTeammateSkills,
  removeWorkAiTeammateMember,
  removeWorkAiTeammateProjectAccess,
  runWorkAiTeammate,
  saveWorkAiTeammateSkill,
  setWorkAiTeammateMember,
  setWorkAiTeammateProjectAccess,
  setWorkAiTeammateStatus,
  updateWorkAiTeammate,
  workAiTeammateInputSchema,
  workAiTeammateSkillInputSchema,
} from "../work-ai-teammates";
import { router, staffProcedure, type TrpcContext } from "./trpc";

const uuid = z.string().uuid();

async function requireWrite(ctx: TrpcContext) {
  if (await isWorkViewOnlyMember(ctx.employeeId))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: Work access is view-only",
    });
}

export const workAiTeammatesRouter = router({
  list: staffProcedure.query(({ ctx }) => listWorkAiTeammates(ctx)),
  directory: staffProcedure.query(({ ctx }) =>
    listWorkAiTeammateDirectory(ctx),
  ),
  create: staffProcedure
    .input(workAiTeammateInputSchema)
    .mutation(async ({ input, ctx }) => {
      await requireWrite(ctx);
      return createWorkAiTeammate(ctx, input);
    }),
  update: staffProcedure
    .input(z.object({ teammateId: uuid, teammate: workAiTeammateInputSchema }))
    .mutation(async ({ input, ctx }) => {
      await requireWrite(ctx);
      return updateWorkAiTeammate(ctx, input.teammateId, input.teammate);
    }),
  setStatus: staffProcedure
    .input(
      z.object({
        teammateId: uuid,
        status: z.enum(["active", "paused"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireWrite(ctx);
      return setWorkAiTeammateStatus(ctx, input.teammateId, input.status);
    }),
  archive: staffProcedure
    .input(z.object({ teammateId: uuid }))
    .mutation(async ({ input, ctx }) => {
      await requireWrite(ctx);
      return archiveWorkAiTeammate(ctx, input.teammateId);
    }),
  run: staffProcedure
    .input(
      z.object({
        teammateId: uuid,
        projectId: uuid,
        itemId: uuid.nullable().default(null),
        requestText: z.string().trim().min(1).max(10_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireWrite(ctx);
      return runWorkAiTeammate({
        ...input,
        ctx,
        triggerType: "manual",
      });
    }),

  members: router({
    list: staffProcedure
      .input(z.object({ teammateId: uuid }))
      .query(({ input, ctx }) =>
        listWorkAiTeammateMembers(ctx, input.teammateId),
      ),
    set: staffProcedure
      .input(
        z.object({
          teammateId: uuid,
          employeeId: uuid,
          accessLevel: z.enum(["owner", "editor", "user"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireWrite(ctx);
        return setWorkAiTeammateMember({ ...input, ctx });
      }),
    remove: staffProcedure
      .input(z.object({ teammateId: uuid, employeeId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireWrite(ctx);
        return removeWorkAiTeammateMember({ ...input, ctx });
      }),
  }),

  projects: router({
    list: staffProcedure
      .input(z.object({ teammateId: uuid }))
      .query(({ input, ctx }) =>
        listWorkAiTeammateProjectAccess(ctx, input.teammateId),
      ),
    set: staffProcedure
      .input(
        z.object({
          teammateId: uuid,
          projectId: uuid,
          accessLevel: z.enum(["editor", "commenter", "viewer"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await requireWrite(ctx);
        return setWorkAiTeammateProjectAccess({ ...input, ctx });
      }),
    remove: staffProcedure
      .input(z.object({ teammateId: uuid, projectId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await requireWrite(ctx);
        return removeWorkAiTeammateProjectAccess({ ...input, ctx });
      }),
  }),

  skills: router({
    list: staffProcedure
      .input(z.object({ teammateId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireWorkAiFeature(ctx, "teammate");
        return listWorkAiTeammateSkills(ctx, input.teammateId);
      }),
    save: staffProcedure
      .input(
        z.object({
          teammateId: uuid,
          skillId: uuid.optional(),
          skill: workAiTeammateSkillInputSchema,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await Promise.all([
          requireWrite(ctx),
          requireWorkAiFeature(ctx, "teammate"),
        ]);
        return saveWorkAiTeammateSkill({ ...input, ctx });
      }),
    delete: staffProcedure
      .input(z.object({ teammateId: uuid, skillId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await Promise.all([
          requireWrite(ctx),
          requireWorkAiFeature(ctx, "teammate"),
        ]);
        return deleteWorkAiTeammateSkill({ ...input, ctx });
      }),
  }),

  memory: router({
    list: staffProcedure
      .input(z.object({ teammateId: uuid }))
      .query(async ({ input, ctx }) => {
        await requireWorkAiFeature(ctx, "teammate");
        return listWorkAiTeammateMemories(ctx, input.teammateId);
      }),
    forget: staffProcedure
      .input(z.object({ teammateId: uuid, memoryId: uuid }))
      .mutation(async ({ input, ctx }) => {
        await Promise.all([
          requireWrite(ctx),
          requireWorkAiFeature(ctx, "teammate"),
        ]);
        return forgetWorkAiTeammateMemory({ ...input, ctx });
      }),
  }),
});

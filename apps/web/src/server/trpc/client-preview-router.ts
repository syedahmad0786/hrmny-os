import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  actOnPortalApproval,
  demoPortalClientId,
  readPortalWorkspace,
} from "../portal-data";
import { router, staffProcedure } from "./trpc";

function requirePresenter(roles: string[]) {
  if (!roles.some((role) => role === "partner" || role === "director")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Partner or director access required",
    });
  }
}

export const clientPreviewRouter = router({
  workspace: staffProcedure.query(async ({ ctx }) => {
    requirePresenter(ctx.roles);
    return readPortalWorkspace(await demoPortalClientId());
  }),
  act: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        action: z.enum(["approve", "reject"]),
        feedback: z.string().trim().max(2_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      requirePresenter(ctx.roles);
      const clientId = await demoPortalClientId();
      return actOnPortalApproval({
        clientId,
        approvalId: input.id,
        action: input.action,
        feedback: input.feedback,
        actorEmployeeId: ctx.employeeId,
      });
    }),
});

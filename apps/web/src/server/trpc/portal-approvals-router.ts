import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { ActorContext } from "@hrmny/gate";
import {
  decidePortalItem,
  listApprovalViews,
} from "../campaigns/repository";
import { portalProcedure, router } from "./trpc";

/**
 * M9 portal approvals — client-facing surface over the campaign items awaiting
 * sign-off. NOT registered in root.ts by design: the orchestrator wires it (see
 * the note returned to the orchestrator). Campaign items are surfaced as
 * `portal_item` entities scoped to the caller's clientId; approve/reject route
 * through the gate engine, where portalItemClientApproverGate enforces the
 * portal_client role. Finance/margin never enter this tree.
 */

function actorFromCtx(ctx: {
  employeeId: string | null;
  roles: string[];
  user: { permissions: string[] } | null;
}): ActorContext {
  return {
    employeeId: ctx.employeeId!,
    roles: ctx.roles,
    permissions: ctx.user?.permissions ?? [],
  };
}

function requireClientId(ctx: { clientId?: string | null }): string {
  if (!ctx.clientId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal session with client_id required",
    });
  }
  return ctx.clientId;
}

export const portalApprovalsRouter = router({
  /** Items for the caller's client only — pending, approved, and rejected. */
  list: portalProcedure
    .input(z.object({ pendingOnly: z.boolean().optional() }).optional())
    .query(({ input, ctx }) =>
      listApprovalViews({
        clientId: requireClientId(ctx),
        state: input?.pendingOnly ? "pending_client" : undefined,
      }),
    ),

  approve: portalProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input, ctx }) =>
      decidePortalItem({
        actor: actorFromCtx(ctx),
        clientId: requireClientId(ctx),
        id: input.id,
        to: "approved",
      }),
    ),

  reject: portalProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        feedback: z.string().max(2000).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      decidePortalItem({
        actor: actorFromCtx(ctx),
        clientId: requireClientId(ctx),
        id: input.id,
        to: "rejected",
        feedback: input.feedback,
      }),
    ),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { ActorContext } from "@hrmny/gate";
import {
  decidePortalItem,
  getCampaign,
  listApprovalViews,
} from "../campaigns/repository";
import { addFeedback, listFeedbackByItem } from "../campaigns/feedback";
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

/** Client trust boundary: a portal actor may only touch a thread whose item
 *  belongs to their bound client. Returns the item once the scope is proven. */
async function requireOwnedItem(id: string, clientId: string) {
  const item = await getCampaign(id);
  if (!item || item.clientId !== clientId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: item not in this client scope",
    });
  }
  return item;
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

  /** Request changes: a rejection must carry a feedback body (recorded as the
   *  first client comment on the thread, alongside the gate transition). */
  reject: portalProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        feedback: z.string().min(1).max(2000),
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

  /** Consolidated proofing thread for one of the caller's items. */
  feedback: router({
    list: portalProcedure
      .input(z.object({ campaignItemId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        await requireOwnedItem(input.campaignItemId, requireClientId(ctx));
        return listFeedbackByItem(input.campaignItemId);
      }),

    add: portalProcedure
      .input(
        z.object({
          campaignItemId: z.string().uuid(),
          body: z.string().min(1).max(2000),
          anchor: z.record(z.unknown()).nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const clientId = requireClientId(ctx);
        await requireOwnedItem(input.campaignItemId, clientId);
        return addFeedback({
          campaignItemId: input.campaignItemId,
          authorKind: "client",
          authorId: ctx.employeeId,
          clientId,
          body: input.body,
          anchor: input.anchor ?? null,
        });
      }),
  }),
});

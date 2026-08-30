import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  decidePortalItem,
  getCampaign,
  listApprovalViews,
} from "../campaigns/repository";
import { addFeedback, listFeedbackByItem } from "../campaigns/feedback";
import {
  CLIENT_PORTAL_ACTOR_REQUIRED,
  PORTAL_IDENTITY_NOT_BOUND,
  requireBoundPortalApprovalActor,
  type PortalApprovalActor,
} from "../portal/approval-boundary";
import { portalProcedure, requirePermission, router } from "./trpc";

/**
 * M9 portal approvals — client-facing surface over the campaign items awaiting
 * sign-off. NOT registered in root.ts by design: the orchestrator wires it (see
 * the note returned to the orchestrator). Campaign items are surfaced as
 * `portal_item` entities scoped to the caller's clientId; approve/reject route
 * through the gate engine, where portalItemClientApproverGate enforces the
 * portal_client role. Finance/margin never enter this tree.
 */

function requireClientId(ctx: { clientId?: string | null }): string {
  if (!ctx.clientId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "FORBIDDEN: portal session with client_id required",
    });
  }
  return ctx.clientId;
}

async function requireDecisionPrincipal(ctx: {
  clientId?: string | null;
  user: PortalApprovalActor | null;
}): Promise<{ actor: PortalApprovalActor; clientId: string }> {
  const clientId = requireClientId(ctx);
  try {
    const actor = await requireBoundPortalApprovalActor({
      actor: ctx.user,
      clientId,
    });
    return { actor, clientId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (
      message === CLIENT_PORTAL_ACTOR_REQUIRED ||
      message === PORTAL_IDENTITY_NOT_BOUND
    ) {
      throw new TRPCError({ code: "FORBIDDEN", message });
    }
    throw error;
  }
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
    .use(requirePermission("portal", "approve"))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const { actor, clientId } = await requireDecisionPrincipal(ctx);
      const result = await decidePortalItem({
        actor,
        clientId,
        id: input.id,
        to: "approved",
      });
      if (!result.ok && result.code === "CONFLICT") {
        throw new TRPCError({ code: "CONFLICT", message: result.reason });
      }
      return result;
    }),

  /** Request changes: a rejection must carry a feedback body (recorded as the
   *  first client comment on the thread, alongside the gate transition). */
  reject: portalProcedure
    .use(requirePermission("portal", "approve"))
    .input(
      z.object({
        id: z.string().uuid(),
        feedback: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { actor, clientId } = await requireDecisionPrincipal(ctx);
      const result = await decidePortalItem({
        actor,
        clientId,
        id: input.id,
        to: "rejected",
        feedback: input.feedback,
      });
      if (!result.ok && result.code === "CONFLICT") {
        throw new TRPCError({ code: "CONFLICT", message: result.reason });
      }
      return result;
    }),

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
        const { actor, clientId } = await requireDecisionPrincipal(ctx);
        await requireOwnedItem(input.campaignItemId, clientId);
        return addFeedback({
          campaignItemId: input.campaignItemId,
          authorKind: "client",
          authorId: actor.employeeId,
          clientId,
          body: input.body,
          anchor: input.anchor ?? null,
        });
      }),
  }),
});

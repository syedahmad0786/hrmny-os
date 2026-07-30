import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { CAMPAIGN_TRANSITIONS, type ActorContext } from "@hrmny/gate";
import type { SocialChannel, SocialPublishResult } from "@hrmny/integrations";
import {
  campaignBackendMode,
  campaignHealth,
  createCampaignDraft,
  getCampaign,
  listApprovalViews,
  listCampaigns,
  transitionCampaign,
  type CampaignItemRow,
} from "../campaigns/repository";
import {
  addFeedback,
  listFeedbackByItem,
  resolveFeedback,
} from "../campaigns/feedback";
import { router, staffProcedure } from "./trpc";

/**
 * M9 content & marketing — campaigns router. Frozen procedure signatures
 * (list/get/createDraft/calendar/report) preserved from the contract-freeze
 * stub; internals are now DB-backed (campaign_items) with an in-memory
 * fallback via ../campaigns/repository. Every status change routes through the
 * gate engine; publish stays HITL (approved→published only) and fires a
 * SocialPublishAdapter stub from inside the gate. Wiring into appRouter stays
 * orchestrator-only (root.ts).
 */

type CampaignStatus = keyof typeof CAMPAIGN_TRANSITIONS;

type CampaignItem = {
  id: string;
  title: string;
  channel: SocialChannel;
  status: CampaignStatus;
  scheduledFor: string;
  clientId: string;
};

function toCampaignItem(row: CampaignItemRow): CampaignItem {
  return {
    id: row.campaignItemId,
    title: row.title,
    channel: row.channel,
    status: row.status,
    scheduledFor: row.scheduledFor ?? "",
    clientId: row.clientId ?? "",
  };
}

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

export const campaignsRouter = router({
  health: staffProcedure.query(async () => ({
    ...(await campaignHealth()),
    mode: campaignBackendMode(),
  })),

  list: staffProcedure
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(async ({ input }): Promise<CampaignItem[]> => {
      const rows = await listCampaigns(
        input?.clientId ? { clientId: input.clientId } : undefined,
      );
      return rows.map(toCampaignItem);
    }),

  get: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }): Promise<CampaignItem | null> => {
      const row = await getCampaign(input.id);
      return row ? toCampaignItem(row) : null;
    }),

  createDraft: staffProcedure
    .input(
      z.object({
        title: z.string().min(1),
        channel: z.enum(["linkedin", "instagram", "facebook", "x"]),
        scheduledFor: z.string(),
        clientId: z.string().uuid(),
      }),
    )
    .mutation(async ({ input }): Promise<CampaignItem> => {
      const row = await createCampaignDraft({
        title: input.title,
        channel: input.channel,
        scheduledFor: input.scheduledFor,
        clientId: input.clientId,
      });
      return toCampaignItem(row);
    }),

  /**
   * Gate-routed status change (approve / publish / archive). Publish
   * (approved→published) is HITL: the gate blocks any publish that skips a
   * prior approve, and the external post is a SocialPublishAdapter stub fired
   * inside the apply step.
   */
  transition: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        to: z.enum(["approved", "published", "draft", "archived"]),
        overrideReason: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const result = await transitionCampaign({
        actor: actorFromCtx(ctx),
        id: input.id,
        to: input.to,
        overrideReason: input.overrideReason,
      });
      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason,
          code: result.code,
          blockedBy: result.blockedBy,
          auditId: result.auditId,
        };
      }
      return {
        ok: true as const,
        item: toCampaignItem(result.item),
        auditId: result.auditId,
      };
    }),

  /** Consolidated proofing feedback — staff see the full thread across both
   *  authors; a staff comment is scoped to the item's client so the client
   *  sees it in the portal. Resolve is staff-only (staffProcedure). */
  feedback: router({
    list: staffProcedure
      .input(z.object({ campaignItemId: z.string().uuid() }))
      .query(({ input }) => listFeedbackByItem(input.campaignItemId)),

    add: staffProcedure
      .input(
        z.object({
          campaignItemId: z.string().uuid(),
          body: z.string().min(1).max(2000),
          anchor: z.record(z.unknown()).nullable().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const item = await getCampaign(input.campaignItemId);
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return addFeedback({
          campaignItemId: input.campaignItemId,
          authorKind: "staff",
          authorId: ctx.employeeId,
          clientId: item.clientId,
          body: input.body,
          anchor: input.anchor ?? null,
        });
      }),

    resolve: staffProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const row = await resolveFeedback(input.id);
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return row;
      }),
  }),

  /** Staff view of items awaiting client sign-off in the portal. */
  pendingApproval: staffProcedure
    .input(z.object({ clientId: z.string().uuid().optional() }).optional())
    .query(({ input }) =>
      listApprovalViews({ clientId: input?.clientId, state: "pending_client" }),
    ),

  /** Content-calendar view — items grouped by scheduled date. */
  calendar: staffProcedure
    .input(z.object({ month: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const rows = await listCampaigns();
      return {
        month: input?.month ?? new Date().toISOString().slice(0, 7),
        items: rows.map((c) => ({
          id: c.campaignItemId,
          title: c.title,
          channel: c.channel,
          date: c.scheduledFor ?? "",
          status: c.status,
        })),
      };
    }),

  /** Campaign report v1 — posts + engagement pulled back post-publish (mock). */
  report: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const row = await getCampaign(input.id);
      const stored = row?.body.publish as SocialPublishResult | undefined;
      const lastPublish: SocialPublishResult = stored ?? {
        published: false,
        mode: "stub",
        externalId: `stub-post-${input.id}`,
        channel: row?.channel ?? "linkedin",
        url: "https://example.invalid/post/stub",
      };
      return {
        campaignId: input.id,
        posts: row?.status === "published" ? 1 : 0,
        impressions: 1240,
        engagements: 87,
        lastPublish,
        note: "Mock engagement — live figures arrive via Composio at M9",
      };
    }),
});

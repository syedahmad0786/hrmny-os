/**
 * automation.* — n8n health / list / propose / trigger (HITL-gated).
 * Wired for automation-orchestrator agent tools: n8n.propose, n8n.trigger, n8n.listWorkflows.
 */
import { z } from "zod";
import { N8N_EVENT_MAP, type N8nCrmEvent } from "@hrmny/integrations";
import { createResolvedN8nAdapter } from "../integrations/n8n-adapter";
import { protectedProcedure, router } from "./trpc";

const crmEventSchema = z.enum([
  "deal.won",
  "ticket.created",
  "ticket.updated",
  "memory.ingest",
  "error.alert",
  "creative.brief.dispatch",
]);

async function n8nClient(employeeId?: string | null) {
  return createResolvedN8nAdapter(employeeId);
}

export const automationRouter = router({
  /** Connectivity + config (never returns API key). */
  health: protectedProcedure.query(async ({ ctx }) => {
    const n8n = await n8nClient(ctx.employeeId);
    const health = await n8n.health();
    return {
      ...health,
      eventMapCount: N8N_EVENT_MAP.length,
      blockedOnApiKey: !health.apiKeyConfigured,
    };
  }),

  /**
   * One-shot demo proof: health + workflow list.
   * live=true only when adapter mode is live and health.ok.
   */
  smoke: protectedProcedure.query(async ({ ctx }) => {
    const n8n = await n8nClient(ctx.employeeId);
    const health = await n8n.health();
    let workflows: Awaited<ReturnType<typeof n8n.listWorkflows>> = [];
    let listError: string | undefined;
    try {
      workflows = await n8n.listWorkflows();
    } catch (err) {
      listError = err instanceof Error ? err.message : "listWorkflows failed";
    }
    return {
      live: health.mode === "live" && health.ok && !listError,
      health: {
        ...health,
        ok: health.ok && !listError,
        detail: listError ?? health.detail,
        eventMapCount: N8N_EVENT_MAP.length,
        blockedOnApiKey: !health.apiKeyConfigured,
      },
      workflowCount: workflows.length,
      workflows: workflows.slice(0, 25).map((w) => ({
        id: w.id,
        name: w.name,
        active: w.active,
      })),
    };
  }),

  listWorkflows: protectedProcedure.query(async ({ ctx }) => {
    const n8n = await n8nClient(ctx.employeeId);
    const workflows = await n8n.listWorkflows();
    return {
      mode: n8n.readonlyMode,
      workflows,
    };
  }),

  eventMap: protectedProcedure.query(() =>
    N8N_EVENT_MAP.map((e) => ({
      event: e.event,
      workflowName: e.workflowName,
      webhookPath: e.webhookPath,
      requiresHitl: e.requiresHitl,
    })),
  ),

  /** Propose only — never fires. automation-orchestrator default path. */
  proposeWorkflow: protectedProcedure
    .input(
      z.object({
        event: crmEventSchema,
        payload: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const n8n = await n8nClient(ctx.employeeId);
      const proposal = await n8n.proposeWorkflow({
        event: input.event as N8nCrmEvent,
        payload: input.payload,
      });
      return {
        ...proposal,
        proposedBy: ctx.employeeId,
        tool: "n8n.propose" as const,
      };
    }),

  /**
   * Trigger webhook. Requires explicit allowProductionTrigger — do not auto-fire.
   * Env N8N_ALLOW_PRODUCTION_TRIGGER=true also unlocks (ops only).
   */
  triggerWorkflow: protectedProcedure
    .input(
      z.object({
        webhookPath: z.string().min(1).optional(),
        event: crmEventSchema.optional(),
        payload: z.record(z.unknown()).optional(),
        /** HITL: must be true to fire when env allow is unset. */
        allowProductionTrigger: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const n8n = await n8nClient(ctx.employeeId);
      let path = input.webhookPath;
      if (!path && input.event) {
        const proposal = await n8n.proposeWorkflow({
          event: input.event as N8nCrmEvent,
          payload: input.payload,
        });
        path = proposal.webhookPath;
      }
      if (!path) {
        return {
          triggered: false,
          blocked: true,
          reason: "webhookPath or event required",
          tool: "n8n.trigger" as const,
        };
      }
      const result = await n8n.triggerWebhook({
        webhookPath: path,
        payload: {
          ...(input.payload ?? {}),
          _triggeredBy: ctx.employeeId,
          _hitl: input.allowProductionTrigger,
        },
        allowProductionTrigger: input.allowProductionTrigger,
      });
      return { ...result, tool: "n8n.trigger" as const };
    }),

  getExecutionStatus: protectedProcedure
    .input(z.object({ executionId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const n8n = await n8nClient(ctx.employeeId);
      return n8n.getExecutionStatus(input.executionId);
    }),
});

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
  type AuditWriter,
  type EmitHook,
  type EntitySnapshot,
  type TransitionResult,
} from "@hrmny/gate";
import {
  createComposioLiveSend,
  createComposioStub,
  createEmailVerificationAdapter,
  createLeadSourceAdapter,
  type ComposioSendAdapter,
} from "@hrmny/integrations";
import { ReplyIntentSchema } from "@hrmny/ai";
import { getContact, getDeal } from "../crm/repository";
import { emitHealthSignal, writeAudit } from "../m1-persistence";
import { defaultRunAgent, type RunAgent } from "../leadgen/agent-run";
import {
  getOutreach,
  insertOutreach,
  listOutreach,
  patchOutreach,
  type OutreachItem,
} from "../leadgen/store";
import { applyReplyIntent } from "../leadgen/reply-intent";
import { runCompetitorScan, listCompetitorFindings } from "../leadgen/competitor-scan";
import { runDailyLeadGen } from "../leadgen/pipeline";
import { router, staffProcedure } from "./trpc";
import { getVerifiedWorkAppConnection } from "./connections-router";

async function resolveComposioSend(
  employeeId: string | null | undefined,
  roles: readonly string[],
): Promise<ComposioSendAdapter> {
  if (!employeeId) {
    return createComposioStub();
  }
  if (process.env.COMPOSIO_API_KEY?.trim()) {
    try {
      const verified = await getVerifiedWorkAppConnection(employeeId, "gmail", {
        roles,
      });
      if (verified) {
        return createComposioLiveSend({
          client: verified.client,
          connectedAccountId: verified.account.id,
        });
      }
    } catch {
      /* fall through to Google Workspace */
    }
  }
  try {
    const { createGoogleWorkspaceGmailSend } = await import(
      "../leadgen/google-workspace-send"
    );
    const { getGoogleWorkspaceAccessToken } = await import(
      "./connections-router"
    );
    const token = await getGoogleWorkspaceAccessToken(employeeId);
    if (token) return createGoogleWorkspaceGmailSend(employeeId);
  } catch {
    /* stub */
  }
  return createComposioStub();
}
/**
 * M8 outreach HITL + lead-gen surface (importable module — orchestrator wires
 * it into appRouter). AI proposes; the gate disposes: `send` is a `outreach`
 * gate transition (draft → approved → sent) and is impossible without a prior
 * human approve. The plain `draft/approve/sendOutreach` fns hold the logic and
 * are exported so tests drive the gate flow without tRPC middleware.
 */

bootstrapGateRegistry();

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

/** Staff may drive outreach; portal actors never can. Gate is the real guard. */
function authorizeStaff(actor: ActorContext): boolean {
  return actor.roles.length > 0 && !actor.roles.includes("portal_client");
}

const defaultAudit: AuditWriter = async (event) => {
  const row = await writeAudit({
    actorEmployeeId: event.actorEmployeeId,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    before: event.before,
    after: event.after,
    reason: event.reason ?? null,
  });
  return { auditId: row.auditEventId };
};

const defaultEmit: EmitHook = async (event) => {
  const blocked = event.name.endsWith("transition_blocked");
  await emitHealthSignal(
    blocked ? "gate_blocked" : "outreach_transition",
    blocked ? "warn" : "info",
    event.payload,
  );
};

function outreachEntity(item: OutreachItem): EntitySnapshot {
  return {
    entityType: "outreach",
    entityId: item.id,
    state: item.state,
    data: { ...item },
  };
}

// ── plain, testable operations ─────────────────────────────

export async function draftOutreach(input: {
  dealId: string;
  channel?: string;
  /** Provide copy directly, or let the outreach-draft agent generate it. */
  body?: string;
  subject?: string;
  runAgent?: RunAgent;
}): Promise<OutreachItem> {
  const deal = await getDeal(input.dealId);
  if (!deal) throw new Error(`Deal not found: ${input.dealId}`);

  const contact = deal.primaryContactId
    ? await getContact(deal.primaryContactId)
    : null;
  const recipient = contact?.email ?? "";

  let subject = input.subject ?? "Quick idea for your team";
  let body = input.body;
  if (!body) {
    const runAgent = input.runAgent ?? defaultRunAgent;
    const run = await runAgent({
      agent: "outreach-draft",
      input: { dealId: input.dealId, company: deal.companyName },
    });
    const out = (typeof run.output === "object" && run.output ? run.output : {}) as Record<
      string,
      unknown
    >;
    // Kill switch / policy refusals come back as typed output, not throws
    // (same semantics as crm-ai's assertNotRefused). Never queue a refusal
    // JSON blob as a draft — fail loud so every caller surfaces it.
    if (out.refused === true) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          typeof out.message === "string" ? out.message : "Agent run refused",
      });
    }
    subject = typeof out.subject === "string" ? out.subject : subject;
    body =
      typeof out.body === "string"
        ? out.body
        : typeof run.output === "string"
          ? run.output
          : JSON.stringify(run.output);
  }

  return insertOutreach({
    dealId: input.dealId,
    channel: input.channel ?? "gmail",
    recipient,
    subject,
    body,
  });
}

export async function approveOutreach(input: {
  id: string;
  actor: ActorContext;
  audit?: AuditWriter;
  emit?: EmitHook;
}): Promise<TransitionResult> {
  const item = await getOutreach(input.id);
  if (!item) throw new Error(`Outreach not found: ${input.id}`);
  return transition(
    input.actor,
    outreachEntity(item),
    { to: "approved", from: item.state },
    {
      authorize: async (a) => authorizeStaff(a),
      apply: async () => {
        const next = await patchOutreach(input.id, {
          state: "approved",
          approvedBy: input.actor.employeeId,
        });
        return outreachEntity(next!);
      },
      audit: input.audit ?? defaultAudit,
      emit: input.emit ?? defaultEmit,
    },
  );
}

export async function discardOutreach(input: {
  id: string;
  actor: ActorContext;
  audit?: AuditWriter;
  emit?: EmitHook;
}): Promise<TransitionResult> {
  const item = await getOutreach(input.id);
  if (!item) throw new Error(`Outreach not found: ${input.id}`);
  return transition(
    input.actor,
    outreachEntity(item),
    { to: "discarded", from: item.state },
    {
      authorize: async (a) => authorizeStaff(a),
      apply: async () => {
        const next = await patchOutreach(input.id, { state: "discarded" });
        return outreachEntity(next!);
      },
      audit: input.audit ?? defaultAudit,
      emit: input.emit ?? defaultEmit,
    },
  );
}

export async function sendOutreach(input: {
  id: string;
  actor: ActorContext;
  composio?: ComposioSendAdapter;
  audit?: AuditWriter;
  emit?: EmitHook;
}): Promise<
  TransitionResult & { externalId?: string; sendMode?: string }
> {
  const item = await getOutreach(input.id);
  if (!item) throw new Error(`Outreach not found: ${input.id}`);
  const composio =
    input.composio ??
    (await resolveComposioSend(input.actor.employeeId, input.actor.roles));
  let externalId: string | undefined;
  let sendMode: string | undefined;
  const toolkit =
    item.channel === "linkedin" ? ("linkedin" as const) : ("gmail" as const);

  const result = await transition(
    input.actor,
    outreachEntity(item),
    { to: "sent", from: item.state },
    {
      authorize: async (a) => authorizeStaff(a),
      // The approve-before-send gate has already cleared here; the external
      // side effect and the "sent" state land together so we never mark sent
      // without an actual send.
      apply: async () => {
        const res = await composio.sendAfterApproval({
          toolkit,
          to: item.recipient,
          subject: item.subject ?? undefined,
          body: item.body,
        });
        externalId = res.externalId;
        sendMode = res.mode;
        const next = await patchOutreach(input.id, {
          state: "sent",
          sentAt: new Date().toISOString(),
          externalId: res.externalId,
        });
        return outreachEntity(next!);
      },
      audit: input.audit ?? defaultAudit,
      emit: input.emit ?? defaultEmit,
    },
  );

  return { ...result, externalId, sendMode };
}

// ── tRPC surface ───────────────────────────────────────────

const outreachRouter = router({
  list: staffProcedure
    .input(
      z
        .object({
          dealId: z.string().optional(),
          state: z.enum(["draft", "approved", "sent", "discarded"]).optional(),
        })
        .optional(),
    )
    .query(({ input }) => listOutreach(input)),

  get: staffProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => getOutreach(input.id)),

  draft: staffProcedure
    .input(
      z.object({
        dealId: z.string().uuid(),
        channel: z.string().optional(),
        subject: z.string().optional(),
        body: z.string().optional(),
      }),
    )
    .mutation(({ input }) => draftOutreach(input)),

  approve: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) =>
      approveOutreach({ id: input.id, actor: actorFromCtx(ctx) }),
    ),

  send: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) =>
      sendOutreach({
        id: input.id,
        actor: actorFromCtx(ctx),
      }),
    ),

  discard: staffProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input, ctx }) =>
      discardOutreach({ id: input.id, actor: actorFromCtx(ctx) }),
    ),
});

export const leadgenRouter = router({
  outreach: outreachRouter,

  /** Apply an already-classified reply intent to a deal (M7 classifies). */
  applyReplyIntent: staffProcedure
    .input(z.object({ dealId: z.string().uuid(), intent: ReplyIntentSchema }))
    .mutation(({ input, ctx }) =>
      applyReplyIntent({
        dealId: input.dealId,
        intent: input.intent,
        actorEmployeeId: ctx.employeeId,
      }),
    ),

  competitor: router({
    scan: staffProcedure
      .input(z.object({ competitor: z.string().min(1), scopeId: z.string().optional() }))
      .mutation(({ input }) => runCompetitorScan(input)),
    list: staffProcedure
      .input(z.object({ scopeId: z.string().optional() }).optional())
      .query(({ input }) => listCompetitorFindings(input?.scopeId)),
  }),

  /** Manual daily-pipeline trigger (Inngest runs the same fn on schedule). */
  runDailyPipeline: staffProcedure.mutation(async ({ ctx }) => {
    const { resolveIntegrationApiKey } = await import(
      "../integrations/resolve-keys"
    );
    const apollo = await resolveIntegrationApiKey("apollo", ctx.employeeId);
    const hunter = await resolveIntegrationApiKey("hunter", ctx.employeeId);
    return runDailyLeadGen({
      leadSource: createLeadSourceAdapter(
        apollo.apiKey ? { mode: "live", apiKey: apollo.apiKey } : undefined,
      ),
      verifier: createEmailVerificationAdapter(
        hunter.apiKey ? { mode: "live", apiKey: hunter.apiKey } : undefined,
      ),
    });
  }),
});
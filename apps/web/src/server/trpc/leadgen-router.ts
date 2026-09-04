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
  type ComposioSendAdapter,
} from "@hrmny/integrations";
import { ReplyIntentSchema } from "@hrmny/ai";
import { getContact, getDeal, listNotes } from "../crm/repository";
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
import {
  runCompetitorScan,
  listCompetitorFindings,
} from "../leadgen/competitor-scan";
import { router, staffProcedure } from "./trpc";
import { getVerifiedWorkAppConnection } from "./connections-router";
import {
  completeIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  updateIntegrationReceiptProgress,
} from "../integrations/inbox";
import { OUTREACH_GUIDELINES } from "../sales-os/sops";
import { buildEmailFollowupStatuses } from "../sales-os/followups";

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
    const { createGoogleWorkspaceGmailSend } =
      await import("../leadgen/google-workspace-send");
    const { getGoogleWorkspaceAccessToken } =
      await import("./connections-router");
    const token = await getGoogleWorkspaceAccessToken(employeeId);
    if (token) return createGoogleWorkspaceGmailSend(employeeId);
  } catch (err) {
    // A Workspace vault row that cannot refresh must not silently stub —
    // that hides reconnect-needed failures behind a fake "sent".
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("Google token refresh failed") ||
      message.includes("Google OAuth client credentials") ||
      message.includes("secret is unavailable")
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${message}. Reconnect Google Workspace under Settings → Connections.`,
      });
    }
  }
  // In supabase (prod) mode never pretend a send succeeded without a live
  // Composio Gmail or Google Workspace token — stub would mark outreach sent.
  if ((process.env.AUTH_MODE ?? "supabase").toLowerCase() === "supabase") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "No live Gmail connection. Connect Google Workspace or Composio Gmail under Settings → Connections.",
    });
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

const SALES_OPERATOR_ROLES = new Set([
  "partner",
  "director",
  "am",
  "account_manager",
]);

/** Only Sales operators may approve or deliver outreach. */
function authorizeStaff(actor: ActorContext): boolean {
  return actor.roles.some((role) => SALES_OPERATOR_ROLES.has(role));
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

async function recipientBoundEmailBody(item: OutreachItem): Promise<string> {
  const {
    buildComplianceFooter,
    buildUnsubscribeUrl,
    ensureFooter,
    hasValidUnsubscribeLink,
    isEmailChannel,
  } = await import("../sales-os/compliance");
  if (
    !isEmailChannel(item.channel) ||
    hasValidUnsubscribeLink(item.body, item.recipient)
  ) {
    return item.body;
  }
  const { getSalesOsSettings } = await import("../sales-os/store");
  const settings = await getSalesOsSettings();
  return ensureFooter(
    item.body,
    buildComplianceFooter({
      senderName: settings.outreach.senderName,
      senderTitle: settings.outreach.senderTitle,
      physicalAddress: settings.outreach.physicalAddress,
      unsubscribeUrl: buildUnsubscribeUrl(
        settings.outreach.unsubscribePath,
        item.recipient,
      ),
    }),
  );
}

// ── plain, testable operations ─────────────────────────────

export async function draftOutreach(input: {
  dealId: string;
  channel?: string;
  /** Provide copy directly, or let the outreach-draft agent generate it. */
  body?: string;
  subject?: string;
  runAgent?: RunAgent;
  cadenceTouch?: number;
  previousMessage?: { subject: string | null; body: string };
}): Promise<OutreachItem> {
  const deal = await getDeal(input.dealId);
  if (!deal) throw new Error(`Deal not found: ${input.dealId}`);

  const contact = deal.primaryContactId
    ? await getContact(deal.primaryContactId)
    : null;
  const knowledgeBrief = (await listNotes({ dealId: deal.dealId })).find(
    (note) => note.body.startsWith("SALES KNOWLEDGE BRIEF —"),
  );
  const channel = input.channel ?? "gmail";
  const {
    isEmailChannel,
    isLinkedInChannel,
    ensureFooter,
    buildComplianceFooter,
    buildUnsubscribeUrl,
  } = await import("../sales-os/compliance");
  const { getSalesOsSettings } = await import("../sales-os/store");
  const settings = await getSalesOsSettings();
  const outputChannel = isEmailChannel(channel)
    ? "email"
    : channel === "linkedin_followup"
      ? "linkedin_followup"
      : "linkedin_connect";
  if (
    !input.body &&
    isEmailChannel(channel) &&
    (!contact?.email || !contact.emailVerified)
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Unlock and verify this lead's work email before creating an email draft. No AI call was made.",
    });
  }
  if (isLinkedInChannel(channel) && !contact?.linkedinUrl) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This lead has no LinkedIn profile URL yet. Enrich the exact person or add a verified profile before drafting.",
    });
  }
  const recipient = isLinkedInChannel(channel)
    ? (contact?.linkedinUrl ?? contact?.email ?? "")
    : (contact?.email ?? "");

  let subject =
    input.subject ??
    (isLinkedInChannel(channel)
      ? outputChannel === "linkedin_followup"
        ? "LinkedIn follow-up"
        : "LinkedIn connection"
      : `An idea for ${deal.companyName}`);
  let body = input.body;
  if (!body) {
    const runAgent = input.runAgent ?? defaultRunAgent;
    const contactName = contact
      ? [contact.firstName, contact.lastName].filter(Boolean).join(" ")
      : "the prospect";
    const run = await runAgent({
      agent: "outreach-draft",
      input: [
        `Write exactly one ${outputChannel.replace(/_/g, " ")} message.`,
        `firstName: ${contact?.firstName?.trim() || "there"}`,
        `company: ${deal.companyName}`,
        `Sender: ${settings.outreach.senderName}, ${settings.outreach.senderTitle}. Sender company: hrmny, a UAE creative agency.`,
        `Recipient: ${contactName}${contact?.title ? `, ${contact.title}` : ""} at ${deal.companyName}.`,
        `Channel: ${outputChannel}`,
        `Hard identity rule: write FROM hrmny TO ${deal.companyName}. Never write as, for, or on behalf of ${deal.companyName}; never describe its services, team, history, or goals as hrmny's.`,
        "Use verified facts only. Do not mention Apollo, BUAF, internal scoring, unverified contact data, or the research process.",
        "Return one JSON object with channel, subject, body, and cta. Body must contain only the final sendable message: no analysis, labels, notes, alternatives, or Markdown headings.",
        OUTREACH_GUIDELINES,
        ...(input.previousMessage
          ? [
              `This is follow-up touch ${input.cadenceTouch ?? 2}. Keep it concise (80–120 words), add new value, and do not repeat the first email.`,
              `Keep the existing email thread subject. Previous subject: ${input.previousMessage.subject ?? "(no subject)"}.`,
              `Previous message:\n${input.previousMessage.body.slice(0, 4_000)}`,
            ]
          : []),
      ].join("\n"),
      context: {
        dealId: input.dealId,
        voice: settings.outreach.voice,
        ...(knowledgeBrief
          ? { knowledgeBrief: knowledgeBrief.body.slice(0, 10_000) }
          : {}),
      },
    });
    const out = (
      typeof run.output === "object" && run.output ? run.output : {}
    ) as Record<string, unknown>;
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
    if (!input.subject && typeof out.subject === "string") {
      subject = out.subject;
    }
    body =
      typeof out.body === "string"
        ? out.body.trim()
        : typeof run.output === "string"
          ? run.output.trim()
          : JSON.stringify(run.output);
    if (
      outputChannel === "linkedin_connect" &&
      body.length > settings.outreach.linkedinConnectMaxChars
    ) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `The LinkedIn connection draft exceeded ${settings.outreach.linkedinConnectMaxChars} characters. Nothing was queued.`,
      });
    }
  }

  if (isEmailChannel(channel) && body) {
    body = ensureFooter(
      body,
      buildComplianceFooter({
        senderName: settings.outreach.senderName,
        senderTitle: settings.outreach.senderTitle,
        physicalAddress: settings.outreach.physicalAddress,
        unsubscribeUrl: recipient
          ? buildUnsubscribeUrl(settings.outreach.unsubscribePath, recipient)
          : undefined,
      }),
    );
  }

  return insertOutreach({
    dealId: input.dealId,
    channel,
    recipient,
    subject,
    body: body ?? "",
    contactId: contact?.contactId ?? null,
    linkedinUrl: contact?.linkedinUrl ?? null,
    cadenceTouch: input.cadenceTouch,
  });
}

export async function listEmailFollowups(now = new Date()) {
  const { getSalesOsSettings, listEmailEvents } =
    await import("../sales-os/store");
  const [settings, outreach, emailEvents] = await Promise.all([
    getSalesOsSettings(),
    listOutreach(),
    listEmailEvents(),
  ]);
  return buildEmailFollowupStatuses({
    outreach,
    emailEvents,
    cadenceTouches: settings.outreach.cadenceTouches,
    cadenceDays: settings.outreach.cadenceDays,
    now,
  });
}

export async function draftEmailFollowup(input: {
  id: string;
  runAgent?: RunAgent;
}): Promise<OutreachItem> {
  const source = await getOutreach(input.id);
  if (!source || !["gmail", "email"].includes(source.channel.toLowerCase())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a sent Gmail message to prepare a follow-up",
    });
  }
  const status = (await listEmailFollowups()).find(
    (item) => item.sourceId === source.id,
  );
  if (!status) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Send the first approved email before preparing a follow-up",
    });
  }
  if (status.state === "queued" && status.queuedItemId) {
    const queued = await getOutreach(status.queuedItemId);
    if (queued) return queued;
  }
  if (status.state === "replied" || status.state === "stopped") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: status.reason,
    });
  }
  if (status.state === "complete" || !status.nextTouch) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: status.reason,
    });
  }

  const deal = await getDeal(source.dealId);
  if (!deal) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deal not found" });
  }
  const contact = deal.primaryContactId
    ? await getContact(deal.primaryContactId)
    : null;
  if (
    !contact?.emailVerified ||
    contact.email?.trim().toLowerCase() !==
      source.recipient.trim().toLowerCase()
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The verified primary contact no longer matches this email thread. Review the deal before following up.",
    });
  }

  const subject = source.subject?.trim()
    ? source.subject.trim().toLowerCase().startsWith("re:")
      ? source.subject.trim()
      : `Re: ${source.subject.trim()}`
    : `Following up with ${deal.companyName}`;
  return draftOutreach({
    dealId: source.dealId,
    channel: "gmail",
    subject,
    cadenceTouch: status.nextTouch,
    previousMessage: { subject: source.subject, body: source.body },
    runAgent: input.runAgent,
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
        const body = await recipientBoundEmailBody(item);
        const next = await patchOutreach(input.id, {
          state: "approved",
          approvedBy: input.actor.employeeId,
          body,
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
  TransitionResult & {
    externalId?: string;
    threadId?: string;
    sendMode?: string;
    /** Present when LinkedIn (or other) copy-draft completed without flipping to sent. */
    copyDraft?: boolean;
  }
> {
  const item = await getOutreach(input.id);
  if (!item) throw new Error(`Outreach not found: ${input.id}`);
  const { assertEmailSendAllowed, isEmailChannel, isLinkedInChannel } =
    await import("../sales-os/compliance");
  if (isLinkedInChannel(item.channel)) {
    return {
      ok: true,
      newState: item.state,
      auditId: "copy_draft",
      sendMode: "copy_draft",
      copyDraft: true,
    };
  }
  if (
    isEmailChannel(item.channel) &&
    item.state === "approved" &&
    authorizeStaff(input.actor)
  ) {
    const [contact, deal] = await Promise.all([
      item.contactId ? getContact(item.contactId) : null,
      getDeal(item.dealId),
    ]);
    const recipientMatches =
      contact?.email?.trim().toLowerCase() ===
      item.recipient.trim().toLowerCase();
    const allowed = await assertEmailSendAllowed({
      email: item.recipient,
      emailVerified: Boolean(contact?.emailVerified && recipientMatches),
      body: item.body,
      companyName: deal?.companyName,
    });
    if (!allowed.ok) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: allowed.reason,
      });
    }
    const nextBody = await recipientBoundEmailBody(item);
    if (nextBody !== item.body) {
      await patchOutreach(input.id, { body: nextBody });
      item.body = nextBody;
    }
  }
  const composio =
    input.composio ??
    (await resolveComposioSend(input.actor.employeeId, input.actor.roles));
  let externalId: string | undefined;
  let threadId: string | undefined;
  let sendMode: string | undefined;
  const toolkit =
    item.channel === "linkedin" ? ("linkedin" as const) : ("gmail" as const);

  try {
    const result = await transition(
      input.actor,
      outreachEntity(item),
      { to: "sent", from: item.state },
      {
        authorize: async (a) => authorizeStaff(a),
        // Live send + durable "sent" land together. Stub/copy_draft must not
        // flip state — throw so the row stays approved.
        apply: async () => {
          const messageId = `<hrmny-outreach-${item.id}@hrmny.co>`;
          const rawBody = JSON.stringify({
            outreachItemId: item.id,
            recipient: item.recipient,
            subject: item.subject,
            body: item.body,
            messageId,
          });
          const receipt = await recordIntegrationReceipt({
            provider: "gmail",
            externalEventId: `outreach-send:${item.id}`,
            operation: "messages.send",
            rawBody,
            status: "processing",
            result: { bridgeStatus: "sending" },
            ownerEmployeeId: input.actor.employeeId,
            payload: {
              outreachItemId: item.id,
              recipient: item.recipient,
              messageId,
            },
          });

          let shouldSend = !receipt.duplicate;
          if (
            receipt.duplicate &&
            receipt.status === "failed" &&
            receipt.result?.bridgeStatus === "not_sent"
          ) {
            shouldSend = await transitionIntegrationReceiptProgress(
              receipt.receiptId,
              {
                status: "failed",
                stateVersion: receipt.stateVersion,
              },
              {
                status: "processing",
                result: { bridgeStatus: "sending" },
              },
            );
          }

          if (!shouldSend) {
            if (
              receipt.status !== "completed" ||
              typeof receipt.result?.externalId !== "string"
            ) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "A previous Gmail attempt has an uncertain outcome. Check Sent Mail before taking another action; HRMNY will not send it twice.",
              });
            }
            externalId = receipt.result.externalId;
            threadId =
              typeof receipt.result.threadId === "string"
                ? receipt.result.threadId
                : undefined;
            sendMode = "live";
          } else {
            try {
              const res = await composio.sendAfterApproval({
                toolkit,
                to: item.recipient,
                subject: item.subject ?? undefined,
                body: item.body,
                messageId,
              });
              externalId = res.externalId;
              threadId = res.threadId;
              sendMode = res.mode;

              if (res.mode === "copy_draft") {
                throw Object.assign(new Error("COPY_DRAFT"), {
                  code: "COPY_DRAFT" as const,
                  externalId: res.externalId,
                  sendMode: res.mode,
                });
              }
              if (!res.sent || res.mode !== "live") {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message:
                    res.mode === "stub"
                      ? "Gmail send is not live. Connect Google Workspace or Composio Gmail under Settings → Connections. Outreach stays approved."
                      : `Gmail send did not complete (mode=${res.mode}). Outreach stays approved.`,
                });
              }
              await completeIntegrationReceipt(receipt.receiptId, {
                outreachItemId: item.id,
                externalId,
                ...(threadId ? { threadId } : {}),
                messageId,
                sendMode,
              });
            } catch (error) {
              const definitelyNotSent = sendMode === "stub";
              await updateIntegrationReceiptProgress(receipt.receiptId, {
                status: definitelyNotSent ? "failed" : "processing",
                result: {
                  bridgeStatus: definitelyNotSent
                    ? "not_sent"
                    : "reconcile_required",
                  outreachItemId: item.id,
                  messageId,
                },
                lastError:
                  error instanceof Error ? error.message : "Gmail send failed",
              }).catch(() => undefined);
              throw error;
            }
          }

          if (!externalId) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Gmail send completed without a provider message id",
            });
          }
          const next = await patchOutreach(input.id, {
            state: "sent",
            sentAt: new Date().toISOString(),
            externalId,
          });
          const { listEmailEvents, recordEmailEvent } =
            await import("../sales-os/store");
          const recorded = (await listEmailEvents({ kind: "sent" })).some(
            (event) => event.externalId === externalId,
          );
          if (!recorded) {
            await recordEmailEvent({
              outreachItemId: input.id,
              contactId: item.contactId,
              kind: "sent",
              provider: "gmail",
              externalId: externalId ?? null,
              payload: {
                ownerEmployeeId: input.actor.employeeId,
                ...(threadId ? { threadId } : {}),
              },
            });
          }
          return outreachEntity(next!);
        },
        audit: input.audit ?? defaultAudit,
        emit: input.emit ?? defaultEmit,
      },
    );

    return { ...result, externalId, threadId, sendMode };
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "COPY_DRAFT"
    ) {
      const draftErr = err as {
        externalId?: string;
        sendMode?: string;
      };
      return {
        ok: true,
        newState: item.state,
        auditId: "copy_draft",
        externalId: draftErr.externalId ?? externalId,
        sendMode: draftErr.sendMode ?? sendMode ?? "copy_draft",
        copyDraft: true,
      };
    }
    throw err;
  }
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

  followups: staffProcedure.query(() => listEmailFollowups()),

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

  draftFollowup: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ input }) => draftEmailFollowup(input)),

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
      .input(
        z.object({
          competitor: z.string().min(1),
          scopeId: z.string().optional(),
        }),
      )
      .mutation(({ input }) => runCompetitorScan(input)),
    list: staffProcedure
      .input(z.object({ scopeId: z.string().optional() }).optional())
      .query(({ input }) => listCompetitorFindings(input?.scopeId)),
  }),

  /**
   * Compatibility endpoint for the retired bulk pipeline. It previously turned
   * one generic staff click into provider reads, paid verification, AI work, and
   * CRM company/contact/deal creation. Keep the route stable while directing
   * operators to the accepted Signal → Research → Person approval loop.
   */
  runDailyPipeline: staffProcedure.mutation(() => ({
    ran: false as const,
    skipped: "legacy_pipeline_disabled" as const,
    next: "/crm/hunt",
  })),
});

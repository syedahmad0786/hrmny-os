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
  GmailProviderReadbackError,
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
import {
  getGoogleWorkspaceSenderEmail,
  getVerifiedWorkAppConnection,
  listSalesSenderMailboxes,
  type SalesSenderMailbox,
} from "./connections-router";
import {
  completeIntegrationReceipt,
  getIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  updateIntegrationReceiptProgress,
} from "../integrations/inbox";
import { OUTREACH_GUIDELINES } from "../sales-os/sops";
import { buildEmailFollowupStatuses } from "../sales-os/followups";
import {
  getSalesConversation,
  listSalesConversations,
} from "../sales-os/conversations";

async function resolveComposioSend(
  employeeId: string | null | undefined,
  roles: readonly string[],
  senderConnectionAccountId?: string,
  boundComposioAccountId?: string,
): Promise<ComposioSendAdapter> {
  if (!employeeId) {
    return createComposioStub();
  }
  // Sales shows the named Workspace mailbox before confirmation, so use that
  // same mailbox whenever it is connected. Composio remains the fallback.
  if (!boundComposioAccountId) {
    try {
      const { createGoogleWorkspaceGmailSend } =
        await import("../leadgen/google-workspace-send");
      const { getGoogleWorkspaceAccessToken } =
        await import("./connections-router");
      const options = {
        connectionAccountId: senderConnectionAccountId,
        roles,
      };
      const token = await getGoogleWorkspaceAccessToken(employeeId, options);
      if (token) return createGoogleWorkspaceGmailSend(employeeId, options);
      if (senderConnectionAccountId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The selected Google Workspace sender must be reconnected.",
        });
      }
    } catch (err) {
      if (senderConnectionAccountId || err instanceof TRPCError) throw err;
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
  }
  if (process.env.COMPOSIO_API_KEY?.trim()) {
    try {
      const verified = await getVerifiedWorkAppConnection(employeeId, "gmail", {
        roles,
        connectedAccountId: boundComposioAccountId,
      });
      if (verified) {
        return createComposioLiveSend({
          client: verified.client,
          connectedAccountId: verified.account.id,
        });
      }
      if (boundComposioAccountId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The Gmail mailbox that received this conversation is no longer connected. Reconnect that mailbox before replying.",
        });
      }
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      /* fall through to the fail-closed production guard */
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

async function resolveSalesSender(
  actor: ActorContext,
  connectionAccountId?: string,
): Promise<SalesSenderMailbox | null> {
  const mailboxes = await listSalesSenderMailboxes({
    employeeId: actor.employeeId,
    roles: actor.roles,
  });
  const sender = connectionAccountId
    ? mailboxes.find(
        (mailbox) => mailbox.connectionAccountId === connectionAccountId,
      )
    : mailboxes[0];
  if (connectionAccountId && !sender) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "The selected Google Workspace sender is not approved.",
    });
  }
  return sender ?? null;
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
  const suppliedBody = input.body?.trim() || undefined;
  if (!suppliedBody && !input.previousMessage && !knowledgeBrief) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Build and save this lead's knowledge brief before asking AI to create a first-touch draft. Open the deal and select Research. No AI call was made.",
    });
  }
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
  let body = suppliedBody;
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
        "Use only prospect-specific facts supplied in the saved brief or previous message. Do not claim hrmny client results, case studies, percentages, awards, or named clients because no agency proof library is supplied.",
        "Do not mention Apollo, BUAF, internal scoring, unverified contact data, or the research process.",
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
  now?: Date;
  runAgent?: RunAgent;
}): Promise<OutreachItem> {
  const source = await getOutreach(input.id);
  if (!source || !["gmail", "email"].includes(source.channel.toLowerCase())) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose a sent Gmail message to prepare a follow-up",
    });
  }
  const { isSuppressed } = await import("../sales-os/store");
  const suppression = await isSuppressed({ email: source.recipient });
  if (suppression) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Suppressed (${suppression.reason}) — cadence stopped`,
    });
  }
  const status = (await listEmailFollowups(input.now)).find(
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

function testEmailBody(item: OutreachItem): string {
  const preview = item.body.replace(
    /^(?:Unsubscribe:|To stop hearing from us:)\s+\S+$/gim,
    "Unsubscribe link hidden in this internal test.",
  );
  return [
    "HRMNY INTERNAL TEST — this email was not sent to the client.",
    `Original intended recipient: ${item.recipient}`,
    "",
    "--- MESSAGE PREVIEW ---",
    preview,
  ].join("\n");
}

/** Send an approved email to the operator's own @hrmny.co mailbox only. */
export async function sendOutreachTest(input: {
  id: string;
  idempotencyKey: string;
  actor: ActorContext;
  composio?: ComposioSendAdapter;
  senderConnectionAccountId?: string;
  /** Test-only dependency; the tRPC route always resolves this server-side. */
  testRecipient?: string;
}) {
  const item = await getOutreach(input.id);
  if (!item) throw new Error(`Outreach not found: ${input.id}`);
  const { isEmailChannel } = await import("../sales-os/compliance");
  if (!authorizeStaff(input.actor) || item.state !== "approved") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Approve the email draft before sending an internal test.",
    });
  }
  if (!isEmailChannel(item.channel)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Internal test sending is available for Gmail drafts only.",
    });
  }
  const sender = input.testRecipient
    ? null
    : await resolveSalesSender(input.actor, input.senderConnectionAccountId);
  const recipient = (
    input.testRecipient ??
    sender?.email ??
    (await getGoogleWorkspaceSenderEmail(input.actor.employeeId, {
      connectionAccountId: input.senderConnectionAccountId,
      roles: input.actor.roles,
    }))
  )
    ?.trim()
    .toLowerCase();
  if (
    !recipient ||
    !z.string().email().safeParse(recipient).success ||
    !recipient.endsWith("@hrmny.co")
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Connect your @hrmny.co Google Workspace mailbox before sending a test.",
    });
  }

  const subject = `[TEST — NOT SENT TO CLIENT] ${item.subject ?? "(no subject)"}`;
  const body = testEmailBody(item);
  const messageId = `<hrmny-outreach-test-${input.idempotencyKey}@hrmny.co>`;
  const receipt = await recordIntegrationReceipt({
    provider: "gmail",
    externalEventId: `outreach-test-send:${input.idempotencyKey}`,
    operation: "messages.send.test",
    rawBody: JSON.stringify({
      outreachItemId: item.id,
      recipient,
      subject,
      body,
      messageId,
      senderConnectionAccountId: sender?.connectionAccountId,
      senderEmail: sender?.email ?? recipient,
    }),
    status: "processing",
    result: { bridgeStatus: "sending_test" },
    ownerEmployeeId: input.actor.employeeId,
    payload: {
      outreachItemId: item.id,
      recipient,
      intendedRecipient: item.recipient,
      messageId,
      senderConnectionAccountId: sender?.connectionAccountId,
      senderEmail: sender?.email ?? recipient,
    },
  });
  if (receipt.duplicate) {
    const priorResult = receipt.result ?? {};
    if (
      receipt.status === "completed" &&
      priorResult.providerAccepted === true &&
      typeof priorResult.externalId === "string"
    ) {
      return {
        sent: true as const,
        duplicate: true as const,
        recipient,
        receiptId: receipt.receiptId,
        externalId: priorResult.externalId,
        threadId:
          typeof priorResult.threadId === "string"
            ? priorResult.threadId
            : undefined,
        readbackAt:
          typeof priorResult.readbackAt === "string"
            ? priorResult.readbackAt
            : undefined,
        outreachState: item.state,
      };
    }
    if (
      (receipt.status === "processing" || receipt.status === "completed") &&
      priorResult.providerAccepted !== true &&
      typeof priorResult.externalId === "string"
    ) {
      const composio =
        input.composio ??
        (await resolveComposioSend(
          input.actor.employeeId,
          input.actor.roles,
          sender?.connectionAccountId,
        ));
      const readback = await composio.readbackAfterSend({
        externalId: priorResult.externalId,
        recipient,
      });
      await completeIntegrationReceipt(receipt.receiptId, {
        ...priorResult,
        bridgeStatus: "test_provider_accepted",
        providerAccepted: true,
        externalId: readback.externalId,
        ...(readback.threadId ? { threadId: readback.threadId } : {}),
        readbackAt: readback.readbackAt,
        readbackRecipient: readback.recipient,
      });
      return {
        sent: true as const,
        duplicate: true as const,
        recipient,
        receiptId: receipt.receiptId,
        externalId: readback.externalId,
        threadId: readback.threadId,
        readbackAt: readback.readbackAt,
        outreachState: item.state,
      };
    }
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The test-send outcome is uncertain. Check your own Inbox and Sent Mail before trying again.",
    });
  }

  let providerAttempted = false;
  let mode: string | undefined;
  try {
    const composio =
      input.composio ??
      (await resolveComposioSend(
        input.actor.employeeId,
        input.actor.roles,
        sender?.connectionAccountId,
      ));
    providerAttempted = true;
    const sent = await composio.sendAfterApproval({
      toolkit: "gmail",
      to: recipient,
      subject,
      body,
      messageId,
    });
    mode = sent.mode;
    if (!sent.sent || sent.mode !== "live" || !sent.providerAccepted) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Gmail did not confirm the test message in Sent Mail. Reconnect Google Workspace.",
      });
    }
    await completeIntegrationReceipt(receipt.receiptId, {
      bridgeStatus: "test_provider_accepted",
      providerAccepted: true,
      outreachItemId: item.id,
      recipient,
      intendedRecipient: item.recipient,
      externalId: sent.externalId,
      ...(sent.threadId ? { threadId: sent.threadId } : {}),
      messageId,
      sendMode: sent.mode,
      readbackAt: sent.readbackAt,
      readbackRecipient: sent.readbackRecipient,
      senderConnectionAccountId: sender?.connectionAccountId,
      senderEmail: sender?.email ?? recipient,
    });
    return {
      sent: true as const,
      duplicate: false as const,
      recipient,
      receiptId: receipt.receiptId,
      externalId: sent.externalId,
      threadId: sent.threadId,
      readbackAt: sent.readbackAt,
      outreachState: item.state,
    };
  } catch (error) {
    const definitelyNotSent = !providerAttempted || mode === "stub";
    await updateIntegrationReceiptProgress(receipt.receiptId, {
      status: definitelyNotSent ? "failed" : "processing",
      result: {
        bridgeStatus: definitelyNotSent
          ? "test_not_sent"
          : "test_reconcile_required",
        outreachItemId: item.id,
        recipient,
        messageId,
        ...(error instanceof GmailProviderReadbackError
          ? {
              externalId: error.externalId,
              ...(error.threadId ? { threadId: error.threadId } : {}),
            }
          : {}),
      },
      lastError:
        error instanceof Error ? error.message : "Gmail test send failed",
    }).catch(() => undefined);
    throw error;
  }
}

/** Resolve an approved reply back to provider evidence, never from client input. */
export async function resolveGmailReplyContext(item: OutreachItem): Promise<{
  threadId: string;
  inReplyTo?: string;
  senderConnectionAccountId?: string;
} | null> {
  const receipt = await getIntegrationReceipt(
    "gmail",
    `outreach-reply-draft:${item.id}`,
  );
  if (!receipt) return null;
  if (
    receipt.status !== "completed" ||
    receipt.operation !== "messages.reply.draft" ||
    receipt.payload?.outreachItemId !== item.id ||
    receipt.payload?.dealId !== item.dealId ||
    receipt.payload?.recipient !== item.recipient.trim().toLowerCase()
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This Gmail reply has an invalid provider binding. Recreate the reply draft from Sales inbox; nothing was sent.",
    });
  }
  const threadId =
    typeof receipt.payload.threadId === "string"
      ? receipt.payload.threadId.trim()
      : undefined;
  if (!threadId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This Gmail reply is missing its original provider thread. Re-sync the conversation before sending; nothing was sent.",
    });
  }
  const inReplyTo =
    typeof receipt.payload.inReplyTo === "string" &&
    receipt.payload.inReplyTo.trim()
      ? receipt.payload.inReplyTo.trim()
      : undefined;
  const senderConnectionAccountId =
    typeof receipt.payload.senderConnectionAccountId === "string" &&
    receipt.payload.senderConnectionAccountId.trim()
      ? receipt.payload.senderConnectionAccountId.trim()
      : undefined;
  return {
    threadId,
    ...(inReplyTo ? { inReplyTo } : {}),
    ...(senderConnectionAccountId ? { senderConnectionAccountId } : {}),
  };
}

export async function sendOutreach(input: {
  id: string;
  actor: ActorContext;
  composio?: ComposioSendAdapter;
  senderConnectionAccountId?: string;
  audit?: AuditWriter;
  emit?: EmitHook;
}): Promise<
  TransitionResult & {
    externalId?: string;
    threadId?: string;
    sendMode?: string;
    providerAccepted?: boolean;
    readbackAt?: string;
    senderEmail?: string;
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
  const toolkit = "gmail" as const;
  const replyContext = await resolveGmailReplyContext(item);
  if (replyContext && !replyContext.inReplyTo) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This Gmail reply is missing the provider Message-ID required for a true threaded response. Re-sync the conversation before sending; nothing was sent.",
    });
  }
  if (replyContext && !replyContext.senderConnectionAccountId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This Gmail reply is not bound to its original sender mailbox. Re-sync the conversation before sending; nothing was sent.",
    });
  }
  if (
    replyContext?.senderConnectionAccountId &&
    input.senderConnectionAccountId &&
    input.senderConnectionAccountId !== replyContext.senderConnectionAccountId
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Replies must use the same connected Gmail mailbox that received the conversation.",
    });
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
  const requiredSenderConnectionAccountId =
    replyContext?.senderConnectionAccountId ?? input.senderConnectionAccountId;
  let sender: SalesSenderMailbox | null = null;
  let boundComposioAccountId: string | undefined;
  if (!input.composio) {
    if (replyContext?.senderConnectionAccountId) {
      sender =
        (
          await listSalesSenderMailboxes({
            employeeId: input.actor.employeeId,
            roles: input.actor.roles,
          })
        ).find(
          (mailbox) =>
            mailbox.connectionAccountId ===
            replyContext.senderConnectionAccountId,
        ) ?? null;
      if (!sender) {
        boundComposioAccountId = replyContext.senderConnectionAccountId;
      }
    } else {
      sender = await resolveSalesSender(
        input.actor,
        requiredSenderConnectionAccountId,
      );
    }
  }
  const composio =
    input.composio ??
    (await resolveComposioSend(
      input.actor.employeeId,
      input.actor.roles,
      sender?.connectionAccountId,
      boundComposioAccountId,
    ));
  let externalId: string | undefined;
  let threadId: string | undefined;
  let sendMode: string | undefined;
  let providerAccepted = false;
  let readbackAt: string | undefined;

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
            threadId: replyContext?.threadId,
            inReplyTo: replyContext?.inReplyTo,
            senderConnectionAccountId: requiredSenderConnectionAccountId,
            senderEmail: sender?.email,
          });
          const receipt = await recordIntegrationReceipt({
            provider: "gmail",
            externalEventId: `outreach-send:${item.id}`,
            operation: "messages.send",
            rawBody,
            status: "processing",
            result: { bridgeStatus: "sending" },
            ownerEmployeeId: input.actor.employeeId,
            credentialConnectionAccountId: sender?.connectionAccountId ?? null,
            payload: {
              outreachItemId: item.id,
              recipient: item.recipient,
              messageId,
              threadId: replyContext?.threadId,
              inReplyTo: replyContext?.inReplyTo,
              senderConnectionAccountId: requiredSenderConnectionAccountId,
              senderEmail: sender?.email,
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
            const receiptResult = receipt.result ?? {};
            const receiptExternalId =
              typeof receiptResult.externalId === "string"
                ? receiptResult.externalId
                : undefined;
            if (!receiptExternalId) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "A previous Gmail attempt has an uncertain outcome. Check Sent Mail before taking another action; HRMNY will not send it twice.",
              });
            }
            externalId = receiptExternalId;
            threadId =
              typeof receiptResult.threadId === "string"
                ? receiptResult.threadId
                : undefined;
            sendMode = "live";
            providerAccepted = receiptResult.providerAccepted === true;
            readbackAt =
              typeof receiptResult.readbackAt === "string"
                ? receiptResult.readbackAt
                : undefined;
            if (!providerAccepted) {
              const readback = await composio.readbackAfterSend({
                externalId,
                recipient: item.recipient,
                expectedThreadId: replyContext?.threadId,
              });
              threadId = readback.threadId ?? threadId;
              readbackAt = readback.readbackAt;
              providerAccepted = true;
              await completeIntegrationReceipt(receipt.receiptId, {
                ...receiptResult,
                bridgeStatus: "provider_accepted",
                providerAccepted: true,
                externalId,
                ...(threadId ? { threadId } : {}),
                readbackAt,
                readbackRecipient: readback.recipient,
              });
            }
          } else {
            let providerAttempted = false;
            try {
              if (sender) {
                const { reserveCreditWithinCap } =
                  await import("../sales-os/store");
                const period = `${new Date().toISOString().slice(0, 10)}:${sender.connectionAccountId}`;
                if (
                  !(await reserveCreditWithinCap(
                    "email_send",
                    sender.dailyCap,
                    1,
                    period,
                  ))
                ) {
                  throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: `${sender.label} has reached its ${sender.dailyCap}-email daily cap.`,
                  });
                }
              }
              providerAttempted = true;
              const res = await composio.sendAfterApproval({
                toolkit,
                to: item.recipient,
                subject: item.subject ?? undefined,
                body: item.body,
                messageId,
                threadId: replyContext?.threadId,
                inReplyTo: replyContext?.inReplyTo,
              });
              externalId = res.externalId;
              threadId = res.threadId;
              sendMode = res.mode;
              providerAccepted = res.providerAccepted;
              readbackAt = res.readbackAt;

              if (res.mode === "copy_draft") {
                throw Object.assign(new Error("COPY_DRAFT"), {
                  code: "COPY_DRAFT" as const,
                  externalId: res.externalId,
                  sendMode: res.mode,
                });
              }
              if (!res.sent || res.mode !== "live" || !res.providerAccepted) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message:
                    res.mode === "stub"
                      ? "Gmail send is not live. Connect Google Workspace or Composio Gmail under Settings → Connections. Outreach stays approved."
                      : `Gmail send did not complete (mode=${res.mode}). Outreach stays approved.`,
                });
              }
              await completeIntegrationReceipt(receipt.receiptId, {
                bridgeStatus: "provider_accepted",
                providerAccepted: true,
                outreachItemId: item.id,
                externalId,
                ...(threadId ? { threadId } : {}),
                messageId,
                sendMode,
                readbackAt,
                readbackRecipient: res.readbackRecipient,
                senderConnectionAccountId: requiredSenderConnectionAccountId,
                senderEmail: sender?.email,
              });
            } catch (error) {
              const definitelyNotSent =
                !providerAttempted || sendMode === "stub";
              await updateIntegrationReceiptProgress(receipt.receiptId, {
                status: definitelyNotSent ? "failed" : "processing",
                result: {
                  bridgeStatus: definitelyNotSent
                    ? "not_sent"
                    : "reconcile_required",
                  outreachItemId: item.id,
                  messageId,
                  senderConnectionAccountId: requiredSenderConnectionAccountId,
                  senderEmail: sender?.email,
                  ...(externalId
                    ? {
                        externalId,
                        ...(threadId ? { threadId } : {}),
                      }
                    : error instanceof GmailProviderReadbackError
                      ? {
                          externalId: error.externalId,
                          ...(error.threadId
                            ? { threadId: error.threadId }
                            : {}),
                        }
                      : {}),
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
                evidenceState: "provider_accepted",
                providerAccepted: true,
                readbackAt,
                senderConnectionAccountId: requiredSenderConnectionAccountId,
                senderEmail: sender?.email,
                dealId: item.dealId,
                recipient: item.recipient,
                subject: item.subject,
                body: item.body.slice(0, 2_000),
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

    return {
      ...result,
      externalId,
      threadId,
      sendMode,
      providerAccepted,
      readbackAt,
      senderEmail: sender?.email,
    };
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

  conversations: staffProcedure.query(({ ctx }) => {
    if (!authorizeStaff(actorFromCtx(ctx))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Only Sales operators may view Gmail conversations.",
      });
    }
    return listSalesConversations();
  }),

  draftReply: staffProcedure
    .input(
      z.object({
        conversationId: z.string().min(1).max(1_000),
        body: z.string().trim().min(1).max(20_000).optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const actor = actorFromCtx(ctx);
      if (!authorizeStaff(actor)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only Sales operators may draft replies.",
        });
      }
      const conversation = await getSalesConversation(input.conversationId);
      if (!conversation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found.",
        });
      }
      if (!conversation.dealId || !conversation.contactEmail) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Associate this reply with a CRM deal and verified contact before drafting.",
        });
      }
      if (
        !conversation.threadId ||
        !conversation.latestInboundMessageId ||
        !conversation.senderConnectionAccountId
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This Gmail conversation is missing its provider thread, Message-ID, or receiving mailbox. Re-sync it before drafting a reply.",
        });
      }
      if (conversation.replyDraftId) {
        const existing = await getOutreach(conversation.replyDraftId);
        if (existing) return existing;
      }
      const deal = await getDeal(conversation.dealId);
      const contact = deal?.primaryContactId
        ? await getContact(deal.primaryContactId)
        : null;
      if (
        !deal ||
        !contact?.email ||
        contact.email.trim().toLowerCase() !==
          conversation.contactEmail.trim().toLowerCase()
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The reply sender no longer matches the deal's primary contact. Review the CRM association first.",
        });
      }
      const prior = [...conversation.messages]
        .reverse()
        .find((message) => message.direction === "outbound");
      const draft = await draftOutreach({
        dealId: conversation.dealId,
        channel: "gmail",
        subject: conversation.subject
          ? conversation.subject.startsWith("Re:")
            ? conversation.subject
            : `Re: ${conversation.subject}`
          : "Re: Our conversation",
        body: input.body,
        cadenceTouch: Math.max(
          2,
          (await listOutreach({ dealId: conversation.dealId })).length + 1,
        ),
        previousMessage: {
          subject: prior?.subject ?? conversation.subject,
          body: conversation.latestInboundBody,
        },
      });
      const binding = {
        outreachItemId: draft.id,
        dealId: conversation.dealId,
        recipient: conversation.contactEmail.trim().toLowerCase(),
        conversationId: conversation.id,
        threadId: conversation.threadId,
        inReplyTo: conversation.latestInboundMessageId,
        senderConnectionAccountId: conversation.senderConnectionAccountId,
      };
      await recordIntegrationReceipt({
        provider: "gmail",
        externalEventId: `outreach-reply-draft:${draft.id}`,
        operation: "messages.reply.draft",
        rawBody: JSON.stringify(binding),
        status: "completed",
        completed: true,
        payload: binding,
        result: { state: "draft", outreachItemId: draft.id },
        ownerEmployeeId: actor.employeeId,
      });
      return draft;
    }),

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
    .input(
      z.object({
        id: z.string(),
        senderConnectionAccountId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      sendOutreach({
        ...input,
        actor: actorFromCtx(ctx),
      }),
    ),

  sendTest: staffProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        idempotencyKey: z.string().uuid(),
        senderConnectionAccountId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      sendOutreachTest({
        ...input,
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

import { emitHealthSignal, writeAudit } from "@/server/m1-persistence";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
} from "@/server/integrations/inbox";
import { ingestGmailReply } from "@/server/sales-os/replies";
import { verifyComposioAccountOwner } from "@/server/trpc/connections-router";
import { verifyComposioSignature } from "./verify";

type ComposioWebhookDeps = {
  verifyAccountOwner: typeof verifyComposioAccountOwner;
  ingestReply: typeof ingestGmailReply;
};

const defaultDeps: ComposioWebhookDeps = {
  verifyAccountOwner: verifyComposioAccountOwner,
  ingestReply: ingestGmailReply,
};

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

const text = (...values: unknown[]): string =>
  String(values.find((value) => typeof value === "string") ?? "").trim();

function senderEmail(value: string): string | null {
  const match = value.match(/<?([^\s<>]+@[^\s<>]+\.[^\s<>]+)>?/);
  return match?.[1]?.toLowerCase() ?? null;
}

async function handleTrigger(
  body: Record<string, unknown>,
  deps: ComposioWebhookDeps,
) {
  const metadata = asObject(body.metadata);
  const triggerSlug = text(metadata.trigger_slug, metadata.triggerSlug);
  if (triggerSlug !== "GMAIL_NEW_GMAIL_MESSAGE") {
    return { handled: "acknowledged", sideEffects: false } as const;
  }
  if (body.type !== "composio.trigger.message") {
    throw new Error("Unsupported Composio Gmail event type");
  }

  const employeeId = text(metadata.user_id, metadata.userId);
  const connectedAccountId = text(
    metadata.connected_account_id,
    metadata.connectedAccountId,
  );
  const data = asObject(body.data);
  const messageId = text(data.id, data.message_id, data.messageId);
  const threadId = text(data.thread_id, data.threadId);
  const fromEmail = senderEmail(
    text(data.sender, data.from, data.from_email, data.fromEmail),
  );
  const bodyText = text(data.message_text, data.text, data.body);
  const labelIds = Array.isArray(data.label_ids)
    ? data.label_ids.map(String)
    : Array.isArray(data.labelIds)
      ? data.labelIds.map(String)
      : [];

  if (
    labelIds.some((label) => ["DRAFT", "SENT"].includes(label.toUpperCase()))
  ) {
    return { handled: "gmail_ignored", reason: "outbound_or_draft" } as const;
  }
  if (
    !employeeId ||
    !connectedAccountId ||
    !messageId ||
    !fromEmail ||
    !bodyText
  ) {
    throw new Error("Incomplete Composio Gmail reply payload");
  }
  if (
    !(await deps.verifyAccountOwner({
      employeeId,
      toolkit: "gmail",
      connectedAccountId,
    }))
  ) {
    throw new Error("Composio Gmail account owner mismatch");
  }

  const result = await deps.ingestReply({
    fromEmail,
    body: bodyText,
    externalId: messageId,
    threadId: threadId || undefined,
    actorEmployeeId: employeeId,
  });
  return { handled: "gmail_reply", messageId, result } as const;
}

export async function handleComposioPost(
  request: Request,
  deps: ComposioWebhookDeps = defaultDeps,
) {
  const raw = await request.text();
  const verified = verifyComposioSignature({
    rawBody: raw,
    signature: request.headers.get("webhook-signature"),
    webhookId: request.headers.get("webhook-id"),
    timestamp: request.headers.get("webhook-timestamp"),
  });
  if (!verified.ok) {
    return Response.json(
      { ok: false, code: "UNAUTHORIZED", reason: verified.reason },
      { status: 401 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = asObject(JSON.parse(raw));
  } catch {
    /* signed malformed events are recorded and safely acknowledged */
  }
  const metadata = asObject(body.metadata);
  const triggerSlug = text(
    metadata.trigger_slug,
    metadata.triggerSlug,
    body.type,
    "unknown",
  );
  const webhookId = request.headers.get("webhook-id")!;

  let receipt;
  try {
    receipt = await recordIntegrationReceipt({
      provider: "composio",
      externalEventId: webhookId,
      operation: `trigger.${triggerSlug}`,
      rawBody: raw,
      payload: {
        triggerSlug,
        userId: text(metadata.user_id, metadata.userId) || null,
        connectedAccountId:
          text(metadata.connected_account_id, metadata.connectedAccountId) ||
          null,
      },
      status: "processing",
      ownerEmployeeId: text(metadata.user_id, metadata.userId) || null,
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 200) : "receipt_failed";
    const conflict = reason === "INTEGRATION_RECEIPT_PAYLOAD_MISMATCH";
    return Response.json(
      {
        ok: false,
        code: conflict ? "EVENT_ID_CONFLICT" : "RECEIPT_UNAVAILABLE",
        reason,
      },
      { status: conflict ? 409 : 503 },
    );
  }

  let claimed = !receipt.duplicate;
  if (receipt.duplicate && receipt.status === "failed") {
    claimed = await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "failed", stateVersion: receipt.stateVersion },
      { status: "processing", result: { bridgeStatus: "processing" } },
    );
  }
  if (!claimed) {
    return Response.json({
      ok: true,
      received: true,
      duplicate: true,
      webhookId,
      triggerSlug,
      handled:
        typeof receipt.result?.handled === "string"
          ? receipt.result.handled
          : "acknowledged",
    });
  }

  try {
    const result = await handleTrigger(body, deps);
    await completeIntegrationReceipt(receipt.receiptId, result);
    await emitHealthSignal("composio_webhook", "info", {
      webhookId,
      triggerSlug,
      handled: result.handled,
    }).catch(() => undefined);
    await writeAudit({
      actorEmployeeId: text(metadata.user_id, metadata.userId) || null,
      action: `composio.webhook.${result.handled}`,
      entityType: "connection_account",
      entityId: null,
      before: null,
      after: { webhookId, triggerSlug, verified: verified.reason },
      reason: null,
    }).catch(() => undefined);
    return Response.json({
      ok: true,
      received: true,
      duplicate: false,
      webhookId,
      triggerSlug,
      ...result,
    });
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message.slice(0, 200)
        : "processing_failed";
    await failIntegrationReceipt(receipt.receiptId, reason).catch(
      () => undefined,
    );
    await emitHealthSignal("composio_webhook", "critical", {
      webhookId,
      triggerSlug,
      reason,
    }).catch(() => undefined);
    return Response.json(
      { ok: false, code: "PROCESSING_FAILED", reason },
      { status: 503 },
    );
  }
}

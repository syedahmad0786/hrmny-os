import { z } from "zod";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
} from "../integrations/inbox";
import { emitHealthSignal } from "../m1-persistence";
import {
  classifyGmailDeliveryNotice,
  ingestGmailDeliveryEvent,
  ingestGmailReply,
} from "../sales-os/replies";
import { listEmailEvents } from "../sales-os/store";
import {
  getGoogleWorkspaceAccessToken,
  listGoogleWorkspaceMonitorAccounts,
} from "../trpc/connections-router";

const messageListSchema = z.object({
  nextPageToken: z.string().optional(),
  messages: z
    .array(z.object({ id: z.string().min(1), threadId: z.string().optional() }))
    .optional(),
});

type GmailPart = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
};

const gmailPartSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z
      .array(z.object({ name: z.string(), value: z.string() }))
      .optional(),
    body: z.object({ data: z.string().optional() }).optional(),
    parts: z.array(gmailPartSchema).optional(),
  }),
);

const messageSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  payload: gmailPartSchema.optional(),
});

type MonitorDeps = {
  listAccounts: typeof listGoogleWorkspaceMonitorAccounts;
  getAccessToken: typeof getGoogleWorkspaceAccessToken;
  listEvents: typeof listEmailEvents;
  recordReceipt: typeof recordIntegrationReceipt;
  transitionReceipt: typeof transitionIntegrationReceiptProgress;
  completeReceipt: typeof completeIntegrationReceipt;
  failReceipt: typeof failIntegrationReceipt;
  ingestReply: (
    input: Parameters<typeof ingestGmailReply>[0],
  ) => Promise<unknown>;
  ingestDelivery: (
    input: Parameters<typeof ingestGmailDeliveryEvent>[0],
  ) => Promise<unknown>;
  health: (...args: Parameters<typeof emitHealthSignal>) => Promise<unknown>;
  fetchImpl: typeof fetch;
};

const defaultDeps: MonitorDeps = {
  listAccounts: listGoogleWorkspaceMonitorAccounts,
  getAccessToken: getGoogleWorkspaceAccessToken,
  listEvents: listEmailEvents,
  recordReceipt: recordIntegrationReceipt,
  transitionReceipt: transitionIntegrationReceiptProgress,
  completeReceipt: completeIntegrationReceipt,
  failReceipt: failIntegrationReceipt,
  ingestReply: ingestGmailReply,
  ingestDelivery: ingestGmailDeliveryEvent,
  health: emitHealthSignal,
  fetchImpl: fetch,
};

function decode(data: string | undefined): string {
  if (!data) return "";
  try {
    return Buffer.from(data, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function collectReadableParts(part: GmailPart | undefined): string[] {
  if (!part) return [];
  if (part.parts?.length) {
    return part.parts.flatMap(collectReadableParts);
  }
  const mime = part.mimeType?.toLowerCase() ?? "";
  const disposition = part.headers?.find(
    (candidate) => candidate.name.toLowerCase() === "content-disposition",
  )?.value;
  if (/attachment/i.test(disposition ?? "")) return [];
  if (
    mime &&
    !mime.startsWith("text/") &&
    mime !== "message/delivery-status" &&
    mime !== "message/rfc822"
  ) {
    return [];
  }
  const body = decode(part.body?.data);
  return body
    ? [mime === "text/html" ? body.replace(/<[^>]*>/g, " ") : body]
    : [];
}

export function messageBody(message: z.infer<typeof messageSchema>): string {
  return [message.snippet ?? "", ...collectReadableParts(message.payload)]
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 10_000);
}

function header(message: z.infer<typeof messageSchema>, name: string) {
  return message.payload?.headers?.find(
    (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
  )?.value;
}

function emailAddress(value: string | undefined): string | null {
  return (
    value
      ?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
      ?.toLowerCase() ?? null
  );
}

export async function listMessages(
  accessToken: string,
  query: string,
  fetchImpl: typeof fetch,
) {
  const params = new URLSearchParams({
    q: query,
    maxResults: "200",
    fields: "messages(id,threadId),nextPageToken",
  });
  const messages: Array<{ id: string; threadId?: string }> = [];
  const seenTokens = new Set<string>();
  // ponytail: bounded recovery sweep; refuse with a health error rather than silently truncating above 10,000.
  for (let page = 0; page < 50; page++) {
    const response = await fetchImpl(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) {
      throw new Error(`Gmail inbox list failed (${response.status})`);
    }
    const result = messageListSchema.parse(await response.json());
    messages.push(...(result.messages ?? []));
    if (!result.nextPageToken) return messages;
    if (seenTokens.has(result.nextPageToken))
      throw new Error("Gmail repeated a pagination token. Sync needs retry.");
    seenTokens.add(result.nextPageToken);
    params.set("pageToken", result.nextPageToken);
  }
  throw new Error(
    "Gmail recovery exceeded 10,000 messages. Narrow the recovery window before retrying.",
  );
}

export async function getMessage(
  accessToken: string,
  id: string,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
    {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) {
    throw new Error(`Gmail inbox read failed (${response.status})`);
  }
  return messageSchema.parse(await response.json());
}

/**
 * Read-only Gmail polling for mail sent through first-party Workspace OAuth.
 * Messages are never marked read; durable receipts make every tick idempotent.
 */
export async function runGoogleWorkspaceOutreachMonitor(
  deps: MonitorDeps = defaultDeps,
) {
  const [accounts, sentEvents] = await Promise.all([
    deps.listAccounts(),
    deps.listEvents({ kind: "sent" }),
  ]);
  const totals = {
    accounts: accounts.length,
    candidates: 0,
    processed: 0,
    replies: 0,
    deliveryNotices: 0,
    ignored: 0,
    duplicates: 0,
    errors: 0,
  };

  for (const account of accounts) {
    try {
      const accessToken = await deps.getAccessToken(account.ownerEmployeeId, {
        connectionAccountId: account.connectionAccountId,
        forInboundMonitor: true,
      });
      if (!accessToken) throw new Error("Google Workspace token unavailable");
      const accountSent = sentEvents.filter((event) => {
        const connectionId = event.payload.senderConnectionAccountId;
        return connectionId
          ? connectionId === account.connectionAccountId
          : event.payload.ownerEmployeeId === account.ownerEmployeeId;
      });
      const threadIds = new Set(
        accountSent.flatMap((event) =>
          typeof event.payload.threadId === "string"
            ? [event.payload.threadId]
            : [],
        ),
      );
      // Read every page in the recovery window; existing durable receipts deduplicate retries.
      const [inbox, notices] = await Promise.all([
        listMessages(
          accessToken,
          "newer_than:30d -in:sent -in:draft",
          deps.fetchImpl,
        ),
        listMessages(
          accessToken,
          "newer_than:30d -in:sent -in:draft {from:mailer-daemon from:postmaster from:feedbackloop from:abuse}",
          deps.fetchImpl,
        ),
      ]);
      const noticeIds = new Set(notices.map((message) => message.id));
      const candidates = new Map(
        [...inbox, ...notices]
          .filter(
            (message) =>
              noticeIds.has(message.id) ||
              Boolean(message.threadId && threadIds.has(message.threadId)),
          )
          .map((message) => [message.id, message]),
      );
      totals.candidates += candidates.size;

      for (const reference of candidates.values()) {
        const identity = JSON.stringify({
          connectionAccountId: account.connectionAccountId,
          messageId: reference.id,
          threadId: reference.threadId ?? null,
        });
        const receipt = await deps.recordReceipt({
          provider: "gmail",
          externalEventId: `gmail-inbound:${account.connectionAccountId}:${reference.id}`,
          operation: "messages.inbound",
          rawBody: identity,
          status: "processing",
          ownerEmployeeId: account.ownerEmployeeId,
          credentialConnectionAccountId: account.connectionAccountId,
          payload: {
            messageId: reference.id,
            threadId: reference.threadId ?? null,
          },
        });
        let claimed = !receipt.duplicate;
        if (receipt.duplicate && receipt.status === "failed") {
          claimed = await deps.transitionReceipt(
            receipt.receiptId,
            { status: "failed", stateVersion: receipt.stateVersion },
            { status: "processing", result: { bridgeStatus: "processing" } },
          );
        }
        if (!claimed) {
          totals.duplicates += 1;
          continue;
        }

        try {
          const message = await getMessage(
            accessToken,
            reference.id,
            deps.fetchImpl,
          );
          const labels = new Set(
            (message.labelIds ?? []).map((label) => label.toUpperCase()),
          );
          const fromEmail = emailAddress(header(message, "From"));
          const subject = header(message, "Subject")?.slice(0, 500);
          const rfcMessageId = header(message, "Message-ID")?.slice(0, 1_000);
          const body = messageBody(message);
          let handled = "ignored";
          if (
            !labels.has("SENT") &&
            !labels.has("DRAFT") &&
            fromEmail &&
            body
          ) {
            const deliveryKind = classifyGmailDeliveryNotice({
              from: fromEmail,
              subject,
              body,
            });
            if (deliveryKind) {
              await deps.ingestDelivery({
                kind: deliveryKind,
                fromEmail,
                subject,
                body,
                externalId: message.id,
                threadId: message.threadId,
                actorEmployeeId: account.ownerEmployeeId,
                senderConnectionAccountId: account.connectionAccountId,
              });
              handled = deliveryKind;
              totals.deliveryNotices += 1;
            } else if (message.threadId && threadIds.has(message.threadId)) {
              await deps.ingestReply({
                fromEmail,
                subject,
                body,
                externalId: message.id,
                threadId: message.threadId,
                rfcMessageId,
                actorEmployeeId: account.ownerEmployeeId,
                senderConnectionAccountId: account.connectionAccountId,
              });
              handled = "reply";
              totals.replies += 1;
            }
          }
          if (handled === "ignored") totals.ignored += 1;
          totals.processed += 1;
          await deps.completeReceipt(receipt.receiptId, {
            bridgeStatus: "completed",
            handled,
            messageId: message.id,
          });
        } catch (error) {
          totals.errors += 1;
          await deps
            .failReceipt(
              receipt.receiptId,
              error instanceof Error ? error.message : "Gmail inbound failed",
            )
            .catch(() => undefined);
        }
      }
    } catch {
      totals.errors += 1;
    }
  }

  if (totals.errors) {
    await deps
      .health("google_workspace_outreach_monitor", "warn", {
        failedOperations: totals.errors,
        accounts: totals.accounts,
      })
      .catch(() => undefined);
    throw new Error(
      `Google Workspace outreach monitor failed (${totals.errors})`,
    );
  }
  return totals;
}

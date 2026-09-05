import type { ComposioAdapter, ConnectionStatus } from "../types";
import { STUB_TOOLKITS } from "../types";
import type { ComposioLiveClient } from "./live";

export type ComposioSendInput = {
  toolkit: "gmail" | "linkedin";
  to: string;
  subject?: string;
  /** Provider-verified Gmail send-as address, selected by the operator. */
  fromEmail?: string;
  body: string;
  connectionId?: string;
  messageId?: string;
  /** Existing Gmail thread for an operator-approved reply. */
  threadId?: string;
  /** RFC 5322 Message-ID of the inbound message, when the webhook supplied it. */
  inReplyTo?: string;
};

export type ComposioSendResult = {
  sent: boolean;
  mode: "stub" | "copy_draft" | "live";
  externalId: string;
  threadId?: string;
  channel: "gmail" | "linkedin";
  providerAccepted: boolean;
  readbackAt?: string;
  readbackRecipient?: string;
};

export type GmailProviderReadback = {
  externalId: string;
  threadId?: string;
  labelIds: string[];
  recipient: string;
  readbackAt: string;
};

export class GmailProviderReadbackError extends Error {
  constructor(
    message: string,
    readonly externalId: string,
    readonly threadId?: string,
  ) {
    super(message);
    this.name = "GmailProviderReadbackError";
  }
}

type GmailMessageMetadata = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
  };
};

function headerValue(message: GmailMessageMetadata, name: string): string {
  return (
    message.payload?.headers?.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}

/** Verify the canonical Gmail copy instead of treating POST 200 as delivery. */
export function verifyGmailProviderReadback(input: {
  message: GmailMessageMetadata;
  externalId: string;
  recipient: string;
  expectedThreadId?: string;
  expectedFromEmail?: string;
}): GmailProviderReadback {
  const id = input.message.id?.trim() ?? "";
  const recipient = input.recipient.trim().toLowerCase();
  const to = headerValue(input.message, "to").toLowerCase();
  const labelIds =
    input.message.labelIds?.map((label) => label.toUpperCase()) ?? [];
  if (id !== input.externalId) {
    throw new GmailProviderReadbackError(
      "Gmail readback returned a different message id",
      input.externalId,
      input.message.threadId,
    );
  }
  if (!labelIds.includes("SENT")) {
    throw new GmailProviderReadbackError(
      "Gmail readback did not confirm the SENT mailbox label",
      input.externalId,
      input.message.threadId,
    );
  }
  if (!recipient || !to.includes(recipient)) {
    throw new GmailProviderReadbackError(
      "Gmail readback recipient does not match the approved recipient",
      input.externalId,
      input.message.threadId,
    );
  }
  if (
    input.expectedThreadId &&
    input.message.threadId?.trim() !== input.expectedThreadId.trim()
  ) {
    throw new GmailProviderReadbackError(
      "Gmail readback thread does not match the approved reply thread",
      input.externalId,
      input.message.threadId,
    );
  }
  const from = headerValue(input.message, "from").trim().toLowerCase();
  const fromAddress = (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  if (
    input.expectedFromEmail &&
    fromAddress !== input.expectedFromEmail.toLowerCase()
  )
    throw new GmailProviderReadbackError(
      "Gmail readback sender does not match the selected address",
      input.externalId,
      input.message.threadId,
    );
  return {
    externalId: id,
    threadId: input.message.threadId,
    labelIds,
    recipient,
    readbackAt: new Date().toISOString(),
  };
}

export interface ComposioSendAdapter extends ComposioAdapter {
  /** Send after HITL approve — never auto-fires without caller gate. */
  sendAfterApproval(input: ComposioSendInput): Promise<ComposioSendResult>;
  /** Read-only reconciliation of an already-created Gmail message. */
  readbackAfterSend(input: {
    externalId: string;
    recipient: string;
    connectionId?: string;
    expectedThreadId?: string;
    expectedFromEmail?: string;
  }): Promise<GmailProviderReadback>;
}

export function createComposioStub(): ComposioSendAdapter {
  let seq = 0;
  return {
    async listToolkits() {
      return [...STUB_TOOLKITS];
    },
    async startOAuth(toolkit, redirectUri) {
      return {
        redirectUrl: `${redirectUri}?stub=composio&toolkit=${encodeURIComponent(toolkit)}`,
      };
    },
    async disconnect() {
      /* no-op stub */
    },
    async status(
      _toolkit: string,
      _ownerId: string,
    ): Promise<ConnectionStatus> {
      return { connected: false, expiresAt: null };
    },
    async sendAfterApproval(input) {
      seq += 1;
      // LinkedIn falls back to copy-draft when no live connection (V1 HITL).
      if (input.toolkit === "linkedin") {
        return {
          sent: false,
          mode: "copy_draft",
          externalId: `stub-li-draft-${seq}`,
          channel: "linkedin",
          providerAccepted: false,
        };
      }
      // Gmail stub does NOT claim a real send — callers must not durable-mark
      // outreach as sent on mode=stub.
      return {
        sent: false,
        mode: "stub",
        externalId: `stub-gmail-${seq}`,
        channel: "gmail",
        providerAccepted: false,
      };
    },
    async readbackAfterSend() {
      throw new Error(
        "Gmail readback is unavailable without a live connection",
      );
    },
  };
}

function buildGmailRawMessage(input: {
  to: string;
  subject?: string;
  body: string;
  messageId?: string;
  inReplyTo?: string;
}): string {
  const subject = (input.subject ?? "(no subject)")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  const encodedSubject = Buffer.from(subject, "utf8").toString("base64");
  const inReplyTo = input.inReplyTo?.replace(/[\r\n]+/g, "").trim();
  const message = [
    `To: ${input.to.trim()}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    ...(input.messageId
      ? [`Message-ID: ${input.messageId.replace(/[\r\n]+/g, "")}`]
      : []),
    ...(inReplyTo
      ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`]
      : []),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.body,
  ].join("\r\n");
  return Buffer.from(message, "utf8").toString("base64url");
}

/**
 * Live HITL send: Gmail via Composio proxy → Gmail API.
 * LinkedIn stays copy-draft. Proxy failures fail loud — never stub-fallback
 * a "sent" that did not actually leave Composio/Gmail.
 */
export function createComposioLiveSend(opts: {
  client: Pick<ComposioLiveClient, "proxy">;
  connectedAccountId: string;
  fallback?: ComposioSendAdapter;
}): ComposioSendAdapter {
  const fallback = opts.fallback ?? createComposioStub();
  let seq = 0;
  return {
    async listToolkits() {
      return [...STUB_TOOLKITS];
    },
    async startOAuth(toolkit, redirectUri) {
      return fallback.startOAuth(toolkit, redirectUri);
    },
    async disconnect(connectionId) {
      return fallback.disconnect(connectionId);
    },
    async status(toolkit: string, ownerId: string): Promise<ConnectionStatus> {
      if (toolkit === "gmail") {
        return { connected: true, expiresAt: null };
      }
      return fallback.status(toolkit, ownerId);
    },
    async sendAfterApproval(input): Promise<ComposioSendResult> {
      seq += 1;
      if (input.toolkit === "linkedin") {
        return {
          sent: false,
          mode: "copy_draft",
          externalId: `live-li-draft-${seq}`,
          channel: "linkedin",
          providerAccepted: false,
        };
      }

      const raw = buildGmailRawMessage(input);
      const result = await opts.client.proxy<{
        id?: string;
        threadId?: string;
      }>({
        connectedAccountId:
          input.connectionId?.trim() || opts.connectedAccountId,
        endpoint: "/gmail/v1/users/me/messages/send",
        method: "POST",
        body: { raw, ...(input.threadId ? { threadId: input.threadId } : {}) },
      });
      const externalId =
        typeof result.data?.id === "string" ? result.data.id.trim() : "";
      if (!externalId) {
        throw new Error("Gmail send returned no provider message id");
      }
      let readback: GmailProviderReadback;
      try {
        readback = await this.readbackAfterSend({
          externalId,
          recipient: input.to,
          connectionId: input.connectionId,
          expectedThreadId: input.threadId,
        });
      } catch (error) {
        if (error instanceof GmailProviderReadbackError) throw error;
        throw new GmailProviderReadbackError(
          error instanceof Error ? error.message : "Gmail readback failed",
          externalId,
          typeof result.data?.threadId === "string"
            ? result.data.threadId
            : undefined,
        );
      }
      return {
        sent: true,
        mode: "live",
        externalId,
        threadId: readback.threadId,
        channel: "gmail",
        providerAccepted: true,
        readbackAt: readback.readbackAt,
        readbackRecipient: readback.recipient,
      };
    },
    async readbackAfterSend(input): Promise<GmailProviderReadback> {
      const result = await opts.client.proxy<GmailMessageMetadata>({
        connectedAccountId:
          input.connectionId?.trim() || opts.connectedAccountId,
        endpoint: `/gmail/v1/users/me/messages/${encodeURIComponent(input.externalId)}`,
        method: "GET",
        parameters: [
          { name: "format", value: "metadata", in: "query" },
          { name: "metadataHeaders", value: "To", in: "query" },
        ],
      });
      return verifyGmailProviderReadback({
        message: result.data,
        externalId: input.externalId,
        recipient: input.recipient,
        expectedThreadId: input.expectedThreadId,
      });
    },
  };
}

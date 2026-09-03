import type { ComposioAdapter, ConnectionStatus } from "../types";
import { STUB_TOOLKITS } from "../types";
import type { ComposioLiveClient } from "./live";

export type ComposioSendInput = {
  toolkit: "gmail" | "linkedin";
  to: string;
  subject?: string;
  body: string;
  connectionId?: string;
  messageId?: string;
};

export type ComposioSendResult = {
  sent: boolean;
  mode: "stub" | "copy_draft" | "live";
  externalId: string;
  threadId?: string;
  channel: "gmail" | "linkedin";
};

export interface ComposioSendAdapter extends ComposioAdapter {
  /** Send after HITL approve — never auto-fires without caller gate. */
  sendAfterApproval(input: ComposioSendInput): Promise<ComposioSendResult>;
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
        };
      }
      // Gmail stub does NOT claim a real send — callers must not durable-mark
      // outreach as sent on mode=stub.
      return {
        sent: false,
        mode: "stub",
        externalId: `stub-gmail-${seq}`,
        channel: "gmail",
      };
    },
  };
}

function buildGmailRawMessage(input: {
  to: string;
  subject?: string;
  body: string;
  messageId?: string;
}): string {
  const subject = (input.subject ?? "(no subject)")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 200);
  const encodedSubject = Buffer.from(subject, "utf8").toString("base64");
  const message = [
    `To: ${input.to.trim()}`,
    `Subject: =?UTF-8?B?${encodedSubject}?=`,
    ...(input.messageId
      ? [`Message-ID: ${input.messageId.replace(/[\r\n]+/g, "")}`]
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
        body: { raw },
      });
      const externalId =
        typeof result.data?.id === "string" ? result.data.id.trim() : "";
      if (!externalId) {
        throw new Error("Gmail send returned no provider message id");
      }
      return {
        sent: true,
        mode: "live",
        externalId,
        threadId:
          typeof result.data?.threadId === "string"
            ? result.data.threadId
            : undefined,
        channel: "gmail",
      };
    },
  };
}

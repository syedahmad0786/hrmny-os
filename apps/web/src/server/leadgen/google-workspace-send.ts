import type {
  ComposioSendAdapter,
  GmailProviderReadback,
} from "@hrmny/integrations";
import {
  createComposioStub,
  GmailProviderReadbackError,
  verifyGmailProviderReadback,
} from "@hrmny/integrations";
import { getGoogleWorkspaceAccessToken } from "../trpc/connections-router";
import { formatGoogleWorkspaceGmailError } from "@/lib/google-workspace-error";

/**
 * HITL Gmail send via staff Google Workspace OAuth (gmail.send scope).
 * Used when Composio Gmail work-app is not connected.
 */
export function createGoogleWorkspaceGmailSend(
  employeeId: string,
  options?: {
    connectionAccountId?: string;
    roles?: readonly string[];
  },
): ComposioSendAdapter {
  const stub = createComposioStub();
  return {
    listToolkits: stub.listToolkits.bind(stub),
    startOAuth: stub.startOAuth.bind(stub),
    disconnect: stub.disconnect.bind(stub),
    status: async () => ({ connected: true, expiresAt: null }),
    async sendAfterApproval(input) {
      if (input.toolkit === "linkedin") {
        return stub.sendAfterApproval(input);
      }
      const accessToken = await getGoogleWorkspaceAccessToken(
        employeeId,
        options,
      );
      if (!accessToken) {
        return stub.sendAfterApproval(input);
      }
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
      const response = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            raw: Buffer.from(message, "utf8").toString("base64url"),
            ...(input.threadId ? { threadId: input.threadId } : {}),
          }),
        },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          formatGoogleWorkspaceGmailError(response.status, detail),
        );
      }
      const json = (await response.json()) as {
        id?: string;
        threadId?: string;
      };
      const externalId = typeof json.id === "string" ? json.id.trim() : "";
      if (!externalId) {
        throw new Error("Google Workspace Gmail send returned no message id");
      }
      let readback: GmailProviderReadback;
      try {
        readback = await this.readbackAfterSend({
          externalId,
          recipient: input.to,
        });
      } catch (error) {
        if (error instanceof GmailProviderReadbackError) throw error;
        throw new GmailProviderReadbackError(
          error instanceof Error ? error.message : "Gmail readback failed",
          externalId,
          json.threadId,
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
    async readbackAfterSend(input) {
      const accessToken = await getGoogleWorkspaceAccessToken(
        employeeId,
        options,
      );
      if (!accessToken) {
        throw new Error("Google Workspace connection is unavailable");
      }
      const params = new URLSearchParams({ format: "metadata" });
      params.append("metadataHeaders", "To");
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.externalId)}?${params}`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new GmailProviderReadbackError(
          formatGoogleWorkspaceGmailError(response.status, detail),
          input.externalId,
        );
      }
      return verifyGmailProviderReadback({
        message: (await response.json()) as Parameters<
          typeof verifyGmailProviderReadback
        >[0]["message"],
        externalId: input.externalId,
        recipient: input.recipient,
      });
    },
  };
}

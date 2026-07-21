import type { ComposioAdapter, ConnectionStatus } from "../types";
import { STUB_TOOLKITS } from "../types";

export type ComposioSendInput = {
  toolkit: "gmail" | "linkedin";
  to: string;
  subject?: string;
  body: string;
  connectionId?: string;
};

export type ComposioSendResult = {
  sent: boolean;
  mode: "stub" | "copy_draft";
  externalId: string;
  channel: "gmail" | "linkedin";
};

export interface ComposioSendAdapter extends ComposioAdapter {
  /** Stub send after HITL approve — never auto-fires without caller gate. */
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
    async status(_toolkit: string, _ownerId: string): Promise<ConnectionStatus> {
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
      return {
        sent: true,
        mode: "stub",
        externalId: `stub-gmail-${seq}`,
        channel: "gmail",
      };
    },
  };
}

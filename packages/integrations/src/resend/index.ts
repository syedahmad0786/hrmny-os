import { IntegrationMisconfiguredError } from "../types";

/**
 * Transactional email delivery (Resend-shaped) for the report scheduler. Mock
 * by default — records every send in-memory so the scheduler is provable in CI
 * with no key; live POSTs to Resend and fails loud when RESEND_API_KEY is
 * absent, exactly like the hunter / apollo adapters. This is the scheduler's
 * OWN seam and is deliberately NOT in the frozen contracts.ts: reports send
 * transactional email, they never publish or spend, so the "AI proposes, the
 * gate disposes" rule that governs contracts.ts does not apply here.
 */

export type EmailSendInput = {
  to: string[];
  subject: string;
  /** Rendered report body (markdown); sent as text/plain to the provider. */
  markdown: string;
  from?: string;
};

export type EmailSendResult = {
  mode: "mock" | "live";
  /** Provider message id (live) or a synthetic id (mock). */
  id: string;
  to: string[];
  subject: string;
};

export interface EmailSendAdapter {
  readonly mode: "mock" | "live";
  send(input: EmailSendInput): Promise<EmailSendResult>;
  /** Mock only: sends recorded so far so tests can assert delivery. Live → []. */
  recorded(): EmailSendResult[];
}

export type ResendConfig = {
  mode?: "mock" | "live";
  apiKey?: string;
  /** Default From when the caller omits one. */
  from?: string;
};

function resolveMode(config: ResendConfig): "mock" | "live" {
  if (config.mode) return config.mode;
  return process.env.RESEND_MODE?.toLowerCase() === "live" ? "live" : "mock";
}

function assertRecipients(input: EmailSendInput): void {
  if (input.to.length === 0) {
    throw new Error("resend: refusing to send with no recipients");
  }
}

function resolveLiveFrom(config: ResendConfig): string {
  const from = (config.from ?? process.env.RESEND_FROM)?.trim();
  if (!from) {
    throw new IntegrationMisconfiguredError(
      "resend",
      "RESEND_MODE=live but RESEND_FROM missing — set a verified sender (e.g. hrmny OS <noreply@yourdomain.com>)",
    );
  }
  return from;
}

/** Mock — never sends; records each call so tests/CI can assert delivery. */
export function createResendMock(): EmailSendAdapter {
  const sends: EmailSendResult[] = [];
  return {
    mode: "mock",
    async send(input) {
      assertRecipients(input);
      const result: EmailSendResult = {
        mode: "mock",
        id: `mock-${sends.length + 1}`,
        to: input.to,
        subject: input.subject,
      };
      sends.push(result);
      return result;
    },
    recorded() {
      return sends;
    },
  };
}

/** Live Resend — POST /emails. Fails loud without RESEND_API_KEY + RESEND_FROM. */
export function createResendLive(config: ResendConfig = {}): EmailSendAdapter {
  const apiKey = config.apiKey ?? process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new IntegrationMisconfiguredError(
      "resend",
      "RESEND_MODE=live but RESEND_API_KEY missing — fail loud",
    );
  }
  const from = resolveLiveFrom(config);
  return {
    mode: "live",
    async send(input) {
      assertRecipients(input);
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: input.from ?? from,
          to: input.to,
          subject: input.subject,
          text: input.markdown,
        }),
      });
      if (!res.ok) {
        throw new IntegrationMisconfiguredError(
          "resend",
          `Send failed: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { id?: string };
      return {
        mode: "live",
        id: String(data.id ?? "resend-unknown"),
        to: input.to,
        subject: input.subject,
      };
    },
    recorded() {
      return [];
    },
  };
}

export function createResendAdapter(
  config: ResendConfig = {},
): EmailSendAdapter {
  return resolveMode(config) === "live"
    ? createResendLive(config)
    : createResendMock();
}

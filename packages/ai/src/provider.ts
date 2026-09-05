import type { ZodTypeAny } from "zod";
import { mockExtractInvoice, InvoiceProposeSchema } from "./invoice-extract";

export type LLMProviderName = "openrouter" | "anthropic" | "ollama" | "mock";

/**
 * Default OpenRouter free route for demos / agent tests.
 * Prefer content-bearing free models; `openrouter/free` may resolve to
 * reasoning-only upstreams (rejected so internal reasoning is never an answer).
 */
export const OPENROUTER_FREE_DEFAULT_MODEL = "stealth/ox-alpha";

/**
 * Free preview routes ($0/$0 on OpenRouter) without a `:free` suffix.
 * Keep this list tight — never add paid catalog models here.
 */
export const OPENROUTER_FREE_PREVIEW_MODELS = ["stealth/ox-alpha"] as const;

/** True when OpenRouter lists the route as free (:free suffix, openrouter/free, or preview allowlist). */
export function isOpenRouterFreeRoute(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return false;
  if (m === "openrouter/free") return true;
  if (m.endsWith(":free")) return true;
  return OPENROUTER_FREE_PREVIEW_MODELS.some((p) => p.toLowerCase() === m);
}

/** Refuse paid OpenRouter models — demos and CI must stay on free routes only. */
export function assertOpenRouterFreeRoute(model: string): void {
  if (!isOpenRouterFreeRoute(model)) {
    throw new Error(
      `OpenRouter model "${model}" is not on the free allowlist (:free, openrouter/free, stealth/ox-alpha).`,
    );
  }
}

/** Ordered free-route failover when the primary free/default model flakes (429/empty). */
export const OPENROUTER_FREE_FALLBACK_MODELS = [
  OPENROUTER_FREE_DEFAULT_MODEL,
  "liquid/lfm-2.5-2.6b:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openrouter/free",
] as const;

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMImageInput = {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  dataBase64: string;
};

export type LLMGenerateOptions = {
  model?: string;
  messages: LLMMessage[];
  schema?: ZodTypeAny;
  temperature?: number;
  images?: LLMImageInput[];
  /** OpenRouter live web grounding, hard-capped to two searches. */
  webSearch?: boolean;
  /** Confidential employee or client context requires private provider routing. */
  privateContext?: boolean;
  /** Optional task hint for mock structured outputs. */
  task?: "invoice_extract" | "outreach_draft" | "reply_intent" | "generic";
};

export type LLMGenerateResult = {
  text: string;
  /** Present when schema was provided and parsing succeeded. */
  object?: unknown;
  provider: LLMProviderName;
  model: string;
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  sourceCitations?: Array<{ url: string; title?: string }>;
  webSearchRequests?: number;
};

/**
 * Provider abstraction — OpenRouter / Anthropic / Ollama / mock.
 * Cloud DB remains source of truth; LLM never auto-sends (HITL).
 */
export interface LLMProvider {
  readonly name: LLMProviderName;
  generate(options: LLMGenerateOptions): Promise<LLMGenerateResult>;
}

export type CreateProviderConfig = {
  provider?: LLMProviderName;
  openRouterApiKey?: string;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  defaultModel?: string;
};

export function resolveEffectiveLlmProvider(
  config: CreateProviderConfig = {},
): LLMProviderName {
  return resolveName(config);
}

export function resolveDefaultLlmModel(
  provider?: LLMProviderName,
  config: CreateProviderConfig = {},
): string {
  const name = provider ?? resolveEffectiveLlmProvider(config);
  const fromEnv = process.env.LLM_DEFAULT_MODEL?.trim();
  if (fromEnv) return fromEnv;
  if (name === "openrouter") return OPENROUTER_FREE_DEFAULT_MODEL;
  if (name === "mock") return "mock";
  return "unknown";
}

/** No secrets — shared by /api/ready and staff UIs. */
export function runtimeLlmSnapshot(config: CreateProviderConfig = {}): {
  provider: LLMProviderName;
  defaultModel: string;
  openRouterConfigured: boolean;
  freeOnly: boolean;
} {
  const provider = resolveEffectiveLlmProvider(config);
  const defaultModel = resolveDefaultLlmModel(provider, config);
  const openRouterConfigured = Boolean(process.env.OPENROUTER_API_KEY?.trim());
  const freeOnly = provider === "openrouter";
  return { provider, defaultModel, openRouterConfigured, freeOnly };
}

function resolveName(config: CreateProviderConfig): LLMProviderName {
  const fromEnv = process.env.LLM_PROVIDER?.toLowerCase() as
    LLMProviderName | undefined;
  const name = config.provider ?? fromEnv ?? "mock";
  if (
    name === "openrouter" &&
    !config.openRouterApiKey &&
    !process.env.OPENROUTER_API_KEY
  ) {
    return "mock";
  }
  if (
    name === "anthropic" &&
    !config.anthropicApiKey &&
    !process.env.ANTHROPIC_API_KEY
  ) {
    return "mock";
  }
  return name;
}

function extractUserText(messages: LLMMessage[]): string {
  return messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n");
}

function lastUserIndex(messages: LLMMessage[]) {
  for (let index = messages.length - 1; index >= 0; index--)
    if (messages[index]?.role === "user") return index;
  return -1;
}

function openRouterMessages(options: LLMGenerateOptions) {
  const index = lastUserIndex(options.messages);
  return options.messages.map((message, messageIndex) =>
    messageIndex === index && options.images?.length
      ? {
          ...message,
          content: [
            { type: "text", text: message.content },
            ...options.images.map((image) => ({
              type: "image_url",
              image_url: {
                url: `data:${image.mediaType};base64,${image.dataBase64}`,
              },
            })),
          ],
        }
      : message,
  );
}

function parseStructuredText(schema: ZodTypeAny, text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const candidates = [trimmed];

  for (let start = 0; start < trimmed.length; start++) {
    const opening = trimmed[start];
    if (opening !== "{" && opening !== "[") continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index++) {
      const char = trimmed[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "{" || char === "[") stack.push(char);
      else if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";
        if (stack.pop() !== expected) break;
        if (stack.length === 0) {
          candidates.push(trimmed.slice(start, index + 1));
          break;
        }
      }
    }
  }

  let lastError: unknown;
  for (const candidate of new Set(candidates)) {
    try {
      return schema.parse(JSON.parse(candidate));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("LLM provider returned invalid structured output");
}

function anthropicMessages(options: LLMGenerateOptions) {
  const messages = options.messages.filter(
    (message) => message.role !== "system",
  );
  const index = lastUserIndex(messages);
  return messages.map((message, messageIndex) =>
    messageIndex === index && options.images?.length
      ? {
          ...message,
          content: [
            { type: "text", text: message.content },
            ...options.images.map((image) => ({
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.dataBase64,
              },
            })),
          ],
        }
      : message,
  );
}

function ollamaMessages(options: LLMGenerateOptions) {
  const index = lastUserIndex(options.messages);
  return options.messages.map((message, messageIndex) => ({
    ...message,
    ...(messageIndex === index && options.images?.length
      ? { images: options.images.map((image) => image.dataBase64) }
      : {}),
  }));
}

/** Mock provider returns structured invoice propose payloads for HITL demos. */
export function createMockProvider(
  defaultModel = "mock-invoice-extract",
): LLMProvider {
  return {
    name: "mock",
    async generate(options) {
      if (options.privateContext && options.webSearch)
        throw new Error("Private context cannot be sent to public web search");
      const userText = extractUserText(options.messages);
      const emailRefMatch = userText.match(/emailRef[:=]\s*(\S+)/i);
      const emailRef = emailRefMatch?.[1] ?? "demo-email-ref";
      const task = options.task ?? "invoice_extract";

      if (
        task === "invoice_extract" ||
        options.schema === InvoiceProposeSchema
      ) {
        const object = mockExtractInvoice(emailRef, userText);
        return {
          text: JSON.stringify(object),
          object,
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      if (task === "outreach_draft") {
        const object = mockOutreachDraft(userText);
        return {
          text: JSON.stringify(object),
          object,
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      if (task === "reply_intent") {
        const object = mockReplyIntent(userText);
        return {
          text: JSON.stringify(object),
          object,
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      // ReAct demos without OpenRouter: emit funnel_act when the harness
      // catalog exposes it and the user asks to advance client funnel drafts.
      const blob = options.messages.map((m) => m.content).join("\n");
      const catalogHasFunnel = /(?:^|\n)-\s*funnel_act\s*:/i.test(blob);
      const sawFunnelObservation = /Observation from funnel_act/i.test(blob);
      const wantsFunnel =
        /funnel drafts|advance(?:\s+\w+){0,4}\s+funnel|portal invite|brief.*campaign|campaign.*brief/i.test(
          userText,
        );
      if (catalogHasFunnel && wantsFunnel && !sawFunnelObservation) {
        const prompt =
          userText.trim().slice(0, 400) ||
          "Advance this client’s funnel drafts (brief, campaign, portal invite)";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: "funnel_act",
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawFunnelObservation) {
        return {
          text:
            "Advanced the client funnel: drafted tasks/briefs/campaigns, " +
            "queued a portal invite, and sent creative into portal review.",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      // Custom agent allowlist runner (chat agent_act).
      const catalogHasAgentAct = /(?:^|\n)-\s*agent_act\s*:/i.test(blob);
      const sawAgentActObservation = /Observation from agent_act/i.test(blob);
      if (catalogHasAgentAct && !sawAgentActObservation) {
        const prompt = userText.trim().slice(0, 400) || "Run agent tools";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: "agent_act",
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawAgentActObservation) {
        return {
          text: "Ran the selected agent's allowlisted tools in the current sandbox and summarized the results.",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      // Staff closed-loop demo without OpenRouter when catalog lists the tool.
      const catalogHasClosedLoop =
        /(?:^|\n)-\s*(?:crm\.closed_loop|crm\.runDemoClosedLoop|funnel\.closed_loop|crm_closed_loop)\s*:/i.test(
          blob,
        );
      const sawClosedLoopObservation =
        /Observation from (?:crm\.closed_loop|crm\.runDemoClosedLoop|funnel\.closed_loop|crm_closed_loop)/i.test(
          blob,
        );
      const wantsClosedLoop =
        /closed\s*loop|won\s*handover|prospect\s*(?:→|->|to)\s*won/i.test(
          userText,
        );
      if (
        catalogHasClosedLoop &&
        wantsClosedLoop &&
        !sawClosedLoopObservation
      ) {
        const prompt = userText.trim().slice(0, 400) || "Run demo closed loop";
        const toolName = /(?:^|\n)-\s*crm_closed_loop\s*:/i.test(blob)
          ? "crm_closed_loop"
          : "crm.closed_loop";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawClosedLoopObservation) {
        return {
          text:
            "Completed the CRM closed loop: prospected, marked won, " +
            "emitted handover, and started client onboarding.",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      // OS finance approve / issue when catalog lists the tools.
      const catalogHasFinanceApprove =
        /(?:^|\n)-\s*(?:finance\.os_approve|finance_os_approve|invoices\.approve)\s*:/i.test(
          blob,
        );
      const catalogHasFinanceIssue =
        /(?:^|\n)-\s*(?:finance\.os_issue|finance_os_issue|invoices\.issue)\s*:/i.test(
          blob,
        );
      const sawFinanceApproveObs =
        /Observation from (?:finance\.os_approve|finance_os_approve)/i.test(
          blob,
        );
      const sawFinanceIssueObs =
        /Observation from (?:finance\.os_issue|finance_os_issue)/i.test(blob);
      const wantsApprove =
        /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?invoice|invoice[^\n]{0,40}approv)/i.test(
          userText,
        );
      const wantsIssue =
        /(?:os[_\s-]?issue|issue\s+(?:the\s+)?(?:os\s+)?invoice|invoice[^\n]{0,40}issue|mark\s+issued)/i.test(
          userText,
        );
      if (catalogHasFinanceApprove && wantsApprove && !sawFinanceApproveObs) {
        const prompt = userText.trim().slice(0, 400) || "Approve OS invoice";
        const toolName = /(?:^|\n)-\s*finance_os_approve\s*:/i.test(blob)
          ? "finance_os_approve"
          : "finance.os_approve";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawFinanceApproveObs && !wantsIssue) {
        return {
          text: "Approved the OS invoice — ready to issue when finance confirms.",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (catalogHasFinanceIssue && wantsIssue && !sawFinanceIssueObs) {
        const prompt = userText.trim().slice(0, 400) || "Issue OS invoice";
        const toolName = /(?:^|\n)-\s*finance_os_issue\s*:/i.test(blob)
          ? "finance_os_issue"
          : "finance.os_issue";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawFinanceIssueObs) {
        return {
          text: "Issued the OS invoice (OS-only when Xero write is disabled).",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      const catalogHasOutreachApprove =
        /(?:^|\n)-\s*(?:outreach\.os_approve|outreach_os_approve|leadgen\.approve)\s*:/i.test(
          blob,
        );
      const sawOutreachApproveObs =
        /Observation from (?:outreach\.os_approve|outreach_os_approve)/i.test(
          blob,
        );
      const wantsOutreachApprove =
        /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?outreach|outreach[^\n]{0,40}approv|approve\s+hitl)/i.test(
          userText,
        );
      if (
        catalogHasOutreachApprove &&
        wantsOutreachApprove &&
        !sawOutreachApproveObs
      ) {
        const prompt = userText.trim().slice(0, 400) || "Approve OS outreach";
        const toolName = /(?:^|\n)-\s*outreach_os_approve\s*:/i.test(blob)
          ? "outreach_os_approve"
          : "outreach.os_approve";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawOutreachApproveObs) {
        return {
          text: "Approved the outreach draft — ready for human send (HITL).",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      const catalogHasCreativeQc =
        /(?:^|\n)-\s*(?:creative\.os_qc|creative_os_qc|tasks\.qc)\s*:/i.test(
          blob,
        );
      const sawCreativeQcObs =
        /Observation from (?:creative\.os_qc|creative_os_qc)/i.test(blob);
      const wantsCreativeQc =
        /(?:pass\s+(?:qc|quality)|qc\s+pass|creative\s+qc|os[_\s-]?qc|waive\s+qc|fail\s+qc)/i.test(
          userText,
        );
      if (catalogHasCreativeQc && wantsCreativeQc && !sawCreativeQcObs) {
        const prompt =
          userText.trim().slice(0, 400) || "Pass QC on creative task";
        const toolName = /(?:^|\n)-\s*creative_os_qc\s*:/i.test(blob)
          ? "creative_os_qc"
          : "creative.os_qc";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawCreativeQcObs) {
        return {
          text: "Recorded creative QC on the delivery task.",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      const catalogHasCampaignApprove =
        /(?:^|\n)-\s*(?:campaigns\.os_approve|campaigns_os_approve)\s*:/i.test(
          blob,
        );
      const catalogHasCampaignPublish =
        /(?:^|\n)-\s*(?:campaigns\.os_publish|campaigns_os_publish)\s*:/i.test(
          blob,
        );
      const sawCampaignApproveObs =
        /Observation from (?:campaigns\.os_approve|campaigns_os_approve)/i.test(
          blob,
        );
      const sawCampaignPublishObs =
        /Observation from (?:campaigns\.os_publish|campaigns_os_publish)/i.test(
          blob,
        );
      const wantsCampaignApprove =
        /(?:os[_\s-]?approve|approve\s+(?:the\s+)?(?:os\s+)?campaign|campaign[^\n]{0,40}approv)/i.test(
          userText,
        );
      const wantsCampaignPublish =
        /(?:os[_\s-]?publish|publish\s+(?:the\s+)?(?:os\s+)?campaign|campaign[^\n]{0,40}publish|stub\s+publish)/i.test(
          userText,
        );
      if (
        catalogHasCampaignApprove &&
        wantsCampaignApprove &&
        !sawCampaignApproveObs
      ) {
        const prompt = userText.trim().slice(0, 400) || "Approve OS campaign";
        const toolName = /(?:^|\n)-\s*campaigns_os_approve\s*:/i.test(blob)
          ? "campaigns_os_approve"
          : "campaigns.os_approve";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawCampaignApproveObs && !wantsCampaignPublish) {
        return {
          text: "Approved the campaign draft — ready to publish (stub or live).",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (
        catalogHasCampaignPublish &&
        wantsCampaignPublish &&
        !sawCampaignPublishObs
      ) {
        const prompt =
          userText.trim().slice(0, 400) || "Publish OS campaign stub";
        const toolName = /(?:^|\n)-\s*campaigns_os_publish\s*:/i.test(blob)
          ? "campaigns_os_publish"
          : "campaigns.os_publish";
        return {
          text: [
            "```tool",
            JSON.stringify({
              name: toolName,
              arguments: { prompt },
            }),
            "```",
          ].join("\n"),
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }
      if (sawCampaignPublishObs) {
        return {
          text: "Published the campaign in OS (stub mode when LinkedIn is unconnected).",
          provider: "mock",
          model: options.model ?? defaultModel,
        };
      }

      return {
        text: `[mock:${options.model ?? defaultModel}] stub response`,
        provider: "mock",
        model: options.model ?? defaultModel,
      };
    },
  };
}

function field(userText: string, key: string): string | undefined {
  return userText
    .match(new RegExp(`${key}[:=]\\s*([^\\n]+)`, "i"))?.[1]
    ?.trim();
}

/** Deterministic review-only draft for mock/eval and live-provider fallback. */
export function mockOutreachDraft(userText: string) {
  const firstName = field(userText, "firstName") ?? "there";
  const company = field(userText, "company") ?? "your team";
  const channel = field(userText, "channel")?.toLowerCase();
  const followup = /follow-up touch\s+\d+/i.test(userText);
  if (channel === "linkedin_connect") {
    return {
      channel,
      subject: "LinkedIn connection",
      body: `Hi ${firstName} — I’ve been following ${company} and would be glad to connect from hrmny here in the UAE.`,
      cta: "Connect",
    };
  }
  if (channel === "linkedin_followup") {
    return {
      channel,
      subject: "LinkedIn follow-up",
      body: `Hi ${firstName}, thanks for connecting. hrmny helps UAE teams turn brand priorities into focused campaigns and production-ready creative. I would be glad to prepare two practical ideas for ${company}. Would a concise one-page direction be useful?`,
      cta: "Open to a short call next week?",
    };
  }
  return {
    channel: "email" as const,
    subject: followup ? `Re: An idea for ${company}` : `An idea for ${company}`,
    body: followup
      ? `Hi ${firstName},\n\nJust following up with a more concrete next step. hrmny can turn one current priority at ${company} into a one-page creative direction covering the campaign idea, key message, and first production assets, so your team can judge the value before committing time to a call.\n\nIf that would help, I can send the outline for review. Should I prepare it?`
      : `Hi ${firstName},\n\nI’m reaching out from hrmny, a UAE creative agency. I’ve been looking at ${company} and see an opportunity to turn one of the team’s current brand priorities into a focused campaign idea and production-ready creative, without adding unnecessary review overhead.\n\nOur work spans branding, campaigns, content production, activations, PR, and social. We can prepare a concise one-page direction with two practical concepts tailored to ${company}, giving your team something concrete to react to before any call or commitment.\n\nWould it be useful if I sent that over?`,
    cta: followup
      ? "Should I prepare the one-page outline?"
      : "Would it be useful if I sent that over?",
  };
}

function assertReviewSafeOutreachDraft(object: unknown): void {
  if (!object || typeof object !== "object") return;
  const value = object as Record<string, unknown>;
  const copy = [value.subject, value.body]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  if (
    /\b\d+(?:[.,]\d+)?\s*(?:%|percent\b|x\b|times\b)|(?:AED|USD|EUR|GBP|\$|€|£)\s*\d|\b\d+(?:[.,]\d+)?\s*(?:AED|USD|EUR|GBP)\b/i.test(
      copy,
    ) ||
    /\b(?:we|hrmny|our (?:team|work|campaigns?))\s+(?:have\s+)?(?:helped|increased|grew|boosted|drove|delivered|achieved|generated|improved|lifted|reduced)\b|\b(?:case stud(?:y|ies)|award[- ]winning|trusted by|our clients include|we work(?:ed)? with)\b/i.test(
      copy,
    )
  ) {
    throw new Error(
      "Outreach draft contained unsupported performance proof; use the review-only fallback",
    );
  }
}

// Values match the frozen ReplyIntentSchema in agent-io.ts (M7 contract).
const REPLY_INTENT_RULES: Array<[RegExp, string]> = [
  [/unsubscribe|opt\s?out|remove me|stop emailing|take me off/i, "unsubscribe"],
  [
    /not interested|no thanks|no thank you|we'?ll pass|not a fit|already have|maybe later|not right now/i,
    "not_now",
  ],
  [
    /interested|sounds good|let'?s (talk|chat|connect)|book|schedule|demo|call me|keen|works for me/i,
    "interested",
  ],
  [
    /\?|how much|pricing|what.*cost|when can|could you|can you|tell me more/i,
    "question",
  ],
];

/** Keyword classifier for mock/eval. ponytail: heuristic map, swap for the live model in prod. */
export function mockReplyIntent(userText: string) {
  const match = REPLY_INTENT_RULES.find(([pattern]) => pattern.test(userText));
  return { intent: match?.[1] ?? "other", confidence: match ? 0.8 : 0.4 };
}

export function createProvider(config: CreateProviderConfig = {}): LLMProvider {
  const name = resolveName(config);
  if (name === "mock") return createMockProvider(config.defaultModel);

  const model =
    config.defaultModel ??
    process.env.LLM_DEFAULT_MODEL ??
    (name === "openrouter" ? OPENROUTER_FREE_DEFAULT_MODEL : undefined);
  const parseResult = (
    options: LLMGenerateOptions,
    result: Omit<LLMGenerateResult, "object">,
  ): LLMGenerateResult => {
    if (!options.schema) return result;
    const object = parseStructuredText(options.schema, result.text);
    if (options.task === "outreach_draft") {
      assertReviewSafeOutreachDraft(object);
    }
    return {
      ...result,
      object,
    };
  };
  const responseText = async (response: Response) => {
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 5_000_000) throw new Error("LLM response is too large");
    const text = await response.text();
    if (Buffer.byteLength(text) > 5_000_000)
      throw new Error("LLM response is too large");
    if (!response.ok)
      throw new Error(
        `LLM provider failed (${response.status}): ${text.slice(0, 500)}`,
      );
    return JSON.parse(text) as Record<string, unknown>;
  };
  const selectedModel = (requested?: string) => {
    const selected = requested?.trim() || model?.trim();
    if (!selected) throw new Error("LLM_DEFAULT_MODEL is required");
    return selected;
  };

  return {
    name,
    async generate(options) {
      const primary = selectedModel(options.model);
      if (options.privateContext && options.webSearch)
        throw new Error("Private context cannot be sent to public web search");
      const signal = AbortSignal.timeout(
        options.task === "outreach_draft"
          ? 45_000
          : options.webSearch
            ? 180_000
            : 60_000,
      );
      if (name === "openrouter") {
        const chain = [
          ...new Set([
            ...(options.webSearch && !options.privateContext
              ? ["nvidia/nemotron-3-super-120b-a12b:free"]
              : []),
            ...(options.schema ? ["openrouter/free"] : []),
            primary,
            ...OPENROUTER_FREE_FALLBACK_MODELS,
          ]),
        ];
        let lastError: Error | undefined;
        for (const activeModel of chain) {
          assertOpenRouterFreeRoute(activeModel);
          try {
            const response = await fetch(
              "https://openrouter.ai/api/v1/chat/completions",
              {
                method: "POST",
                signal,
                headers: {
                  authorization: `Bearer ${config.openRouterApiKey ?? process.env.OPENROUTER_API_KEY}`,
                  "content-type": "application/json",
                  ...(process.env.NEXT_PUBLIC_APP_URL
                    ? { "http-referer": process.env.NEXT_PUBLIC_APP_URL }
                    : {}),
                  "x-openrouter-title": "hrmny OS",
                },
                body: JSON.stringify({
                  model: activeModel,
                  messages: openRouterMessages(options),
                  temperature: options.temperature ?? 0.2,
                  max_tokens: options.webSearch ? 4_096 : 2_048,
                  reasoning: { effort: "low", exclude: true },
                  ...(options.privateContext
                    ? { provider: { data_collection: "deny", zdr: true } }
                    : {}),
                  stream: false,
                  ...(options.webSearch
                    ? {
                        tools: [
                          {
                            type: "openrouter:web_search",
                            parameters: {
                              engine: "parallel",
                              mode: "basic",
                              max_results: 4,
                              max_total_results: 8,
                              max_uses: 2,
                              max_characters: 3_000,
                            },
                          },
                        ],
                        max_tool_calls: 2,
                      }
                    : {}),
                  ...(options.schema
                    ? {
                        response_format: { type: "json_object" },
                        plugins: [{ id: "response-healing" }],
                      }
                    : {}),
                }),
              },
            );
            const raw = await responseText(response);
            const choice = (
              raw.choices as Array<Record<string, unknown>> | undefined
            )?.[0];
            const message = choice?.message as
              Record<string, unknown> | undefined;
            const content =
              typeof message?.content === "string"
                ? message.content.trim()
                : "";
            // A reasoning-only response has no finished answer. Try the next route.
            const text = content;
            if (!text) {
              throw new Error("LLM provider returned no text");
            }
            const usage = raw.usage as Record<string, unknown> | undefined;
            const serverToolUse = usage?.server_tool_use as
              Record<string, unknown> | undefined;
            const sourceCitations = (
              Array.isArray(message?.annotations) ? message.annotations : []
            ).flatMap((annotation) => {
              if (!annotation || typeof annotation !== "object") return [];
              const citation = (annotation as Record<string, unknown>)
                .url_citation;
              if (!citation || typeof citation !== "object") return [];
              const value = citation as Record<string, unknown>;
              return typeof value.url === "string"
                ? [
                    {
                      url: value.url,
                      ...(typeof value.title === "string"
                        ? { title: value.title }
                        : {}),
                    },
                  ]
                : [];
            });
            return parseResult(options, {
              text,
              provider: name,
              model: typeof raw.model === "string" ? raw.model : activeModel,
              requestId: typeof raw.id === "string" ? raw.id : undefined,
              inputTokens: Number(usage?.prompt_tokens ?? 0) || undefined,
              outputTokens: Number(usage?.completion_tokens ?? 0) || undefined,
              sourceCitations,
              webSearchRequests:
                Number(serverToolUse?.web_search_requests ?? 0) || undefined,
            });
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            // Try next free route on rate-limit / empty / upstream failure.
            continue;
          }
        }
        if (options.privateContext)
          throw new Error(
            "Private AI preparation needs an available provider with zero retention and no data collection. Configure a compatible provider before retrying.",
          );
        if (options.task === "outreach_draft") {
          const object = mockOutreachDraft(extractUserText(options.messages));
          return {
            text: JSON.stringify(object),
            object: options.schema ? options.schema.parse(object) : object,
            provider: "mock",
            model: "fallback/outreach-template",
          };
        }
        throw lastError ?? new Error("LLM provider failed");
      }

      if (name === "anthropic") {
        const system = options.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const messages = anthropicMessages(options);
        const response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal,
          headers: {
            "x-api-key":
              config.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY!,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: primary,
            max_tokens: 2_048,
            temperature: options.temperature ?? 0.2,
            ...(system ? { system } : {}),
            messages,
          }),
        });
        const raw = await responseText(response);
        const content = raw.content as
          Array<Record<string, unknown>> | undefined;
        const text = (content ?? [])
          .filter(
            (block) => block.type === "text" && typeof block.text === "string",
          )
          .map((block) => block.text)
          .join("\n");
        if (!text) throw new Error("LLM provider returned no text");
        const usage = raw.usage as Record<string, unknown> | undefined;
        return parseResult(options, {
          text,
          provider: name,
          model: typeof raw.model === "string" ? raw.model : primary,
          requestId: typeof raw.id === "string" ? raw.id : undefined,
          inputTokens: Number(usage?.input_tokens ?? 0) || undefined,
          outputTokens: Number(usage?.output_tokens ?? 0) || undefined,
        });
      }

      const base = config.ollamaBaseUrl ?? process.env.OLLAMA_BASE_URL;
      if (!base) throw new Error("OLLAMA_BASE_URL is required");
      const response = await fetch(new URL("/api/chat", base), {
        method: "POST",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: primary,
          messages: ollamaMessages(options),
          stream: false,
          ...(options.schema ? { format: "json" } : {}),
          options: { temperature: options.temperature ?? 0.2 },
        }),
      });
      const raw = await responseText(response);
      const message = raw.message as Record<string, unknown> | undefined;
      const text = typeof message?.content === "string" ? message.content : "";
      if (!text) throw new Error("LLM provider returned no text");
      return parseResult(options, {
        text,
        provider: name,
        model: typeof raw.model === "string" ? raw.model : primary,
        inputTokens: Number(raw.prompt_eval_count ?? 0) || undefined,
        outputTokens: Number(raw.eval_count ?? 0) || undefined,
      });
    },
  };
}

// --- Cost metering + monthly-cap circuit breaker -------------------------

export type ModelPrice = {
  /** AED per 1M input tokens. */ inputPerMTokAed: number;
  /** AED per 1M output tokens. */ outputPerMTokAed: number;
};

/**
 * Model → price in AED per 1M tokens. Vendor prices are USD; AED ≈ USD × 3.6725.
 * ponytail: hand-maintained snapshot — vendor pricing drifts, so re-check when a
 * model is added or a bill looks off. Unknown models fall back to `default`.
 */
export const MODEL_PRICES_AED: Record<string, ModelPrice> = {
  "openai/gpt-4o": { inputPerMTokAed: 9.18, outputPerMTokAed: 36.73 },
  "openai/gpt-4o-mini": { inputPerMTokAed: 0.55, outputPerMTokAed: 2.2 },
  "anthropic/claude-3.5-sonnet": {
    inputPerMTokAed: 11.02,
    outputPerMTokAed: 55.09,
  },
  "anthropic/claude-3.5-haiku": {
    inputPerMTokAed: 2.94,
    outputPerMTokAed: 14.69,
  },
  "google/gemini-2.0-flash": { inputPerMTokAed: 0.37, outputPerMTokAed: 1.47 },
  "meta-llama/llama-3.1-70b-instruct": {
    inputPerMTokAed: 1.29,
    outputPerMTokAed: 1.29,
  },
  default: { inputPerMTokAed: 5, outputPerMTokAed: 15 },
};

export function priceForModel(model: string): ModelPrice {
  if (MODEL_PRICES_AED[model]) return MODEL_PRICES_AED[model];
  // Longest match wins so "gpt-4o-mini:free" beats the shorter "gpt-4o" key.
  const key = Object.keys(MODEL_PRICES_AED)
    .filter((candidate) => candidate !== "default" && model.includes(candidate))
    .sort((a, b) => b.length - a.length)[0];
  return (key && MODEL_PRICES_AED[key]) || MODEL_PRICES_AED.default!;
}

/** Cost in AED for a call, rounded to 4dp. Missing token counts cost 0. */
export function estimateCostAed(
  model: string,
  inputTokens = 0,
  outputTokens = 0,
): number {
  const price = priceForModel(model);
  const raw =
    (inputTokens / 1_000_000) * price.inputPerMTokAed +
    (outputTokens / 1_000_000) * price.outputPerMTokAed;
  return Math.round(raw * 10_000) / 10_000;
}

/** Emitted to the metering hook after every call — one `agent_runs` row. */
export type CostEvent = {
  agent?: string;
  provider: LLMProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costAed: number;
  requestId?: string;
};

/** Structured alert instead of a direct Chat/Slack call (wired by the app layer). */
export type CapAlertEvent = {
  type: "llm_monthly_cap_exceeded";
  capAed: number;
  spentAed: number;
  attemptedModel: string;
  agent?: string;
  at: string;
};

export class MonthlyCapExceededError extends Error {
  readonly code = "LLM_MONTHLY_CAP_EXCEEDED" as const;
  readonly alert: CapAlertEvent;
  constructor(alert: CapAlertEvent) {
    super(
      `LLM monthly cap reached: ${alert.spentAed} / ${alert.capAed} AED (model ${alert.attemptedModel})`,
    );
    this.name = "MonthlyCapExceededError";
    this.alert = alert;
  }
}

export type MeteringOptions = {
  /** Agent making the call — recorded on the cost event. */
  agent?: string;
  /** Called after each successful generate with the computed cost. */
  onCost?: (event: CostEvent) => void | Promise<void>;
  /** Month-to-date spend in AED. Cap check is skipped when omitted. */
  getMonthlySpendAed?: () => number | Promise<number>;
  /** Defaults to `LLM_MONTHLY_CAP_AED`. Cap check is skipped when unset/≤0. */
  monthlyCapAed?: number;
};

function envCapAed(): number | undefined {
  const raw = process.env.LLM_MONTHLY_CAP_AED?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Wraps a provider with per-call cost logging and a fail-closed monthly-cap
 * breaker. Leaves the mock provider fully functional — costs 0 when the mock
 * omits token counts, so evals and demos never trip the cap.
 */
export function withMetering(
  provider: LLMProvider,
  options: MeteringOptions = {},
): LLMProvider {
  const cap = options.monthlyCapAed ?? envCapAed();
  return {
    name: provider.name,
    async generate(genOptions) {
      if (cap != null && options.getMonthlySpendAed) {
        const spentAed = await options.getMonthlySpendAed();
        if (spentAed >= cap) {
          throw new MonthlyCapExceededError({
            type: "llm_monthly_cap_exceeded",
            capAed: cap,
            spentAed,
            attemptedModel: genOptions.model ?? "(default)",
            agent: options.agent,
            at: new Date().toISOString(),
          });
        }
      }
      const result = await provider.generate(genOptions);
      const inputTokens = result.inputTokens ?? 0;
      const outputTokens = result.outputTokens ?? 0;
      if (options.onCost) {
        await options.onCost({
          agent: options.agent,
          provider: result.provider,
          model: result.model,
          inputTokens,
          outputTokens,
          costAed: estimateCostAed(result.model, inputTokens, outputTokens),
          requestId: result.requestId,
        });
      }
      return result;
    },
  };
}

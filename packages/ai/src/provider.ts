import type { ZodTypeAny } from "zod";
import { mockExtractInvoice, InvoiceProposeSchema } from "./invoice-extract";

export type LLMProviderName = "openrouter" | "anthropic" | "ollama" | "mock";

export type LLMMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LLMGenerateOptions = {
  model?: string;
  messages: LLMMessage[];
  schema?: ZodTypeAny;
  temperature?: number;
  /** Optional task hint for mock structured outputs. */
  task?: "invoice_extract" | "generic";
};

export type LLMGenerateResult = {
  text: string;
  /** Present when schema was provided and parsing succeeded. */
  object?: unknown;
  provider: LLMProviderName;
  model: string;
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

function resolveName(config: CreateProviderConfig): LLMProviderName {
  const fromEnv = process.env.LLM_PROVIDER?.toLowerCase() as
    | LLMProviderName
    | undefined;
  const name = config.provider ?? fromEnv ?? "mock";
  if (name === "openrouter" && !config.openRouterApiKey && !process.env.OPENROUTER_API_KEY) {
    return "mock";
  }
  if (name === "anthropic" && !config.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
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

/** Mock provider returns structured invoice propose payloads for HITL demos. */
export function createMockProvider(
  defaultModel = "mock-invoice-extract",
): LLMProvider {
  return {
    name: "mock",
    async generate(options) {
      const userText = extractUserText(options.messages);
      const emailRefMatch = userText.match(/emailRef[:=]\s*(\S+)/i);
      const emailRef = emailRefMatch?.[1] ?? "demo-email-ref";
      const task = options.task ?? "invoice_extract";

      if (task === "invoice_extract" || options.schema === InvoiceProposeSchema) {
        const object = mockExtractInvoice(emailRef, userText);
        return {
          text: JSON.stringify(object),
          object,
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

export function createProvider(config: CreateProviderConfig = {}): LLMProvider {
  const name = resolveName(config);
  if (name === "mock") return createMockProvider(config.defaultModel);

  const model = config.defaultModel ?? process.env.LLM_DEFAULT_MODEL ?? "stub-model";
  // Real SDK wiring optional — without keys we already fell back to mock above.
  return {
    name,
    async generate(options) {
      const text = `[${name}:${options.model ?? model}] stub — set keys or LLM_PROVIDER=mock`;
      void options.schema;
      return { text, provider: name, model: options.model ?? model };
    },
  };
}

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
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
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

  const model = config.defaultModel ?? process.env.LLM_DEFAULT_MODEL;
  const parseResult = (
    options: LLMGenerateOptions,
    result: Omit<LLMGenerateResult, "object">,
  ): LLMGenerateResult => {
    if (!options.schema) return result;
    const json = result.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    return { ...result, object: options.schema.parse(JSON.parse(json)) };
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
      const activeModel = selectedModel(options.model);
      const signal = AbortSignal.timeout(60_000);
      if (name === "openrouter") {
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
              messages: options.messages,
              temperature: options.temperature ?? 0.2,
              stream: false,
              ...(options.schema
                ? { response_format: { type: "json_object" } }
                : {}),
            }),
          },
        );
        const raw = await responseText(response);
        const choice = (
          raw.choices as Array<Record<string, unknown>> | undefined
        )?.[0];
        const message = choice?.message as Record<string, unknown> | undefined;
        const text =
          typeof message?.content === "string" ? message.content : "";
        if (!text) throw new Error("LLM provider returned no text");
        const usage = raw.usage as Record<string, unknown> | undefined;
        return parseResult(options, {
          text,
          provider: name,
          model: typeof raw.model === "string" ? raw.model : activeModel,
          requestId: typeof raw.id === "string" ? raw.id : undefined,
          inputTokens: Number(usage?.prompt_tokens ?? 0) || undefined,
          outputTokens: Number(usage?.completion_tokens ?? 0) || undefined,
        });
      }

      if (name === "anthropic") {
        const system = options.messages
          .filter((message) => message.role === "system")
          .map((message) => message.content)
          .join("\n\n");
        const messages = options.messages.filter(
          (message) => message.role !== "system",
        );
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
            model: activeModel,
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
          model: typeof raw.model === "string" ? raw.model : activeModel,
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
          model: activeModel,
          messages: options.messages,
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
        model: typeof raw.model === "string" ? raw.model : activeModel,
        inputTokens: Number(raw.prompt_eval_count ?? 0) || undefined,
        outputTokens: Number(raw.eval_count ?? 0) || undefined,
      });
    },
  };
}

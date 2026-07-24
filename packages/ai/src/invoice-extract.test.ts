import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createMockProvider, createProvider } from "./provider";
import { InvoiceProposeSchema, mockExtractInvoice } from "./invoice-extract";

describe("invoice AI extract mock", () => {
  it("holds unknown TRN and never guesses", () => {
    const p = mockExtractInvoice("msg-1", "Invoice AED 500 — unknown TRN");
    expect(p.trn).toBeNull();
    expect(p.trnStatus).toBe("unknown_held");
    expect(p.ruleCited.toLowerCase()).toContain("trn");
  });

  it("LLMProvider mock returns structured propose payload", async () => {
    const llm = createMockProvider();
    const result = await llm.generate({
      task: "invoice_extract",
      schema: InvoiceProposeSchema,
      messages: [
        { role: "user", content: "emailRef: msg-42\nACME invoice AED 2100.00" },
      ],
    });
    expect(result.object).toBeTruthy();
    const parsed = InvoiceProposeSchema.parse(result.object);
    expect(parsed.contactName).toContain("ACME");
    expect(parsed.evidence.emailRef).toBe("msg-42");
  });
});

describe("live provider transport", () => {
  it("calls OpenRouter and validates structured output", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      expect(init?.headers).toMatchObject({
        authorization: "Bearer test-key",
      });
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "test/model",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Return JSON" },
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,iVBORw==" },
              },
            ],
          },
        ],
      });
      return new Response(
        JSON.stringify({
          id: "generation-1",
          model: "test/model",
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    try {
      const provider = createProvider({
        provider: "openrouter",
        openRouterApiKey: "test-key",
        defaultModel: "test/model",
      });
      const result = await provider.generate({
        messages: [{ role: "user", content: "Return JSON" }],
        schema: z.object({ ok: z.literal(true) }),
        task: "generic",
        images: [{ mediaType: "image/png", dataBase64: "iVBORw==" }],
      });
      expect(result.object).toEqual({ ok: true });
      expect(result.inputTokens).toBe(12);
      expect(result.outputTokens).toBe(4);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

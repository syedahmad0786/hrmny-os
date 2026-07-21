import { describe, expect, it } from "vitest";
import { createMockProvider } from "./provider";
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

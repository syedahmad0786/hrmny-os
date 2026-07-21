import { z } from "zod";

/** Structured HITL propose payload for Module B invoice intake. */
export const InvoiceProposeSchema = z.object({
  contactName: z.string().min(1),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  vatAmount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  currency: z.literal("AED").default("AED"),
  trn: z.string().nullable(),
  /** Never guess unknown TRN — hold when null. */
  trnStatus: z.enum(["known", "unknown_held"]),
  ruleCited: z.string().min(1),
  evidence: z.object({
    emailRef: z.string(),
    snippet: z.string().optional(),
  }),
  invoiceType: z.enum(["vendor", "expense", "retainer"]).default("vendor"),
});

export type InvoiceProposePayload = z.infer<typeof InvoiceProposeSchema>;

/** Deterministic mock extract for demos without LLM keys. */
export function mockExtractInvoice(
  emailRef: string,
  bodyHint?: string,
): InvoiceProposePayload {
  const lower = (bodyHint ?? "").toLowerCase();
  const unknownTrn = lower.includes("unknown trn") || lower.includes("no trn");
  const amountMatch = bodyHint?.match(/AED\s*([\d,.]+)/i);
  const amount = amountMatch
    ? amountMatch[1]!.replace(/,/g, "")
    : "2100.00";
  const vat = (Number(amount) * 0.05).toFixed(2);

  return InvoiceProposeSchema.parse({
    contactName: lower.includes("acme") ? "ACME Supplies LLC" : "Vendor LLC",
    amount,
    vatAmount: vat,
    currency: "AED",
    trn: unknownTrn ? null : "100483714000003",
    trnStatus: unknownTrn ? "unknown_held" : "known",
    ruleCited: "VAT 5% on taxable supplies (UAE); unknown TRN held, never guessed",
    evidence: {
      emailRef,
      snippet: (bodyHint ?? "Invoice attached").slice(0, 200),
    },
    invoiceType: "vendor",
  });
}

import { z } from "zod";
import { importApolloPersonToCrm } from "./apollo-import";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  getIntegrationReceipt,
  recordIntegrationReceipt,
} from "../integrations/inbox";

const APOLLO_SEARCH_OPERATION = "people.search.zero-credit";
const APOLLO_AUTO_IMPORT_OPERATION = "people.search.auto_import";

const candidateSchema = z.object({
  externalId: z.string().trim().min(1).max(180),
  fullName: z.string().trim().max(240).optional(),
  title: z.string().trim().max(240).optional(),
  companyName: z.string().trim().max(240).optional(),
  companyDomain: z.string().trim().max(240).optional(),
  source: z.string().trim().min(1).max(80),
});

const searchResultSchema = z.object({
  bridgeStatus: z.literal("completed"),
  candidates: z.array(candidateSchema).max(10),
});

const importResultSchema = z.object({
  sourceSearchReceiptId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  externalId: z.string().min(1),
  companyId: z.string().uuid(),
  contactId: z.string().uuid(),
  dealId: z.string().uuid(),
  companyName: z.string().min(1),
});

export type ApolloFreeSearchCrmImport = {
  sourceSearchReceiptId: string;
  idempotencyKey: string;
  externalId: string;
  status: "completed" | "processing" | "failed";
  duplicate: boolean;
  companyId?: string;
  contactId?: string;
  dealId?: string;
  companyName?: string;
};

function sourceKey(actorEmployeeId: string, externalId: string) {
  return `free-auto-import:${actorEmployeeId}:${externalId}`;
}

async function completedSearch(input: {
  sourceSearchReceiptId: string;
  idempotencyKey: string;
  actorEmployeeId: string;
}) {
  const receipt = await getIntegrationReceipt("apollo", input.idempotencyKey);
  if (
    !receipt ||
    receipt.receiptId !== input.sourceSearchReceiptId ||
    receipt.operation !== APOLLO_SEARCH_OPERATION ||
    receipt.ownerEmployeeId !== input.actorEmployeeId
  ) {
    throw new Error("APOLLO_SEARCH_IMPORT_FORBIDDEN");
  }
  const result = searchResultSchema.safeParse(receipt.result);
  if (!result.success) throw new Error("APOLLO_SEARCH_IMPORT_NOT_COMPLETED");
  return result.data;
}

function completedImport(
  result: Record<string, unknown> | null | undefined,
  duplicate: boolean,
): ApolloFreeSearchCrmImport | null {
  const parsed = importResultSchema.safeParse(result);
  return parsed.success
    ? { ...parsed.data, status: "completed", duplicate }
    : null;
}

/**
 * Persist the candidates from one already-completed zero-credit Apollo search.
 * The completed search receipt is re-read and owner-checked here, so callers
 * cannot import arbitrary candidates, change ownership, or attach a client or
 * project identifier. Each employee/Apollo external-id pair has its own durable
 * receipt, which makes repeat worker delivery side-effect free.
 */
export async function persistCompletedApolloFreeSearchToCrm(input: {
  sourceSearchReceiptId: string;
  idempotencyKey: string;
  actorEmployeeId: string;
}): Promise<ApolloFreeSearchCrmImport[]> {
  const parsedInput = z
    .object({
      sourceSearchReceiptId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      actorEmployeeId: z.string().uuid(),
    })
    .parse(input);
  const search = await completedSearch(parsedInput);
  const imports: ApolloFreeSearchCrmImport[] = [];

  for (const candidate of search.candidates) {
    const receipt = await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: sourceKey(
        parsedInput.actorEmployeeId,
        candidate.externalId,
      ),
      operation: APOLLO_AUTO_IMPORT_OPERATION,
      rawBody: JSON.stringify({
        actorEmployeeId: parsedInput.actorEmployeeId,
        externalId: candidate.externalId,
      }),
      status: "processing",
      ownerEmployeeId: parsedInput.actorEmployeeId,
      payload: {
        sourceSearchReceiptId: parsedInput.sourceSearchReceiptId,
        idempotencyKey: parsedInput.idempotencyKey,
        externalId: candidate.externalId,
      },
    });
    if (
      receipt.operation !== APOLLO_AUTO_IMPORT_OPERATION ||
      receipt.ownerEmployeeId !== parsedInput.actorEmployeeId
    ) {
      throw new Error("APOLLO_SEARCH_IMPORT_FORBIDDEN");
    }
    const duplicate = completedImport(receipt.result, true);
    if (receipt.duplicate && duplicate) {
      imports.push(duplicate);
      continue;
    }
    if (receipt.duplicate) {
      imports.push({
        sourceSearchReceiptId: parsedInput.sourceSearchReceiptId,
        idempotencyKey: parsedInput.idempotencyKey,
        externalId: candidate.externalId,
        status: receipt.status === "failed" ? "failed" : "processing",
        duplicate: true,
      });
      continue;
    }

    try {
      const imported = await importApolloPersonToCrm({
        person: { ...candidate, raw: { freeSearch: true } },
        receiptId: receipt.receiptId,
        ownerEmployeeId: parsedInput.actorEmployeeId,
        preserveExistingFields: true,
        dedupeReceiptNote: true,
      });
      const result = {
        sourceSearchReceiptId: parsedInput.sourceSearchReceiptId,
        idempotencyKey: parsedInput.idempotencyKey,
        externalId: candidate.externalId,
        companyId: imported.companyId,
        contactId: imported.contactId,
        dealId: imported.dealId,
        companyName: imported.companyName,
      };
      await completeIntegrationReceipt(receipt.receiptId, result);
      imports.push({ ...result, status: "completed", duplicate: false });
    } catch {
      await failIntegrationReceipt(
        receipt.receiptId,
        "APOLLO_AUTO_IMPORT_FAILED",
      );
      imports.push({
        sourceSearchReceiptId: parsedInput.sourceSearchReceiptId,
        idempotencyKey: parsedInput.idempotencyKey,
        externalId: candidate.externalId,
        status: "failed",
        duplicate: false,
      });
    }
  }
  return imports;
}

/** Read only the caller-owned import receipts derived from one completed search. */
export async function getCompletedApolloFreeSearchCrmImports(input: {
  sourceSearchReceiptId: string;
  idempotencyKey: string;
  actorEmployeeId: string;
}): Promise<ApolloFreeSearchCrmImport[]> {
  const parsedInput = z
    .object({
      sourceSearchReceiptId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      actorEmployeeId: z.string().uuid(),
    })
    .parse(input);
  const search = await completedSearch(parsedInput);
  return Promise.all(
    search.candidates.map(async (candidate) => {
      const receipt = await getIntegrationReceipt(
        "apollo",
        sourceKey(parsedInput.actorEmployeeId, candidate.externalId),
      );
      const completed = completedImport(receipt?.result, true);
      if (
        !receipt ||
        receipt.operation !== APOLLO_AUTO_IMPORT_OPERATION ||
        receipt.ownerEmployeeId !== parsedInput.actorEmployeeId
      ) {
        return {
          sourceSearchReceiptId: parsedInput.sourceSearchReceiptId,
          idempotencyKey: parsedInput.idempotencyKey,
          externalId: candidate.externalId,
          companyId: "",
          contactId: "",
          dealId: "",
          companyName: "",
          status: "processing" as const,
          duplicate: false,
        };
      }
      if (completed) return completed;
      return {
        sourceSearchReceiptId: parsedInput.sourceSearchReceiptId,
        idempotencyKey: parsedInput.idempotencyKey,
        externalId: candidate.externalId,
        status:
          receipt.status === "failed"
            ? ("failed" as const)
            : ("processing" as const),
        duplicate: receipt.duplicate,
      };
    }),
  );
}

import { z } from "zod";
import { sql } from "@hrmny/db";
import { importApolloPersonToCrm } from "./apollo-import";
import { getDb, withDatabaseScope } from "../db";
import { resolveActiveStaffById } from "../auth/session";
import { lockStaffFeatureAuthorizationInputs } from "../auth/authorization-fence";
import { featureEnabled } from "../features";
import {
  completeIntegrationReceipt,
  getIntegrationReceipt,
  recordIntegrationReceipt,
} from "../integrations/inbox";

const APOLLO_SEARCH_OPERATION = "people.search.zero-credit";
const APOLLO_AUTO_IMPORT_OPERATION = "people.search.auto_import";

const candidateSchema = z.object({
  externalId: z.string().trim().min(1).max(180),
  fullName: z.string().trim().max(241).optional(),
  title: z.string().trim().max(240).optional(),
  companyName: z.string().trim().max(240).optional(),
  companyDomain: z.string().trim().max(255).optional(),
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
  if (receipt.status !== "completed")
    throw new Error("APOLLO_SEARCH_IMPORT_NOT_COMPLETED");
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
  const db = getDb();
  const apply = () => persistSearchCandidates(input);
  if (!db) return apply();
  return db.transaction(async (tx) => {
    // ponytail: serialize bounded ten-person imports; use company locks if throughput requires it.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('apollo-free-crm-import'))`,
    );
    await lockStaffFeatureAuthorizationInputs(
      tx as unknown as typeof db,
      input.actorEmployeeId,
    );
    return withDatabaseScope(tx as unknown as typeof db, apply);
  });
}

async function assertCrmImportAuthorized(actorEmployeeId: string) {
  const actor = await resolveActiveStaffById(actorEmployeeId);
  if (
    !actor ||
    actor.actorType !== "staff" ||
    actor.clientId !== null ||
    !actor.roles.some((role) =>
      ["partner", "director", "am", "account_manager"].includes(role),
    ) ||
    !(await featureEnabled("crm.workspace", {
      userId: actor.employeeId,
      roles: actor.roles,
    }))
  )
    throw new Error("APOLLO_CRM_IMPORT_FORBIDDEN");
}

async function persistSearchCandidates(input: {
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
  await assertCrmImportAuthorized(parsedInput.actorEmployeeId);
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
    if (receipt.status === "completed" && duplicate) {
      imports.push(duplicate);
      continue;
    }
    // The receipt and every CRM row commit together. An interrupted attempt
    // rolls back; an older partial receipt is reconciled by the existing dedupe.
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
  }
  await assertCrmImportAuthorized(parsedInput.actorEmployeeId);
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
          status: "processing" as const,
          duplicate: false,
        };
      }
      if (receipt.status === "completed" && completed) return completed;
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

import type {
  LeadEnrichmentIdentity,
  LeadSourceAdapter,
} from "@hrmny/integrations";
import { createLeadSourceLive } from "@hrmny/integrations";
import { randomUUID } from "node:crypto";
import { importApolloPersonToCrm } from "../crm/apollo-import";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  getIntegrationReceipt,
  hashIntegrationPayload,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  updateIntegrationReceiptProgress,
} from "../integrations/inbox";
import { resolveOwnedIntegrationApiKey } from "../integrations/resolve-keys";
import {
  getSalesOsSettings,
  isSuppressed,
  reserveCreditWithinCap,
} from "./store";

/** One durable allowance for the explicitly approved production connection test. */
export const APOLLO_ONE_PERSON_CANARY_ID =
  "sales-growth-one-person-enrichment-v1";
export const APOLLO_PAID_APPROVAL_ACTION = "apollo.people.match" as const;
const APOLLO_PAID_APPROVAL_MAX_AGE_MS = 5 * 60_000;

function normalizedCandidate(input: LeadEnrichmentIdentity) {
  return {
    externalId: input.externalId?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    fullName: input.fullName?.trim() || undefined,
    companyName: input.companyName?.trim() || undefined,
    companyDomain: input.companyDomain?.trim().toLowerCase() || undefined,
    linkedinUrl: input.linkedinUrl?.trim() || undefined,
  } satisfies LeadEnrichmentIdentity;
}

export function apolloExactCandidateHash(input: LeadEnrichmentIdentity) {
  return hashIntegrationPayload(JSON.stringify(normalizedCandidate(input)));
}

export async function approveApolloExactPerson(input: {
  candidate: LeadEnrichmentIdentity;
  actorEmployeeId: string;
  now?: Date;
}) {
  const candidate = normalizedCandidate(input.candidate);
  const candidateHash = apolloExactCandidateHash(candidate);
  const approvalReceiptId = randomUUID();
  const approvedAt = input.now ?? new Date();
  const expiresAt = new Date(
    approvedAt.getTime() + APOLLO_PAID_APPROVAL_MAX_AGE_MS,
  );
  await recordIntegrationReceipt({
    provider: "apollo",
    externalEventId: `paid-approval:${approvalReceiptId}`,
    operation: APOLLO_PAID_APPROVAL_ACTION,
    rawBody: JSON.stringify({
      approvalReceiptId,
      actorEmployeeId: input.actorEmployeeId,
      candidateHash,
    }),
    ownerEmployeeId: input.actorEmployeeId,
    completed: true,
    result: {
      status: "approved",
      action: APOLLO_PAID_APPROVAL_ACTION,
      approvalReceiptId,
      actorEmployeeId: input.actorEmployeeId,
      candidateHash,
      approvedAt: approvedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
  });
  return {
    approvalReceiptId,
    candidateHash,
    approvedAt: approvedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    creditsMaximum: 1 as const,
  };
}

export async function consumeApolloExactApproval(
  claim: ApolloExactApprovalClaim,
): Promise<ApolloConsumedApprovalReceipt> {
  const receipt = await getIntegrationReceipt(
    "apollo",
    `paid-approval:${claim.approvalReceiptId}`,
  );
  const result = receipt?.result;
  if (
    !receipt ||
    receipt.status !== "completed" ||
    result?.status !== "approved" ||
    result.action !== claim.action ||
    result.actorEmployeeId !== claim.actorEmployeeId ||
    result.candidateHash !== claim.candidateHash
  ) {
    throw new Error("APOLLO_EXACT_APPROVAL_RECEIPT_INVALID_OR_USED");
  }
  const consumed = await transitionIntegrationReceiptProgress(
    receipt.receiptId,
    { status: "completed", stateVersion: receipt.stateVersion },
    {
      status: "completed",
      processed: true,
      result: { ...result, status: "consumed", consumedAt: claim.requestedAt },
    },
  );
  if (!consumed) {
    throw new Error("APOLLO_EXACT_APPROVAL_RECEIPT_INVALID_OR_USED");
  }
  return {
    approvalReceiptId: claim.approvalReceiptId,
    actorEmployeeId: claim.actorEmployeeId,
    candidateHash: claim.candidateHash,
    action: claim.action,
    approvedAt: String(result.approvedAt),
    expiresAt: String(result.expiresAt),
    status: "consumed",
  };
}

export type ApolloOnePersonResult = {
  receiptId: string;
  duplicate: boolean;
  mode: "mock" | "live";
  matched: boolean;
  creditsRecorded: 0 | 1;
  imported: boolean;
  reason?: string;
  crm?: {
    companyId: string;
    contactId: string;
    dealId: string;
    companyName: string;
    fullName: string;
    email: string | null;
    emailVerified: boolean;
    reused: { company: boolean; contact: boolean; deal: boolean };
  };
};

export type ApolloExactApprovalClaim = {
  approvalReceiptId: string;
  actorEmployeeId: string;
  candidateHash: string;
  action: typeof APOLLO_PAID_APPROVAL_ACTION;
  requestedAt: string;
};

export type ApolloConsumedApprovalReceipt = {
  approvalReceiptId: string;
  actorEmployeeId: string;
  candidateHash: string;
  action: typeof APOLLO_PAID_APPROVAL_ACTION;
  approvedAt: string;
  expiresAt: string;
  status: "consumed";
};

type ApolloOneDeps = {
  leadSource?: LeadSourceAdapter;
  resolveApiKey?: typeof resolveOwnedIntegrationApiKey;
  allowSynthetic?: boolean;
  now?: () => Date;
  consumeExactApproval?: (
    claim: ApolloExactApprovalClaim,
  ) => Promise<ApolloConsumedApprovalReceipt>;
};

async function configuredLiveSource(
  allowPaidOperations: boolean,
  actorEmployeeId: string | null | undefined,
  deps: ApolloOneDeps,
): Promise<LeadSourceAdapter> {
  const resolver = deps.resolveApiKey ?? resolveOwnedIntegrationApiKey;
  const { apiKey } = await resolver("apollo", actorEmployeeId, null);
  if (!apiKey) {
    throw new Error(
      "APOLLO_API_KEY is not configured for the HRMNY production runtime",
    );
  }
  return createLeadSourceLive({
    mode: "live",
    apiKey,
    allowPaidOperations,
  });
}

export async function getApolloOnePersonCanaryStatus(): Promise<{
  available: boolean;
  status: string;
  receiptId: string | null;
  result: Record<string, unknown> | null;
}> {
  let receipt: Awaited<ReturnType<typeof getIntegrationReceipt>>;
  try {
    receipt = await getIntegrationReceipt(
      "apollo",
      APOLLO_ONE_PERSON_CANARY_ID,
    );
  } catch (error) {
    const directCode =
      error && typeof error === "object" && "code" in error
        ? String(error.code)
        : null;
    const cause =
      error && typeof error === "object" && "cause" in error
        ? error.cause
        : null;
    const causeCode =
      cause && typeof cause === "object" && "code" in cause
        ? String(cause.code)
        : null;
    if (directCode === "42P01" || causeCode === "42P01") {
      return {
        available: false,
        status: "migration_required",
        receiptId: null,
        result: null,
      };
    }
    throw error;
  }
  return {
    available: false,
    status: receipt?.status ?? "locked_exact_approval_required",
    receiptId: receipt?.receiptId ?? null,
    result: receipt?.result ?? null,
  };
}

function asStoredResult(
  receiptId: string,
  result: Record<string, unknown> | null | undefined,
): ApolloOnePersonResult {
  if (!result) throw new Error("APOLLO_CANARY_COMPLETED_WITHOUT_RESULT");
  return {
    ...(result as unknown as Omit<ApolloOnePersonResult, "receiptId">),
    receiptId,
    duplicate: true,
  };
}

/**
 * Execute one explicitly approved People Match call. The candidate-keyed
 * receipt prevents duplicate spend. Apollo exposes no request idempotency key,
 * so an uncertain provider outcome remains closed for reconciliation.
 */
export async function enrichOneApolloPerson(
  input: {
    candidate: LeadEnrichmentIdentity;
    confirmCreditUse: true;
    actorEmployeeId: string;
    approvalReceiptId: string;
  },
  deps: ApolloOneDeps = {},
): Promise<ApolloOnePersonResult> {
  if (input.confirmCreditUse !== true) {
    throw new Error("APOLLO_CREDIT_CONFIRMATION_REQUIRED");
  }
  const actorEmployeeId = input.actorEmployeeId.trim();
  const approvalReceiptId = input.approvalReceiptId.trim();
  if (!actorEmployeeId || !approvalReceiptId || !deps.consumeExactApproval) {
    throw new Error("APOLLO_PAID_ENRICHMENT_REQUIRES_EXACT_APPROVAL_RECEIPT");
  }
  const candidate = normalizedCandidate(input.candidate);
  if (!candidate.externalId && !candidate.email && !candidate.fullName) {
    throw new Error("APOLLO_PERSON_IDENTITY_REQUIRED");
  }

  const suppressed = await isSuppressed({
    email: candidate.email,
    domain: candidate.companyDomain,
  });
  if (suppressed) throw new Error("APOLLO_PERSON_IS_SUPPRESSED");

  const settings = await getSalesOsSettings();
  const candidateHash = apolloExactCandidateHash(candidate);
  const existing = await getIntegrationReceipt(
    "apollo",
    `people-match:${candidateHash}`,
  );
  if (existing?.status === "completed") {
    return asStoredResult(existing.receiptId, existing.result);
  }
  const retryableBeforeProvider =
    existing?.status === "failed" &&
    ["cap_not_reserved", "credit_reservation_failed"].includes(
      String(existing.result?.bridgeStatus ?? ""),
    );
  if (existing && !retryableBeforeProvider) {
    throw new Error(`APOLLO_MATCH_RECONCILIATION_REQUIRED:${existing.status}`);
  }

  const requestedAt = (deps.now ?? (() => new Date()))();
  const approval = await deps.consumeExactApproval({
    approvalReceiptId,
    actorEmployeeId,
    candidateHash,
    action: APOLLO_PAID_APPROVAL_ACTION,
    requestedAt: requestedAt.toISOString(),
  });
  const approvedAt = Date.parse(approval.approvedAt);
  const expiresAt = Date.parse(approval.expiresAt);
  if (
    approval.status !== "consumed" ||
    approval.approvalReceiptId !== approvalReceiptId ||
    approval.actorEmployeeId !== actorEmployeeId ||
    approval.candidateHash !== candidateHash ||
    approval.action !== APOLLO_PAID_APPROVAL_ACTION ||
    !Number.isFinite(approvedAt) ||
    !Number.isFinite(expiresAt) ||
    approvedAt > requestedAt.getTime() ||
    requestedAt.getTime() - approvedAt > APOLLO_PAID_APPROVAL_MAX_AGE_MS ||
    expiresAt <= requestedAt.getTime()
  ) {
    throw new Error("APOLLO_EXACT_APPROVAL_RECEIPT_INVALID_OR_STALE");
  }

  const source =
    deps.leadSource ??
    (await configuredLiveSource(true, actorEmployeeId, deps));

  const payload = {
    candidate,
    paidFields: {
      personalEmail: false,
      phone: false,
      emailWaterfall: false,
      phoneWaterfall: false,
    },
  };
  const rawBody = JSON.stringify(payload);
  const receipt = await recordIntegrationReceipt({
    provider: "apollo",
    externalEventId: `people-match:${candidateHash}`,
    operation: "people.match.exact-person",
    rawBody,
    payload,
    status: "processing",
    ownerEmployeeId: actorEmployeeId,
  });
  let shouldAttempt = !receipt.duplicate;
  if (receipt.duplicate && retryableBeforeProvider) {
    shouldAttempt = await transitionIntegrationReceiptProgress(
      receipt.receiptId,
      { status: "failed", stateVersion: receipt.stateVersion },
      { status: "processing", result: { bridgeStatus: "reserving_credit" } },
    );
  }
  if (!shouldAttempt) {
    throw new Error(`APOLLO_CANARY_RECONCILIATION_REQUIRED:${receipt.status}`);
  }

  const creditRecorded = await reserveCreditWithinCap(
    "apollo_contact",
    settings.caps.apolloContactsPerMonth,
    1,
    requestedAt.toISOString().slice(0, 7),
  ).catch(async (error) => {
    await updateIntegrationReceiptProgress(receipt.receiptId, {
      status: "failed",
      result: { bridgeStatus: "credit_reservation_failed" },
      lastError:
        error instanceof Error ? error.message : "Credit reservation failed",
    }).catch(() => undefined);
    throw error;
  });
  if (!creditRecorded) {
    await updateIntegrationReceiptProgress(receipt.receiptId, {
      status: "failed",
      result: { bridgeStatus: "cap_not_reserved" },
      lastError: "Apollo monthly cap reached before provider request",
    });
    throw new Error("APOLLO_MONTHLY_CAP_REACHED");
  }

  try {
    const person = await source.enrichLead(candidate);

    if (!person) {
      const result: ApolloOnePersonResult = {
        receiptId: receipt.receiptId,
        duplicate: false,
        mode: source.mode,
        matched: false,
        creditsRecorded: 1,
        imported: false,
        reason: "Apollo returned no matching person",
      };
      await completeIntegrationReceipt(
        receipt.receiptId,
        result as unknown as Record<string, unknown>,
      );
      return result;
    }

    const resultSuppressed = await isSuppressed({
      email: person.email,
      domain: person.companyDomain,
    });
    if (resultSuppressed) {
      const result: ApolloOnePersonResult = {
        receiptId: receipt.receiptId,
        duplicate: false,
        mode: source.mode,
        matched: true,
        creditsRecorded: 1,
        imported: false,
        reason: "Matched person is suppressed; CRM import blocked",
      };
      await completeIntegrationReceipt(
        receipt.receiptId,
        result as unknown as Record<string, unknown>,
      );
      return result;
    }

    const freeSaveReceipt = candidate.externalId
      ? await getIntegrationReceipt(
          "apollo",
          `free-save:${actorEmployeeId}:${candidate.externalId}`,
        )
      : null;
    const savedContactId =
      freeSaveReceipt?.status === "completed" &&
      typeof freeSaveReceipt.result?.contactId === "string"
        ? freeSaveReceipt.result.contactId
        : null;
    const savedDealId =
      freeSaveReceipt?.status === "completed" &&
      typeof freeSaveReceipt.result?.dealId === "string"
        ? freeSaveReceipt.result.dealId
        : null;
    const crm = await importApolloPersonToCrm({
      person,
      receiptId: receipt.receiptId,
      ownerEmployeeId: actorEmployeeId,
      existingContactId: savedContactId,
      existingDealId: savedDealId,
    });
    const result: ApolloOnePersonResult = {
      receiptId: receipt.receiptId,
      duplicate: false,
      mode: source.mode,
      matched: true,
      creditsRecorded: 1,
      imported: true,
      crm,
    };
    await completeIntegrationReceipt(
      receipt.receiptId,
      result as unknown as Record<string, unknown>,
    );
    return result;
  } catch (error) {
    await failIntegrationReceipt(
      receipt.receiptId,
      error instanceof Error ? error.message : "Apollo provider attempt failed",
    ).catch(() => undefined);
    throw error;
  }
}

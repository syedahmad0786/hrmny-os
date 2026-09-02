import type {
  LeadEnrichmentIdentity,
  LeadSourceAdapter,
} from "@hrmny/integrations";
import { createLeadSourceLive } from "@hrmny/integrations";
import { importApolloPersonToCrm } from "../crm/apollo-import";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  getIntegrationReceipt,
  hashIntegrationPayload,
  recordIntegrationReceipt,
} from "../integrations/inbox";
import { resolveOwnedIntegrationApiKey } from "../integrations/resolve-keys";
import {
  addCredit,
  creditUsed,
  getSalesOsSettings,
  isSuppressed,
} from "./store";

/** One durable allowance for the explicitly approved production connection test. */
export const APOLLO_ONE_PERSON_CANARY_ID =
  "sales-growth-one-person-enrichment-v1";
export const APOLLO_PAID_APPROVAL_ACTION = "apollo.people.match" as const;
const APOLLO_PAID_APPROVAL_MAX_AGE_MS = 5 * 60_000;

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
 * Execute the one user-authorized People Match call. A fixed durable receipt
 * makes the allowance one-shot across candidates and deploys. Apollo exposes
 * no request idempotency key for this operation, so an uncertain/failed claim
 * remains fail-closed for manual reconciliation instead of being retried.
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
    throw new Error(
      "APOLLO_PAID_ENRICHMENT_REQUIRES_EXACT_APPROVAL_RECEIPT",
    );
  }
  const candidate = {
    externalId: input.candidate.externalId?.trim() || undefined,
    email: input.candidate.email?.trim().toLowerCase() || undefined,
    fullName: input.candidate.fullName?.trim() || undefined,
    companyName: input.candidate.companyName?.trim() || undefined,
    companyDomain:
      input.candidate.companyDomain?.trim().toLowerCase() || undefined,
    linkedinUrl: input.candidate.linkedinUrl?.trim() || undefined,
  } satisfies LeadEnrichmentIdentity;
  if (!candidate.externalId && !candidate.email && !candidate.fullName) {
    throw new Error("APOLLO_PERSON_IDENTITY_REQUIRED");
  }

  const suppressed = await isSuppressed({
    email: candidate.email,
    domain: candidate.companyDomain,
  });
  if (suppressed) throw new Error("APOLLO_PERSON_IS_SUPPRESSED");

  const settings = await getSalesOsSettings();
  const used = await creditUsed("apollo_contact");
  if (used >= settings.caps.apolloContactsPerMonth) {
    throw new Error("APOLLO_MONTHLY_CAP_REACHED");
  }
  // Resolve credentials before claiming the one-shot receipt. A missing
  // reference is safe to retry because no provider request has started.
  const source =
    deps.leadSource ??
    (await configuredLiveSource(true, actorEmployeeId, deps));

  const candidateHash = hashIntegrationPayload(JSON.stringify(candidate));
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

  const payload = {
    candidate,
    approvalReceiptId,
    candidateHash,
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
    externalEventId: APOLLO_ONE_PERSON_CANARY_ID,
    operation: "people.match.one-person-canary",
    rawBody,
    payload,
    status: "processing",
  });
  if (receipt.duplicate) {
    if (receipt.status === "completed") {
      return asStoredResult(receipt.receiptId, receipt.result);
    }
    throw new Error(`APOLLO_CANARY_RECONCILIATION_REQUIRED:${receipt.status}`);
  }

  let providerAttempted = false;
  let creditRecorded = false;
  try {
    providerAttempted = true;
    const person = await source.enrichLead(candidate);
    await addCredit("apollo_contact", 1);
    creditRecorded = true;

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

    const crm = await importApolloPersonToCrm({
      person,
      receiptId: receipt.receiptId,
      ownerEmployeeId: actorEmployeeId,
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
    if (providerAttempted && !creditRecorded) {
      // Apollo does not expose a reliable per-request credit receipt here.
      // Count one conservatively and never retry an uncertain request.
      await addCredit("apollo_contact", 1).catch(() => undefined);
    }
    await failIntegrationReceipt(
      receipt.receiptId,
      error instanceof Error ? error.message : "Apollo provider attempt failed",
    ).catch(() => undefined);
    throw error;
  }
}

type ApolloCancellationState = {
  receiptId: string;
  providerAttemptedPreviously?: boolean;
  providerMaySettle?: boolean;
};

type ApolloSearchStatusState = ApolloCancellationState & {
  status:
    "processing" | "retry_scheduled" | "completed" | "dead_letter" | "revoked";
  mode: "mock" | "live";
  attempts: number;
  candidateCount: number;
  nextAttemptAt?: string;
  queue?: "inngest" | "scheduled_job_fallback" | "injected_test_queue";
  reason?: string;
};

function ambiguousOutcomeNote(receipt: string): string {
  return `An earlier authorized or transport-ambiguous zero-credit Apollo request may still settle independently; receipt ${receipt} remains flagged for reconciliation.`;
}

export function apolloCancellationNote(
  result: ApolloCancellationState,
): string {
  const receipt = result.receiptId.slice(0, 8);
  if (result.providerMaySettle) {
    return `Cancellation recorded before the next attempt. An already authorized or transport-ambiguous zero-credit Apollo request may still settle; receipt ${receipt} is retained for reconciliation.`;
  }
  if (result.providerAttemptedPreviously) {
    return `Cancellation recorded before the next attempt. An earlier zero-credit Apollo request was attempted; receipt ${receipt} remains in the audit trail.`;
  }
  return `Apollo search cancelled before provider dispatch. Receipt ${receipt} retained for review; 0 credits used.`;
}

export function apolloSearchStatusNote(
  result: ApolloSearchStatusState,
): string {
  const receipt = result.receiptId.slice(0, 8);
  const ambiguity = result.providerMaySettle
    ? ` ${ambiguousOutcomeNote(receipt)}`
    : "";

  if (result.status === "retry_scheduled") {
    const base =
      result.reason === "APOLLO_SEARCH_QUEUED"
        ? result.queue === "scheduled_job_fallback"
          ? `Apollo search is retained in the durable fallback queue; managed queue activation is still pending. Receipt ${receipt}. No credits used.`
          : `Apollo search is queued for durable execution; receipt ${receipt}. No credits used.`
        : `Apollo retry is scheduled for ${result.nextAttemptAt ?? "the provider-safe window"}. Receipt ${receipt}. No credits used.`;
    return `${base}${ambiguity}`;
  }

  if (result.status === "processing") {
    return `Apollo is processing the same durable request. Receipt ${receipt}. No credits used.${ambiguity}`;
  }

  if (result.status === "completed") {
    const base = result.candidateCount
      ? `${result.candidateCount} people returned by the current Apollo ${result.mode} attempt after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}; receipt ${receipt}. 0 credits used.`
      : `No people matched in the current Apollo ${result.mode} attempt after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}; receipt ${receipt}. 0 credits used.`;
    return `${base}${ambiguity}`;
  }

  if (result.providerMaySettle) {
    return `Apollo search ${result.status.replace("_", " ")}. ${ambiguousOutcomeNote(receipt)} No credits used.`;
  }
  if (result.providerAttemptedPreviously) {
    return `Apollo search ${result.status.replace("_", " ")}. A zero-credit provider attempt is recorded in receipt ${receipt} for review.`;
  }
  return `Apollo search ${result.status.replace("_", " ")}. Receipt ${receipt} retained for review; 0 credits used.`;
}

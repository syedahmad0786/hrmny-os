import { describe, expect, it } from "vitest";
import {
  apolloCancellationNote,
  apolloSearchStatusNote,
} from "./apollo-status-copy";

describe("Apollo cancellation status copy", () => {
  it("does not describe a previous provider attempt as pre-dispatch", () => {
    expect(
      apolloCancellationNote({
        receiptId: "41000000-0000-4000-8000-000000000032",
        providerAttemptedPreviously: true,
      }),
    ).toBe(
      "Cancellation recorded before the next attempt. An earlier zero-credit Apollo request was attempted; receipt 41000000 remains in the audit trail.",
    );
  });

  it("discloses an in-flight or transport-ambiguous outcome", () => {
    expect(
      apolloCancellationNote({
        receiptId: "41000000-0000-4000-8000-000000000033",
        providerAttemptedPreviously: true,
        providerMaySettle: true,
      }),
    ).toContain("may still settle");
  });

  it("uses pre-dispatch copy only when no provider attempt was authorized", () => {
    expect(
      apolloCancellationNote({
        receiptId: "41000000-0000-4000-8000-000000000034",
      }),
    ).toContain("cancelled before provider dispatch");
  });
});

describe("Apollo search status copy", () => {
  it("keeps a completed replacement honest about an earlier ambiguous call", () => {
    const note = apolloSearchStatusNote({
      receiptId: "41000000-0000-4000-8000-000000000036",
      status: "completed",
      mode: "live",
      attempts: 2,
      candidateCount: 1,
      providerAttemptedPreviously: true,
      providerMaySettle: true,
    });
    expect(note).toContain("current Apollo live attempt");
    expect(note).toContain("may still settle independently");
    expect(note).not.toContain("receipt 41000000 reconciled");
  });

  it("warns while a replacement request is processing", () => {
    expect(
      apolloSearchStatusNote({
        receiptId: "41000000-0000-4000-8000-000000000036",
        status: "processing",
        mode: "live",
        attempts: 2,
        candidateCount: 0,
        providerMaySettle: true,
      }),
    ).toContain("remains flagged for reconciliation");
  });

  it("does not hide a provider attempt behind generic revoked copy", () => {
    expect(
      apolloSearchStatusNote({
        receiptId: "41000000-0000-4000-8000-000000000003",
        status: "revoked",
        mode: "live",
        attempts: 1,
        candidateCount: 0,
        providerAttemptedPreviously: true,
        providerMaySettle: true,
      }),
    ).toContain("may still settle independently");
  });
});

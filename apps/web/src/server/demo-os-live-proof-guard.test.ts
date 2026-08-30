import { describe, expect, it } from "vitest";
import {
  assertSyntheticProofTarget,
  HRMNY_PRODUCTION_PROJECT_REF,
  projectRefFromDatabaseUrl,
  syntheticProofTargetInputFromEnvironment,
  SYNTHETIC_PROOF_CONFIRMATION,
  SYNTHETIC_PROOF_SAFE_RUNTIME_ENV,
} from "./demo-os-live-proof-guard";

const disposableRef = "abcdefghijklmnopqrst";
const now = new Date("2026-08-29T12:00:00.000Z");

function validInput() {
  return {
    databaseUrl: `postgresql://postgres.${disposableRef}:secret@aws-0-eu.pooler.supabase.com:6543/postgres`,
    targetProjectRef: disposableRef,
    expectedProjectRef: disposableRef,
    targetKind: "disposable",
    authorizationReceipt: "approval-receipt-123",
    confirmation: SYNTHETIC_PROOF_CONFIRMATION,
    expiresAt: "2026-08-29T18:00:00.000Z",
    now,
  };
}

describe("synthetic live-proof target guard", () => {
  it("resolves direct and pooler Supabase project references", () => {
    expect(
      projectRefFromDatabaseUrl(
        `postgresql://postgres:secret@db.${disposableRef}.supabase.co:5432/postgres`,
      ),
    ).toBe(disposableRef);
    expect(projectRefFromDatabaseUrl(validInput().databaseUrl)).toBe(
      disposableRef,
    );
  });

  it("rejects a matching pooler-style username on a non-Supabase host", () => {
    expect(() =>
      projectRefFromDatabaseUrl(
        `postgresql://postgres.${disposableRef}:secret@database.example.com:6543/postgres`,
      ),
    ).toThrow("SYNTHETIC_PROOF_PROJECT_REF_UNRESOLVED");
  });

  it("accepts only an allowlisted disposable target with bounded authority", () => {
    expect(assertSyntheticProofTarget(validInput())).toMatchObject({
      targetProjectRef: disposableRef,
      expiresAt: "2026-08-29T18:00:00.000Z",
    });
  });

  it("binds the guard to the exact database URL consumed by the proof", () => {
    expect(
      syntheticProofTargetInputFromEnvironment({
        DATABASE_URL: validInput().databaseUrl,
        HRMNY_PROOF_DATABASE_URL:
          "postgresql://postgres.12345678901234567890:secret@aws-0-eu.pooler.supabase.com:6543/postgres",
      }).databaseUrl,
    ).toBe(validInput().databaseUrl);
  });

  it("forces the live proof onto Postgres with every external provider inert", () => {
    expect(SYNTHETIC_PROOF_SAFE_RUNTIME_ENV).toMatchObject({
      DATABASE_MODE: "postgres",
      LLM_PROVIDER: "mock",
      APOLLO_MODE: "mock",
      N8N_MODE: "mock",
      XERO_MODE: "mock",
      XERO_WRITE_ENABLED: "false",
      OPENROUTER_API_KEY: "",
      APOLLO_API_KEY: "",
      GOOGLE_CHAT_WEBHOOK_URL: "",
    });
  });

  it("hard-refuses the canonical production project", () => {
    expect(() =>
      assertSyntheticProofTarget({
        ...validInput(),
        databaseUrl: `postgresql://postgres.${HRMNY_PRODUCTION_PROJECT_REF}:secret@aws-0-eu.pooler.supabase.com:6543/postgres`,
        targetProjectRef: HRMNY_PRODUCTION_PROJECT_REF,
        expectedProjectRef: HRMNY_PRODUCTION_PROJECT_REF,
      }),
    ).toThrow("SYNTHETIC_PROOF_PRODUCTION_TARGET_FORBIDDEN");
  });

  it.each([
    [
      { expectedProjectRef: "12345678901234567890" },
      "SYNTHETIC_PROOF_PROJECT_REF_NOT_ALLOWLISTED",
    ],
    [
      {
        databaseUrl:
          "postgresql://postgres.12345678901234567890:secret@aws-0-eu.pooler.supabase.com:6543/postgres",
      },
      "SYNTHETIC_PROOF_DATABASE_REF_MISMATCH",
    ],
    [{ targetKind: "shared" }, "SYNTHETIC_PROOF_TARGET_NOT_DISPOSABLE"],
    [{ confirmation: "yes" }, "SYNTHETIC_PROOF_CONFIRMATION_MISMATCH"],
    [
      { authorizationReceipt: "short" },
      "SYNTHETIC_PROOF_AUTHORIZATION_RECEIPT_MISSING",
    ],
    [
      { expiresAt: "2026-08-29T11:59:59.000Z" },
      "SYNTHETIC_PROOF_AUTHORIZATION_EXPIRED",
    ],
    [
      { expiresAt: "2026-08-30T12:00:01.000Z" },
      "SYNTHETIC_PROOF_AUTHORIZATION_TOO_LONG",
    ],
  ])("rejects unsafe input %#", (override, message) => {
    expect(() =>
      assertSyntheticProofTarget({ ...validInput(), ...override }),
    ).toThrow(message);
  });
});

import { IntegrationMisconfiguredError } from "../types";

export type RegulatedAdapterMode = "mock" | "live";

export type RegulatedAdapterConfig<TProvider> = {
  mode?: RegulatedAdapterMode;
  /** A licensed/provider-specific implementation injected by the application. */
  provider?: TProvider;
};

export type WpsSubmissionRequest = {
  employerCode: string;
  salaryMonth: string;
  fileName: string;
  sifContents: string;
  idempotencyKey: string;
  channel: "bank" | "exchange";
};

export type WpsSubmission = {
  providerSubmissionId: string;
  status: "accepted" | "processing" | "rejected";
};

export interface WpsSubmissionAdapter {
  submitSif(input: WpsSubmissionRequest): Promise<WpsSubmission>;
  getSubmission(providerSubmissionId: string): Promise<WpsSubmission>;
}

export type CorporateCard = {
  providerCardId: string;
  employeeExternalId: string;
  lastFour: string;
  currency: string;
  status: "active" | "frozen" | "closed";
};

export type CorporateCardTransaction = {
  providerTransactionId: string;
  providerCardId: string;
  occurredAt: string;
  merchant: string;
  amount: string;
  currency: string;
  status: "pending" | "settled" | "reversed";
};

export interface CorporateCardsAdapter {
  listCards(companyExternalId: string): Promise<CorporateCard[]>;
  listTransactions(input: {
    companyExternalId: string;
    from: string;
    to: string;
  }): Promise<CorporateCardTransaction[]>;
}

export type InsurancePolicy = {
  providerPolicyId: string;
  policyNumber: string;
  kind: "health" | "motor";
  effectiveFrom: string;
  effectiveTo: string;
  status: "active" | "expired" | "cancelled";
};

export type InsuranceEndorsementRequest = {
  providerPolicyId: string;
  externalReference: string;
  type: "add_member" | "remove_member" | "update_member";
  memberExternalId: string;
};

export type InsuranceEndorsement = {
  providerEndorsementId: string;
  status: "submitted" | "processing" | "completed" | "rejected";
};

export interface InsuranceAdapter {
  listPolicies(companyExternalId: string): Promise<InsurancePolicy[]>;
  submitEndorsement(
    input: InsuranceEndorsementRequest,
  ): Promise<InsuranceEndorsement>;
  getEndorsement(providerEndorsementId: string): Promise<InsuranceEndorsement>;
}

export type BiometricDevice = {
  providerDeviceId: string;
  name: string;
  location: string;
  status: "online" | "offline";
};

export type BiometricAttendanceEvent = {
  providerEventId: string;
  providerDeviceId: string;
  employeeExternalId: string;
  occurredAt: string;
  direction: "in" | "out";
  /** Reference only; raw biometric templates never enter Hrmny OS. */
  providerVerificationReference: string;
};

export interface BiometricAttendanceAdapter {
  listDevices(companyExternalId: string): Promise<BiometricDevice[]>;
  pullAttendanceEvents(input: {
    companyExternalId: string;
    since: string;
    until?: string;
  }): Promise<BiometricAttendanceEvent[]>;
}

function segment(value: string, field: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
}

function configured<T>(
  integration: string,
  config: RegulatedAdapterConfig<T>,
  mock: () => T,
): T {
  if (config.mode !== "live") return mock();
  if (config.provider) return config.provider;
  throw new IntegrationMisconfiguredError(
    integration,
    "Live mode requires an explicitly injected licensed provider implementation",
  );
}

export function createWpsMock(): WpsSubmissionAdapter {
  return {
    async submitSif(input) {
      segment(input.employerCode, "employerCode");
      segment(input.sifContents, "sifContents");
      return {
        providerSubmissionId: `mock-wps-${segment(input.idempotencyKey, "idempotencyKey")}`,
        status: "accepted",
      };
    },
    async getSubmission(providerSubmissionId) {
      return {
        providerSubmissionId: segment(
          providerSubmissionId,
          "providerSubmissionId",
        ),
        status: "accepted",
      };
    },
  };
}

export function createWpsAdapter(
  config: RegulatedAdapterConfig<WpsSubmissionAdapter> = {},
): WpsSubmissionAdapter {
  return configured("wps", config, createWpsMock);
}

export function createCorporateCardsMock(): CorporateCardsAdapter {
  return {
    async listCards(companyExternalId) {
      const company = segment(companyExternalId, "companyExternalId");
      return [
        {
          providerCardId: `mock-card-${company}`,
          employeeExternalId: "mock-employee-001",
          lastFour: "4242",
          currency: "AED",
          status: "active",
        },
      ];
    },
    async listTransactions(input) {
      const company = segment(input.companyExternalId, "companyExternalId");
      return [
        {
          providerTransactionId: `mock-card-txn-${company}-001`,
          providerCardId: `mock-card-${company}`,
          occurredAt: "2026-07-01T08:00:00.000Z",
          merchant: "Mock Office Supplies",
          amount: "125.00",
          currency: "AED",
          status: "settled",
        },
      ];
    },
  };
}

export function createCorporateCardsAdapter(
  config: RegulatedAdapterConfig<CorporateCardsAdapter> = {},
): CorporateCardsAdapter {
  return configured("corporate_cards", config, createCorporateCardsMock);
}

export function createInsuranceMock(): InsuranceAdapter {
  return {
    async listPolicies(companyExternalId) {
      const company = segment(companyExternalId, "companyExternalId");
      return [
        {
          providerPolicyId: `mock-policy-${company}`,
          policyNumber: `MOCK-${company.toUpperCase()}`,
          kind: "health",
          effectiveFrom: "2026-01-01",
          effectiveTo: "2026-12-31",
          status: "active",
        },
      ];
    },
    async submitEndorsement(input) {
      return {
        providerEndorsementId: `mock-endorsement-${segment(input.externalReference, "externalReference")}`,
        status: "submitted",
      };
    },
    async getEndorsement(providerEndorsementId) {
      return {
        providerEndorsementId: segment(
          providerEndorsementId,
          "providerEndorsementId",
        ),
        status: "submitted",
      };
    },
  };
}

export function createInsuranceAdapter(
  config: RegulatedAdapterConfig<InsuranceAdapter> = {},
): InsuranceAdapter {
  return configured("insurance", config, createInsuranceMock);
}

export function createBiometricAttendanceMock(): BiometricAttendanceAdapter {
  return {
    async listDevices(companyExternalId) {
      const company = segment(companyExternalId, "companyExternalId");
      return [
        {
          providerDeviceId: `mock-biometric-${company}`,
          name: "Mock Dubai Office Device",
          location: "Dubai",
          status: "online",
        },
      ];
    },
    async pullAttendanceEvents(input) {
      const company = segment(input.companyExternalId, "companyExternalId");
      const occurredAt = "2026-07-01T05:00:00.000Z";
      if (
        occurredAt < input.since ||
        (input.until && occurredAt > input.until)
      ) {
        return [];
      }
      return [
        {
          providerEventId: `mock-biometric-event-${company}-001`,
          providerDeviceId: `mock-biometric-${company}`,
          employeeExternalId: "mock-employee-001",
          occurredAt,
          direction: "in",
          providerVerificationReference: "mock-verification-001",
        },
      ];
    },
  };
}

export function createBiometricAttendanceAdapter(
  config: RegulatedAdapterConfig<BiometricAttendanceAdapter> = {},
): BiometricAttendanceAdapter {
  return configured(
    "biometric_attendance",
    config,
    createBiometricAttendanceMock,
  );
}

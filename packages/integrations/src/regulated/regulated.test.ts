import { describe, expect, it } from "vitest";
import { IntegrationMisconfiguredError } from "../types";
import {
  createBiometricAttendanceAdapter,
  createCorporateCardsAdapter,
  createInsuranceAdapter,
  createWpsAdapter,
} from "./index";

describe("regulated provider adapters", () => {
  it("returns deterministic mock records without moving money or biometric data", async () => {
    const request = {
      employerCode: "HRMNY",
      salaryMonth: "2026-07",
      fileName: "hrmny-2026-07.sif",
      sifContents: "mock-sif",
      idempotencyKey: "payroll-2026-07",
      channel: "exchange" as const,
    };
    const wps = createWpsAdapter();
    expect(await wps.submitSif(request)).toEqual(await wps.submitSif(request));

    const cards = createCorporateCardsAdapter();
    expect(await cards.listCards("hrmny")).toEqual(
      await cards.listCards("hrmny"),
    );

    const insurance = createInsuranceAdapter();
    expect(
      await insurance.submitEndorsement({
        providerPolicyId: "mock-policy-hrmny",
        externalReference: "employee-001-add",
        type: "add_member",
        memberExternalId: "employee-001",
      }),
    ).toMatchObject({ status: "submitted" });

    const biometric = createBiometricAttendanceAdapter();
    const events = await biometric.pullAttendanceEvents({
      companyExternalId: "hrmny",
      since: "2026-07-01T00:00:00.000Z",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty("biometricTemplate");
  });

  it.each([
    ["wps", () => createWpsAdapter({ mode: "live" })],
    ["cards", () => createCorporateCardsAdapter({ mode: "live" })],
    ["insurance", () => createInsuranceAdapter({ mode: "live" })],
    ["biometric", () => createBiometricAttendanceAdapter({ mode: "live" })],
  ])("fails loud when %s live provider is not injected", (_name, create) => {
    expect(create).toThrow(IntegrationMisconfiguredError);
  });

  it("uses an explicitly injected provider in live mode", async () => {
    const provider = createWpsAdapter();
    expect(createWpsAdapter({ mode: "live", provider })).toBe(provider);
  });
});

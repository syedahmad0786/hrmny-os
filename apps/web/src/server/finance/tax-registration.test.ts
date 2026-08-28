import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTaxRegistration } from "./tax-registration";

describe("tax registration configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("holds invoice issue when the legal identifier is absent", () => {
    vi.stubEnv("HRMNY_TAX_REGISTRATION_NUMBER", "");
    expect(resolveTaxRegistration()).toEqual({
      trn: null,
      trnStatus: "unknown_held",
    });
  });

  it("returns only the configured identifier", () => {
    vi.stubEnv("HRMNY_TAX_REGISTRATION_NUMBER", " 123456789012345 ");
    expect(resolveTaxRegistration()).toEqual({
      trn: "123456789012345",
      trnStatus: "known",
    });
  });
});

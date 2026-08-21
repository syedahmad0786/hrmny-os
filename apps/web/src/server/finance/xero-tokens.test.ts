import { describe, expect, it } from "vitest";
import {
  signXeroOAuthState,
  verifyXeroOAuthState,
  xeroAccessTokenStillFresh,
} from "./xero-tokens";

describe("xero oauth state", () => {
  it("round-trips a signed employee state", () => {
    const employeeId = "c0000000-0000-4000-8000-000000000011";
    const state = signXeroOAuthState(employeeId);
    expect(verifyXeroOAuthState(state)).toEqual({ employeeId });
  });

  it("rejects tampered state", () => {
    const state = signXeroOAuthState("c0000000-0000-4000-8000-000000000011");
    expect(() => verifyXeroOAuthState(state + "x")).toThrow(/signature|Invalid/);
  });
});

describe("xeroAccessTokenStillFresh", () => {
  it("treats tokens with >60s remaining as fresh", () => {
    expect(
      xeroAccessTokenStillFresh(
        new Date(Date.now() + 5 * 60_000).toISOString(),
      ),
    ).toBe(true);
  });

  it("treats near-expiry or missing expiry as not fresh", () => {
    expect(
      xeroAccessTokenStillFresh(new Date(Date.now() + 30_000).toISOString()),
    ).toBe(false);
    expect(xeroAccessTokenStillFresh(undefined)).toBe(false);
    expect(xeroAccessTokenStillFresh("not-a-date")).toBe(false);
  });
});

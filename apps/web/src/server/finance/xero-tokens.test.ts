import { beforeEach, describe, expect, it } from "vitest";
import {
  signXeroOAuthState,
  verifyXeroOAuthState,
  xeroAccessTokenStillFresh,
} from "./xero-tokens";

describe("xero oauth state", () => {
  beforeEach(() => {
    process.env.XERO_OAUTH_STATE_SECRET = "x".repeat(32);
  });

  it("round-trips a signed employee state", () => {
    const employeeId = "c0000000-0000-4000-8000-000000000011";
    const state = signXeroOAuthState(employeeId);
    expect(verifyXeroOAuthState(state)).toEqual({ employeeId });
  });

  it("rejects tampered state", () => {
    const state = signXeroOAuthState("c0000000-0000-4000-8000-000000000011");
    expect(() => verifyXeroOAuthState(state + "x")).toThrow(/signature|Invalid/);
  });

  it("does not reuse the cron secret for OAuth state", () => {
    const previousCronSecret = process.env.CRON_SECRET;
    delete process.env.XERO_OAUTH_STATE_SECRET;
    process.env.CRON_SECRET = "c".repeat(32);
    try {
      expect(() =>
        signXeroOAuthState("c0000000-0000-4000-8000-000000000011"),
      ).toThrow(/XERO_OAUTH_STATE_SECRET/);
    } finally {
      if (previousCronSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = previousCronSecret;
    }
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

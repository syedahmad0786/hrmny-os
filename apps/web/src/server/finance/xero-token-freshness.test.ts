import { describe, expect, it } from "vitest";
import { xeroAccessTokenStillFresh } from "./xero-tokens";

describe("xeroAccessTokenStillFresh", () => {
  it("treats missing or invalid expiry as not fresh", () => {
    expect(xeroAccessTokenStillFresh(undefined)).toBe(false);
    expect(xeroAccessTokenStillFresh("not-a-date")).toBe(false);
  });

  it("requires more than 60s remaining", () => {
    expect(
      xeroAccessTokenStillFresh(new Date(Date.now() + 30_000).toISOString()),
    ).toBe(false);
    expect(
      xeroAccessTokenStillFresh(new Date(Date.now() + 120_000).toISOString()),
    ).toBe(true);
  });
});

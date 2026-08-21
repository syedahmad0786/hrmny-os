import { describe, expect, it } from "vitest";
import {
  signXeroOAuthState,
  verifyXeroOAuthState,
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

import { describe, expect, it } from "vitest";
import {
  createEmailVerificationAdapter,
  createEmailVerificationMock,
  createHunterVerificationLive,
  createNeverBounceVerificationLive,
} from "./verification";

describe("EmailVerificationAdapter (Hunter / NeverBounce-shaped)", () => {
  it("mock verifies a clean address and rejects an invalid one", async () => {
    const v = createEmailVerificationMock();
    expect((await v.verify("sara@acme.example")).emailVerified).toBe(true);
    const bad = await v.verify("nope@example.invalid");
    expect(bad.emailVerified).toBe(false);
    expect(bad.verdict).toBe("invalid");
  });

  it("never invents a verdict — ambiguous stays unknown + unverified", async () => {
    const v = createEmailVerificationMock("neverbounce");
    const res = await v.verify("unknown-person@acme.example");
    expect(res.verdict).toBe("unknown");
    expect(res.emailVerified).toBe(false);
    expect(res.provider).toBe("neverbounce");
  });

  it("factory defaults to mock hunter without HUNTER_MODE=live", () => {
    const v = createEmailVerificationAdapter();
    expect(v.mode).toBe("mock");
    expect(v.provider).toBe("hunter");
  });

  it("NeverBounce live does not require HUNTER_MODE", () => {
    const prevH = process.env.HUNTER_MODE;
    const prevN = process.env.NEVERBOUNCE_MODE;
    const prevK = process.env.NEVERBOUNCE_API_KEY;
    delete process.env.HUNTER_MODE;
    process.env.NEVERBOUNCE_MODE = "live";
    process.env.NEVERBOUNCE_API_KEY = "nb-test-key";
    try {
      const v = createEmailVerificationAdapter({ provider: "neverbounce" });
      expect(v.provider).toBe("neverbounce");
      expect(v.mode).toBe("live");
    } finally {
      if (prevH !== undefined) process.env.HUNTER_MODE = prevH;
      else delete process.env.HUNTER_MODE;
      if (prevN !== undefined) process.env.NEVERBOUNCE_MODE = prevN;
      else delete process.env.NEVERBOUNCE_MODE;
      if (prevK !== undefined) process.env.NEVERBOUNCE_API_KEY = prevK;
      else delete process.env.NEVERBOUNCE_API_KEY;
    }
  });

  it("EMAIL_VERIFICATION_PROVIDER selects NeverBounce mock without Hunter live", () => {
    const prev = process.env.EMAIL_VERIFICATION_PROVIDER;
    const prevH = process.env.HUNTER_MODE;
    delete process.env.HUNTER_MODE;
    process.env.EMAIL_VERIFICATION_PROVIDER = "neverbounce";
    try {
      const v = createEmailVerificationAdapter();
      expect(v.provider).toBe("neverbounce");
      expect(v.mode).toBe("mock");
    } finally {
      if (prev !== undefined) process.env.EMAIL_VERIFICATION_PROVIDER = prev;
      else delete process.env.EMAIL_VERIFICATION_PROVIDER;
      if (prevH !== undefined) process.env.HUNTER_MODE = prevH;
    }
  });

  it("live providers fail loud without their key", () => {
    const prevH = process.env.HUNTER_API_KEY;
    const prevN = process.env.NEVERBOUNCE_API_KEY;
    delete process.env.HUNTER_API_KEY;
    delete process.env.NEVERBOUNCE_API_KEY;
    try {
      expect(() => createHunterVerificationLive({})).toThrowError(
        /HUNTER_API_KEY missing/,
      );
      expect(() => createNeverBounceVerificationLive({})).toThrowError(
        /NEVERBOUNCE_API_KEY missing/,
      );
    } finally {
      if (prevH !== undefined) process.env.HUNTER_API_KEY = prevH;
      if (prevN !== undefined) process.env.NEVERBOUNCE_API_KEY = prevN;
    }
  });
});

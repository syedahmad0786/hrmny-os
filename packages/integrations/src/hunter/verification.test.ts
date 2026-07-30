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

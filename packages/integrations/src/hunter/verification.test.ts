import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmailVerificationAdapter,
  createEmailVerificationMock,
  createHunterVerificationLive,
  createNeverBounceVerificationLive,
} from "./verification";

describe("EmailVerificationAdapter (Hunter / NeverBounce-shaped)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

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

  it("a connected verification key does not activate live mode", () => {
    vi.stubEnv("HUNTER_API_KEY", "connected-not-activated");
    vi.stubEnv("HUNTER_MODE", "");
    expect(createEmailVerificationAdapter().mode).toBe("mock");
  });

  it("uses the versioned official NeverBounce v4 single-check contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ result: "valid", status: "success" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const verifier = createNeverBounceVerificationLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: true,
    });
    await verifier.verify("person@example.com");

    const requestUrl = fetchMock.mock.calls[0]?.[0];
    expect(requestUrl).toBeInstanceOf(URL);
    expect(String(requestUrl)).toContain(
      "https://api.neverbounce.com/v4/single/check",
    );
  });

  it("blocks paid verification before making a provider request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const hunter = createHunterVerificationLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });
    const neverbounce = createNeverBounceVerificationLive({
      mode: "live",
      apiKey: "test-key",
      allowPaidOperations: false,
    });
    await expect(hunter.verify("person@example.com")).rejects.toThrow(
      /HUNTER_ALLOW_PAID_OPERATIONS=true/,
    );
    await expect(neverbounce.verify("person@example.com")).rejects.toThrow(
      /NEVERBOUNCE_ALLOW_PAID_OPERATIONS=true/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

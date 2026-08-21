import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@hrmny/integrations", () => ({
  createApolloLive: vi.fn(() => ({
    searchCompanies: vi.fn(async () => []),
  })),
  createHunterLive: vi.fn(() => ({
    verifyEmail: vi.fn(async () => ({
      emailVerified: false,
      verdict: "unknown",
      provider: "hunter",
    })),
  })),
}));

import { createApolloLive, createHunterLive } from "@hrmny/integrations";
import { probeIntegrationApiKey } from "./probe-api-key";

describe("probeIntegrationApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("probes apollo via company search", async () => {
    const result = await probeIntegrationApiKey("apollo", "apollo-test-key");
    expect(result).toEqual({ ok: true });
    expect(createApolloLive).toHaveBeenCalledWith({
      mode: "live",
      apiKey: "apollo-test-key",
    });
  });

  it("probes hunter via email verify", async () => {
    const result = await probeIntegrationApiKey("hunter", "hunter-test-key");
    expect(result).toEqual({ ok: true });
    expect(createHunterLive).toHaveBeenCalledWith({
      mode: "live",
      apiKey: "hunter-test-key",
    });
  });

  it("returns failure reason when apollo throws", async () => {
    vi.mocked(createApolloLive).mockReturnValueOnce({
      searchCompanies: vi.fn(async () => {
        throw new Error("Company search failed: HTTP 401");
      }),
      enrichPerson: vi.fn(),
    } as never);
    const result = await probeIntegrationApiKey("apollo", "bad-key-xx");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/401/);
    }
  });

  it("accepts bayzat without network probe", async () => {
    await expect(
      probeIntegrationApiKey("bayzat", "bayzat-key"),
    ).resolves.toEqual({ ok: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeIntegrationApiKey } from "./probe-api-key";

describe("probeIntegrationApiKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("probes Apollo through the free auth health endpoint", async () => {
    const result = await probeIntegrationApiKey("apollo", "apollo-test-key");
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.apollo.io/api/v1/auth/health",
      expect.objectContaining({
        headers: { "x-api-key": "apollo-test-key" },
      }),
    );
  });

  it("probes Hunter through the free account endpoint", async () => {
    const result = await probeIntegrationApiKey("hunter", "hunter-test-key");
    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.hunter.io/v2/account",
      expect.objectContaining({
        headers: { "X-API-KEY": "hunter-test-key" },
      }),
    );
  });

  it("returns failure reason when apollo throws", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
    const result = await probeIntegrationApiKey("apollo", "bad-key-xx");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/401/);
    }
  });

  it("does not call a provider when the local caller explicitly allows configured mock mode", async () => {
    vi.stubEnv("N8N_MODE", "mock");
    const result = await probeIntegrationApiKey("n8n", "n8n-test-key", {
      allowConfiguredMock: true,
    });
    expect(result).toEqual({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses to mark Bayzat connected without a verified API contract", async () => {
    await expect(
      probeIntegrationApiKey("bayzat", "bayzat-key"),
    ).resolves.toMatchObject({
      ok: false,
      reason: expect.stringContaining("UNVERIFIED_INTERFACE"),
    });
  });
});

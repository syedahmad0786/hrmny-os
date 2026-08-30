import { afterEach, beforeEach, vi } from "vitest";

const forbiddenFetch: typeof globalThis.fetch = async (input) => {
  const raw =
    typeof input === "string" || input instanceof URL
      ? String(input)
      : input.url;
  let host = "external";
  try {
    host = new URL(raw).hostname || host;
  } catch {
    // Keep errors secret-safe: never echo the complete URL or request body.
  }
  throw new Error(`LIVE_NETWORK_FORBIDDEN_IN_ORDINARY_TEST:${host}`);
};

function applyDeterministicEnvironment() {
  vi.stubEnv("LLM_PROVIDER", "mock");
  vi.stubEnv("OPENROUTER_LIVE_SMOKE", "0");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("OPENROUTER_PRIVILEGED_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubGlobal("fetch", forbiddenFetch);
}

applyDeterministicEnvironment();
beforeEach(applyDeterministicEnvironment);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

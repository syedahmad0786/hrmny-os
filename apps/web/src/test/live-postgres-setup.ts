import {
  assertSyntheticProofTarget,
  syntheticProofTargetInputFromEnvironment,
  SYNTHETIC_PROOF_SAFE_RUNTIME_ENV,
} from "../server/demo-os-live-proof-guard";

// Validate the actual DATABASE_URL again inside Vitest so the guarded command
// cannot be bypassed by invoking the live config directly.
assertSyntheticProofTarget(syntheticProofTargetInputFromEnvironment());

for (const [key, value] of Object.entries(SYNTHETIC_PROOF_SAFE_RUNTIME_ENV)) {
  process.env[key] = value;
}

globalThis.fetch = async (input) => {
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
  throw new Error(`LIVE_NETWORK_FORBIDDEN_IN_POSTGRES_PROOF:${host}`);
};

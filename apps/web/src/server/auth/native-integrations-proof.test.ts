import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import {
  NATIVE_INTEGRATIONS_AUDIENCE,
  verifyNativeIntegrationsProof,
} from "./native-integrations-proof";

const secret = "native-integrations-test-secret-0001";
const nonce = "A".repeat(43);

function mint(overrides: Record<string, unknown> = {}, now = Date.now()) {
  const payload = Buffer.from(
    JSON.stringify({
      aud: NATIVE_INTEGRATIONS_AUDIENCE,
      p: "developer@hrmny.co",
      iss: "https://accounts.google.com",
      sub: "123456789",
      nonce,
      iat: now,
      exp: now + 10 * 60_000,
      ...overrides,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

it("accepts only an exact audience, Google identity, nonce, and lifetime", () => {
  const now = Date.now();
  expect(
    verifyNativeIntegrationsProof(mint({}, now), nonce, secret, now),
  ).toMatchObject({
    p: "developer@hrmny.co",
    sub: "123456789",
    nonce,
  });
  expect(
    verifyNativeIntegrationsProof(
      mint({ aud: "other" }, now),
      nonce,
      secret,
      now,
    ),
  ).toBeNull();
  expect(
    verifyNativeIntegrationsProof(
      mint({ iss: "https://other.example" }, now),
      nonce,
      secret,
      now,
    ),
  ).toBeNull();
  expect(
    verifyNativeIntegrationsProof(mint({}, now), "B".repeat(43), secret, now),
  ).toBeNull();
  expect(
    verifyNativeIntegrationsProof(
      mint({ exp: now - 1 }, now),
      nonce,
      secret,
      now,
    ),
  ).toBeNull();
});

it("rejects tampering and weak verification keys", () => {
  const proof = mint();
  const [payload, signature] = proof.split(".");
  expect(
    verifyNativeIntegrationsProof(`${payload}x.${signature}`, nonce, secret),
  ).toBeNull();
  expect(verifyNativeIntegrationsProof(proof, nonce, "short")).toBeNull();
});

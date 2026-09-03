import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIntegrationReceiptMemory } from "./integrations/inbox";
import {
  googleChatEndpoint,
  handleGoogleChatRequest,
  verifyGoogleChatJwt,
} from "./google-chat";

vi.mock("./auth/session", () => ({
  resolveActiveStaffByEmail: vi.fn(async (email: string) =>
    email === "operator@hrmny.co"
      ? {
          employeeId: "c0000000-0000-4000-8000-000000000001",
          email,
          displayName: "Operator",
          roles: ["partner"],
          permissions: [],
          actorType: "staff",
          clientId: null,
        }
      : null,
  ),
  sessionCanViewMargin: vi.fn(() => true),
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
});
const exportedPublicKey = publicKey.export({ format: "jwk" });
if (!exportedPublicKey.n || !exportedPublicKey.e) {
  throw new Error("RSA test key is incomplete");
}
const publicJwk = {
  alg: "RS256" as const,
  e: exportedPublicKey.e,
  kid: "test-key",
  kty: "RSA" as const,
  n: exportedPublicKey.n,
  use: "sig" as const,
};
const audience =
  "https://hrmny-os.vercel.app/api/integrations/google-chat/events";
const now = 1_800_000_000;

beforeEach(() => resetIntegrationReceiptMemory());
afterEach(() => vi.unstubAllGlobals());

function token(overrides: Record<string, unknown> = {}) {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(
    JSON.stringify({
      aud: audience,
      email: "chat@system.gserviceaccount.com",
      email_verified: true,
      exp: now + 300,
      iat: now - 10,
      iss: "https://accounts.google.com",
      ...overrides,
    }),
  ).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

describe("Google Chat request verification", () => {
  it("accepts only the exact endpoint audience and Google Chat service identity", () => {
    expect(verifyGoogleChatJwt(token(), audience, [publicJwk], now).email).toBe(
      "chat@system.gserviceaccount.com",
    );
    expect(() =>
      verifyGoogleChatJwt(token(), `${audience}/wrong`, [publicJwk], now),
    ).toThrow(/AUDIENCE/);
    expect(() =>
      verifyGoogleChatJwt(
        token({ email: "attacker@example.com" }),
        audience,
        [publicJwk],
        now,
      ),
    ).toThrow();
  });

  it("rejects expired and tampered tokens", () => {
    expect(() =>
      verifyGoogleChatJwt(token({ exp: now - 60 }), audience, [publicJwk], now),
    ).toThrow(/TIME/);
    const parts = token().split(".");
    const signature = Buffer.from(parts[2]!, "base64url");
    signature[0] = (signature[0] ?? 0) ^ 1;
    const tampered = `${parts[0]}.${parts[1]}.${signature.toString("base64url")}`;
    expect(() =>
      verifyGoogleChatJwt(tampered, audience, [publicJwk], now),
    ).toThrow(/SIGNATURE/);
    expect(() =>
      verifyGoogleChatJwt("a".repeat(16_385), audience, [publicJwk], now),
    ).toThrow(/INVALID/);
  });

  it("publishes the exact Google Chat endpoint", () => {
    expect(googleChatEndpoint("https://hrmny-os.vercel.app/")).toBe(audience);
  });

  it("accepts and replays one signed staff onboarding event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [publicJwk] })),
    );
    const liveNow = Math.floor(Date.now() / 1_000);
    const body = JSON.stringify({
      type: "ADDED_TO_SPACE",
      eventTime: "2026-09-03T12:00:00Z",
      space: { name: "spaces/AAAA", displayName: "Sales" },
      user: { email: "operator@hrmny.co", displayName: "Operator" },
    });
    const send = () =>
      handleGoogleChatRequest(
        new Request(audience, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token({ exp: liveNow + 300, iat: liveNow - 10 })}`,
            "content-type": "application/json",
          },
          body,
        }),
      );

    const first = await send();
    const replay = await send();
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    const replayPayload = await replay.json();
    expect(firstPayload).toEqual(replayPayload);
    expect(replayPayload).toMatchObject({
      text: expect.stringContaining("HRMNY is connected"),
    });
  });
});

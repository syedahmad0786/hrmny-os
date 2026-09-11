import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, expect, it, vi } from "vitest";
import { getSupabasePublicConfig } from "@/lib/supabase-config";
import { resolveSupabaseUser } from "./session";
import { verifyNativeIntegrationsSession } from "./native-integrations-session";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase-config", () => ({ getSupabasePublicConfig: vi.fn() }));
vi.mock("./session", () => ({ resolveSupabaseUser: vi.fn() }));

const secret = "native-integrations-test-secret-0001";
const nonce = "A".repeat(43);
const getUser = vi.fn();

function proof(principal = "developer@hrmny.co", subject = "123456789") {
  const now = Date.now();
  const payload = Buffer.from(
    JSON.stringify({
      aud: "hrmny-os-integrations",
      p: principal,
      iss: "https://accounts.google.com",
      sub: subject,
      nonce,
      iat: now,
      exp: now + 10 * 60_000,
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSupabasePublicConfig).mockReturnValue({
    url: "https://supabase.example",
    key: "publishable",
  });
  vi.mocked(createClient).mockReturnValue({ auth: { getUser } } as never);
  vi.mocked(resolveSupabaseUser).mockResolvedValue({
    employeeId: "11111111-1111-4111-8111-111111111111",
    email: "developer@hrmny.co",
    displayName: "Developer",
    roles: [],
    permissions: [],
    actorType: "staff",
    clientId: null,
  });
  getUser.mockResolvedValue({
    data: {
      user: {
        email: "developer@hrmny.co",
        identities: [
          {
            provider: "google",
            identity_id: "123456789",
            identity_data: {
              sub: "123456789",
              iss: "https://accounts.google.com",
            },
          },
        ],
      },
    },
    error: null,
  });
});

it("accepts the exact active staff principal and Google provider subject", async () => {
  await expect(
    verifyNativeIntegrationsSession({
      accessToken: "supabase-access",
      proof: proof(),
      nonce,
      secret,
    }),
  ).resolves.toEqual({
    ok: true,
    employeeId: "11111111-1111-4111-8111-111111111111",
    principal: "developer@hrmny.co",
  });
});

it("denies another Google subject, another principal, and portal actors", async () => {
  await expect(
    verifyNativeIntegrationsSession({
      accessToken: "supabase-access",
      proof: proof("developer@hrmny.co", "987654321"),
      nonce,
      secret,
    }),
  ).resolves.toEqual({ ok: false });

  getUser.mockResolvedValueOnce({
    data: {
      user: {
        email: "other@hrmny.co",
        identities: [
          {
            provider: "google",
            identity_id: "123456789",
            identity_data: { sub: "123456789" },
          },
        ],
      },
    },
    error: null,
  });
  await expect(
    verifyNativeIntegrationsSession({
      accessToken: "supabase-access",
      proof: proof(),
      nonce,
      secret,
    }),
  ).resolves.toEqual({ ok: false });

  vi.mocked(resolveSupabaseUser).mockResolvedValueOnce({
    employeeId: "22222222-2222-4222-8222-222222222222",
    email: "developer@hrmny.co",
    displayName: "Portal",
    roles: [],
    permissions: [],
    actorType: "portal",
    clientId: "33333333-3333-4333-8333-333333333333",
  });
  await expect(
    verifyNativeIntegrationsSession({
      accessToken: "supabase-access",
      proof: proof(),
      nonce,
      secret,
    }),
  ).resolves.toEqual({ ok: false });
});

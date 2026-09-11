import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const NATIVE_INTEGRATIONS_AUDIENCE = "hrmny-os-integrations";
export const NATIVE_INTEGRATIONS_NONCE = /^[A-Za-z0-9_-]{43}$/;

const nativeIntegrationsClaims = z
  .object({
    aud: z.literal(NATIVE_INTEGRATIONS_AUDIENCE),
    p: z
      .string()
      .max(320)
      .regex(/^[^@\s]+@hrmny\.co$/)
      .refine((value) => value === value.toLowerCase()),
    iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
    sub: z.string().regex(/^[0-9]{1,255}$/),
    nonce: z.string().regex(NATIVE_INTEGRATIONS_NONCE),
    iat: z.number().int(),
    exp: z.number().int(),
  })
  .strict();

export type NativeIntegrationsClaims = z.infer<typeof nativeIntegrationsClaims>;

export function verifyNativeIntegrationsProof(
  proof: string,
  nonce: string,
  secret: string,
  nowMs = Date.now(),
): NativeIntegrationsClaims | null {
  if (
    secret.length < 32 ||
    proof.length > 8192 ||
    !NATIVE_INTEGRATIONS_NONCE.test(nonce)
  )
    return null;
  const dot = proof.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = proof.slice(0, dot);
  const signature = proof.slice(dot + 1);
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = nativeIntegrationsClaims.safeParse(parsed);
  if (!result.success) return null;
  if (
    result.data.nonce !== nonce ||
    result.data.iat > nowMs + 30_000 ||
    result.data.exp < nowMs ||
    result.data.exp - result.data.iat > 10 * 60_000
  )
    return null;
  return result.data;
}

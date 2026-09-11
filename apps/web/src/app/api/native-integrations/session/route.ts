import { NextResponse } from "next/server";
import { z } from "zod";
import { NATIVE_INTEGRATIONS_NONCE } from "@/server/auth/native-integrations-proof";
import { verifyNativeIntegrationsSession } from "@/server/auth/native-integrations-session";

const requestBody = z
  .object({
    proof: z.string().min(1).max(8192),
    nonce: z.string().regex(NATIVE_INTEGRATIONS_NONCE),
  })
  .strict();

const response = (body: object, status: number) =>
  NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });

export async function POST(request: Request) {
  const secret = process.env.NATIVE_INTEGRATIONS_BRIDGE_SECRET?.trim();
  if (!secret || secret.length < 32)
    return response({ error: "bridge_not_configured" }, 503);
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (!match) return response({ error: "unauthenticated" }, 401);
  let body: z.infer<typeof requestBody>;
  try {
    body = requestBody.parse(await request.json());
  } catch {
    return response({ error: "invalid_request" }, 400);
  }
  const result = await verifyNativeIntegrationsSession({
    accessToken: match[1]!,
    proof: body.proof,
    nonce: body.nonce,
    secret,
  });
  if (!result.ok) return response({ error: "identity_mismatch" }, 403);
  return response(result, 200);
}

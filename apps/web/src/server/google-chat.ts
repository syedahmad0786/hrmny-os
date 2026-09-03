import {
  createPublicKey,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";
import { z } from "zod";
import {
  resolveActiveStaffByEmail,
  sessionCanViewMargin,
} from "./auth/session";
import {
  completeIntegrationReceipt,
  hashIntegrationPayload,
  recordIntegrationReceipt,
} from "./integrations/inbox";
import { createCaller } from "./trpc/root";
import { getOrCreateExternalChatThread } from "./trpc/chat-router";

const GOOGLE_CHAT_EMAIL = "chat@system.gserviceaccount.com";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const MAX_BODY_BYTES = 256_000;
const MAX_JWT_CHARS = 16_384;

const jwtHeaderSchema = z
  .object({ alg: z.literal("RS256"), kid: z.string().min(1).max(200) })
  .passthrough();
const jwtClaimsSchema = z
  .object({
    aud: z.union([z.string(), z.array(z.string())]),
    email: z.literal(GOOGLE_CHAT_EMAIL),
    email_verified: z.union([z.literal(true), z.literal("true")]),
    exp: z.number().int(),
    iat: z.number().int(),
    iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  })
  .passthrough();
const jwkSchema = z
  .object({
    alg: z.literal("RS256").optional(),
    e: z.string().min(1),
    kid: z.string().min(1),
    kty: z.literal("RSA"),
    n: z.string().min(1),
    use: z.literal("sig").optional(),
  })
  .passthrough();

const googleChatEventSchema = z
  .object({
    type: z.string().min(1).max(80),
    eventTime: z.string().max(80).optional(),
    space: z
      .object({
        name: z.string().min(1).max(500),
        displayName: z.string().max(200).optional(),
      })
      .passthrough(),
    user: z
      .object({
        email: z.string().email().max(320),
        displayName: z.string().max(200).optional(),
      })
      .passthrough(),
    message: z
      .object({
        name: z.string().min(1).max(500),
        text: z.string().max(8_000).optional(),
        argumentText: z.string().max(8_000).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type GoogleJwk = z.infer<typeof jwkSchema>;
type GoogleJwtClaims = z.infer<typeof jwtClaimsSchema>;
let jwksCache: { expiresAt: number; keys: GoogleJwk[] } | undefined;

function decodeJsonSegment(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("JWT_INVALID");
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    throw new Error("JWT_INVALID");
  }
}

/** Verify a Google-signed Chat request without adding a JWT dependency. */
export function verifyGoogleChatJwt(
  token: string,
  audience: string,
  keys: GoogleJwk[],
  nowSeconds = Math.floor(Date.now() / 1_000),
): GoogleJwtClaims {
  if (token.length > MAX_JWT_CHARS) throw new Error("JWT_INVALID");
  const segments = token.split(".");
  if (segments.length !== 3) throw new Error("JWT_INVALID");
  const [encodedHeader, encodedPayload, encodedSignature] = segments as [
    string,
    string,
    string,
  ];
  const header = jwtHeaderSchema.parse(decodeJsonSegment(encodedHeader));
  const claims = jwtClaimsSchema.parse(decodeJsonSegment(encodedPayload));
  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw new Error("JWT_KEY_NOT_FOUND");
  if (
    !verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
      createPublicKey({ key: key as JsonWebKey, format: "jwk" }),
      Buffer.from(encodedSignature, "base64url"),
    )
  ) {
    throw new Error("JWT_SIGNATURE_INVALID");
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(audience)) throw new Error("JWT_AUDIENCE_INVALID");
  if (claims.exp < nowSeconds - 30 || claims.iat > nowSeconds + 60) {
    throw new Error("JWT_TIME_INVALID");
  }
  return claims;
}

async function googleJwks(forceRefresh = false): Promise<GoogleJwk[]> {
  if (!forceRefresh && jwksCache && jwksCache.expiresAt > Date.now()) {
    return jwksCache.keys;
  }
  const response = await fetch(GOOGLE_JWKS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("GOOGLE_JWKS_UNAVAILABLE");
  const parsed = z
    .object({ keys: z.array(jwkSchema).min(1) })
    .parse(await response.json());
  jwksCache = { expiresAt: Date.now() + 5 * 60_000, keys: parsed.keys };
  return parsed.keys;
}

async function verifyGoogleChatBearer(
  authorization: string | null,
  audience: string,
): Promise<void> {
  if ((authorization?.length ?? 0) > MAX_JWT_CHARS + 7) {
    throw new Error("JWT_INVALID");
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization?.trim() ?? "");
  if (!match) throw new Error("JWT_REQUIRED");
  const token = match[1]!;
  const header = jwtHeaderSchema.parse(
    decodeJsonSegment(token.split(".")[0] ?? ""),
  );
  let keys = await googleJwks();
  if (!keys.some((key) => key.kid === header.kid)) {
    keys = await googleJwks(true);
  }
  verifyGoogleChatJwt(token, audience, keys);
}

function responseText(text: string, appOrigin: string): string {
  const suffix = `\n\nOpen HRMNY: ${appOrigin}/chat`;
  return `${text.trim().slice(0, Math.max(1, 4_000 - suffix.length))}${suffix}`;
}

export function googleChatEndpoint(appOrigin: string): string {
  return `${appOrigin.replace(/\/$/, "")}/api/integrations/google-chat/events`;
}

export async function handleGoogleChatRequest(
  request: Request,
): Promise<Response> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const url = new URL(request.url);
  const audience =
    process.env.GOOGLE_CHAT_AUDIENCE?.trim() || `${url.origin}${url.pathname}`;
  try {
    await verifyGoogleChatBearer(
      request.headers.get("authorization"),
      audience,
    );
  } catch {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > MAX_BODY_BYTES) {
    return Response.json({ error: "payload_too_large" }, { status: 413 });
  }
  const parsed = (() => {
    try {
      return googleChatEventSchema.safeParse(JSON.parse(rawBody));
    } catch {
      return null;
    }
  })();
  if (!parsed?.success) {
    return Response.json({ error: "invalid_event" }, { status: 400 });
  }
  const event = parsed.data;

  let user;
  try {
    user = await resolveActiveStaffByEmail(event.user.email);
  } catch {
    return Response.json(
      { error: "staff_directory_unavailable" },
      { status: 503 },
    );
  }
  if (!user)
    return Response.json({ error: "staff_access_denied" }, { status: 403 });

  const externalEventId =
    event.message?.name ??
    `${event.type}:${event.space.name}:${
      event.eventTime ?? hashIntegrationPayload(rawBody).slice(0, 32)
    }`;
  let receipt;
  try {
    receipt = await recordIntegrationReceipt({
      provider: "google-chat",
      externalEventId,
      operation: event.type,
      rawBody,
      status: "processing",
      ownerEmployeeId: user.employeeId,
      payload: {
        space: event.space.name,
        user: user.employeeId,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error && error.message.includes("PAYLOAD_MISMATCH")
            ? "event_conflict"
            : "receipt_unavailable",
      },
      {
        status:
          error instanceof Error && error.message.includes("PAYLOAD_MISMATCH")
            ? 409
            : 503,
      },
    );
  }
  if (receipt.duplicate) {
    const priorText =
      receipt.result && typeof receipt.result.text === "string"
        ? receipt.result.text
        : null;
    return Response.json(
      priorText
        ? { text: priorText }
        : { text: "HRMNY is already processing this message." },
    );
  }

  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || url.origin;
  try {
    if (event.type === "ADDED_TO_SPACE") {
      const text = responseText(
        "HRMNY is connected. Ask for a client, pipeline, delivery, or operating update here; approvals and external sends remain explicit.",
        appOrigin,
      );
      await completeIntegrationReceipt(receipt.receiptId, {
        ok: true,
        text,
        eventType: event.type,
      });
      return Response.json({ text });
    }
    if (event.type !== "MESSAGE") {
      await completeIntegrationReceipt(receipt.receiptId, {
        ok: true,
        ignored: true,
        eventType: event.type,
      });
      return Response.json({});
    }

    const prompt = (
      event.message?.argumentText ??
      event.message?.text ??
      ""
    ).trim();
    if (!prompt) {
      const text = responseText(
        "Tell me what you need: find prospects, review pipeline, check delivery, or open the next decision.",
        appOrigin,
      );
      await completeIntegrationReceipt(receipt.receiptId, { ok: true, text });
      return Response.json({ text });
    }
    const thread = await getOrCreateExternalChatThread({
      employeeId: user.employeeId,
      externalRef: `google-chat:${event.space.name}`,
      title: event.space.displayName
        ? `Google Chat · ${event.space.displayName}`
        : "Google Chat",
    });
    const result = await createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
      clientId: null,
    }).chat.send({
      threadId: thread.chatThreadId,
      content: prompt,
      effort: "low",
      harness: "direct",
    });
    const text = responseText(result.assistant.content, appOrigin);
    await completeIntegrationReceipt(receipt.receiptId, {
      ok: true,
      text,
      threadId: thread.chatThreadId,
    });
    return Response.json({ text });
  } catch {
    const text = responseText(
      "I could not finish that request. Open HRMNY to retry or continue the conversation.",
      appOrigin,
    );
    try {
      await completeIntegrationReceipt(receipt.receiptId, {
        ok: false,
        text,
        errorCode: "PROCESSING_FAILED",
      });
    } catch {
      // Google will retry because the receipt store is unavailable.
      return Response.json({ error: "processing_failed" }, { status: 503 });
    }
    return Response.json({ text });
  }
}

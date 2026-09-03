import {
  createHash,
  createPublicKey,
  sign as signPayload,
  verify as verifySignature,
  type JsonWebKey,
} from "node:crypto";
import { scheduledJob, sql } from "@hrmny/db";
import { z } from "zod";
import {
  resolveActiveStaffById,
  resolveActiveStaffByEmail,
  sessionCanViewMargin,
} from "./auth/session";
import { getDb } from "./db";
import {
  completeIntegrationReceipt,
  getIntegrationReceipt,
  hashIntegrationPayload,
  recordIntegrationReceipt,
  transitionIntegrationReceiptProgress,
  updateIntegrationReceiptProgress,
} from "./integrations/inbox";
import { createCaller } from "./trpc/root";
import { getOrCreateExternalChatThread } from "./trpc/chat-router";
import { inngest, inngestCloudConfigured } from "./inngest/client";

const GOOGLE_CHAT_EMAIL = "chat@system.gserviceaccount.com";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CHAT_API_URL = "https://chat.googleapis.com/v1";
const GOOGLE_CHAT_BOT_SCOPE = "https://www.googleapis.com/auth/chat.bot";
export const GOOGLE_CHAT_INTERACTION_JOB_KIND = "google_chat_interaction";
export const GOOGLE_CHAT_INTERACTION_EVENT =
  "google-chat/interaction.queued" as const;
const MAX_BODY_BYTES = 256_000;
const MAX_JWT_CHARS = 16_384;
const googleSpaceNameSchema = z
  .string()
  .max(500)
  .regex(/^spaces\/[A-Za-z0-9_-]+$/);
const googleThreadNameSchema = z
  .string()
  .max(500)
  .regex(/^spaces\/[A-Za-z0-9_-]+\/threads\/[A-Za-z0-9_-]+$/);

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
const serviceAccountSchema = z.object({
  client_email: z.string().email().max(320),
  private_key: z.string().min(100).max(20_000),
});
const googleChatMessageSchema = z
  .object({ name: z.string().min(1).max(500) })
  .passthrough();
const googleChatJobSchema = z.object({
  receiptId: z.string().uuid(),
  externalEventId: z.string().min(1).max(500),
  employeeId: z.string().uuid(),
  spaceName: googleSpaceNameSchema,
  threadName: googleThreadNameSchema.nullable(),
  prompt: z.string().min(1).max(8_000),
  appOrigin: z.string().url().max(500),
  externalRef: z.string().min(1).max(1_100),
  title: z.string().min(1).max(120),
});
const googleChatEventDataSchema = z.object({
  jobId: z.string().uuid(),
  receiptId: z.string().uuid(),
});

const googleChatEventSchema = z
  .object({
    type: z.string().min(1).max(80),
    eventTime: z.string().max(80).optional(),
    space: z
      .object({
        name: googleSpaceNameSchema,
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
        thread: z
          .object({ name: googleThreadNameSchema })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type GoogleJwk = z.infer<typeof jwkSchema>;
type GoogleJwtClaims = z.infer<typeof jwtClaimsSchema>;
type GoogleChatJob = z.infer<typeof googleChatJobSchema>;
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

function configuredServiceAccount() {
  const raw = process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) throw new Error("GOOGLE_CHAT_SERVICE_ACCOUNT_MISSING");
  try {
    return serviceAccountSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("GOOGLE_CHAT_SERVICE_ACCOUNT_INVALID");
  }
}

export function googleChatAsyncConfigured(): boolean {
  try {
    configuredServiceAccount();
    return true;
  } catch {
    return false;
  }
}

async function googleChatAccessToken(): Promise<string> {
  const account = configuredServiceAccount();
  const now = Math.floor(Date.now() / 1_000);
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", typ: "JWT" });
  const claims = encode({
    iss: account.client_email,
    scope: GOOGLE_CHAT_BOT_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3_600,
  });
  const signingInput = `${header}.${claims}`;
  const signature = signPayload(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    account.private_key.replace(/\\n/g, "\n"),
  ).toString("base64url");
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GOOGLE_CHAT_TOKEN_${response.status}`);
  return z
    .object({ access_token: z.string().min(1).max(20_000) })
    .parse(await response.json()).access_token;
}

export function googleChatReplyMessageId(receiptId: string): string {
  return `client-${createHash("sha256").update(receiptId).digest("hex").slice(0, 40)}`;
}

async function readGoogleChatMessage(
  messageName: string,
  accessToken: string,
) {
  const response = await fetch(`${GOOGLE_CHAT_API_URL}/${messageName}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GOOGLE_CHAT_READBACK_${response.status}`);
  return googleChatMessageSchema.parse(await response.json());
}

/** Idempotent Chat API delivery with exact provider readback. */
export async function sendGoogleChatReply(input: {
  receiptId: string;
  spaceName: string;
  threadName: string | null;
  text: string;
}) {
  const accessToken = await googleChatAccessToken();
  const messageId = googleChatReplyMessageId(input.receiptId);
  const messageName = `${input.spaceName}/messages/${messageId}`;
  const existing = await readGoogleChatMessage(messageName, accessToken);
  if (existing) return existing;

  const params = new URLSearchParams({ messageId });
  if (input.threadName) {
    params.set("messageReplyOption", "REPLY_MESSAGE_OR_FAIL");
  }
  let response: Response;
  try {
    response = await fetch(
      `${GOOGLE_CHAT_API_URL}/${input.spaceName}/messages?${params}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: input.text,
          ...(input.threadName ? { thread: { name: input.threadName } } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    const recovered = await readGoogleChatMessage(messageName, accessToken);
    if (recovered) return recovered;
    throw new Error("GOOGLE_CHAT_SEND_AMBIGUOUS");
  }
  if (!response.ok && response.status !== 409) {
    throw new Error(`GOOGLE_CHAT_SEND_${response.status}`);
  }
  const verified = await readGoogleChatMessage(messageName, accessToken);
  if (!verified) throw new Error("GOOGLE_CHAT_SEND_UNVERIFIED");
  return verified;
}

async function queueGoogleChatInteraction(payload: GoogleChatJob) {
  const db = getDb();
  if (!db) return null;
  const inserted = await db
    .insert(scheduledJob)
    .values({
      integrationInboxId: payload.receiptId,
      jobKey: `google-chat:${payload.receiptId}`,
      kind: GOOGLE_CHAT_INTERACTION_JOB_KIND,
      runAt: new Date(),
      payload,
    })
    .onConflictDoNothing({ target: scheduledJob.jobKey })
    .returning({ id: scheduledJob.scheduledJobId });
  if (inserted[0]) return inserted[0].id;
  const [existing] = await db.execute<{ scheduled_job_id: string }>(sql`
    select scheduled_job_id
    from public.scheduled_job
    where job_key = ${`google-chat:${payload.receiptId}`}
      and kind = ${GOOGLE_CHAT_INTERACTION_JOB_KIND}
    limit 1
  `);
  if (!existing) throw new Error("GOOGLE_CHAT_JOB_CONFLICT");
  return existing.scheduled_job_id;
}

async function dispatchGoogleChatInteraction(input: {
  jobId: string;
  receiptId: string;
}) {
  if (!inngestCloudConfigured()) return false;
  await inngest.send({
    id: `google-chat:${input.jobId}`,
    name: GOOGLE_CHAT_INTERACTION_EVENT,
    data: input,
  });
  return true;
}

export async function runGoogleChatInteractionJob(raw: unknown) {
  const payload = googleChatJobSchema.parse(raw);
  const receipt = await getIntegrationReceipt(
    "google-chat",
    payload.externalEventId,
  );
  if (!receipt || receipt.receiptId !== payload.receiptId) {
    throw new Error("GOOGLE_CHAT_RECEIPT_NOT_FOUND");
  }
  if (
    receipt.status === "completed" &&
    typeof receipt.result?.messageName === "string"
  ) {
    return { ok: true, messageName: receipt.result.messageName, replay: true };
  }
  const user = await resolveActiveStaffById(payload.employeeId);
  if (!user) throw new Error("GOOGLE_CHAT_STAFF_ACCESS_REVOKED");

  let text: string;
  let threadId: string;
  if (
    receipt.result?.bridgeStatus === "reply_ready" &&
    typeof receipt.result.text === "string" &&
    typeof receipt.result.threadId === "string"
  ) {
    text = receipt.result.text;
    threadId = receipt.result.threadId;
  } else {
    const thread = await getOrCreateExternalChatThread({
      employeeId: user.employeeId,
      externalRef: payload.externalRef,
      title: payload.title,
    });
    threadId = thread.chatThreadId;
    const result = await createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
      clientId: null,
    }).chat.send({
      threadId,
      content: payload.prompt,
      effort: "low",
      harness: "direct",
    });
    text = responseText(result.assistant.content, payload.appOrigin);
    await updateIntegrationReceiptProgress(payload.receiptId, {
      status: "processing",
      result: { bridgeStatus: "reply_ready", text, threadId },
    });
  }

  const delivered = await sendGoogleChatReply({
    receiptId: payload.receiptId,
    spaceName: payload.spaceName,
    threadName: payload.threadName,
    text,
  });
  await completeIntegrationReceipt(payload.receiptId, {
    ok: true,
    bridgeStatus: "delivered",
    text,
    threadId,
    messageName: delivered.name,
  });
  return { ok: true, messageName: delivered.name, replay: false };
}

export async function failGoogleChatInteractionJob(
  raw: unknown,
  error: unknown,
) {
  const payload = googleChatJobSchema.safeParse(raw);
  if (!payload.success) return;
  await transitionIntegrationReceiptProgress(
    payload.data.receiptId,
    { status: "processing" },
    {
      status: "failed",
      lastError:
        error instanceof Error ? error.message : "GOOGLE_CHAT_JOB_FAILED",
      processed: true,
    },
  );
}

/** Claim the exact queued row so Inngest and cron cannot run it together. */
export async function runGoogleChatQueuedJob(raw: unknown) {
  const input = googleChatEventDataSchema.parse(raw);
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL_MISSING");
  const [job] = await db.execute<{
    payload: unknown;
    attempts: number;
  }>(sql`
    update public.scheduled_job
    set status = 'running', locked_at = now(), attempts = attempts + 1,
        updated_at = now()
    where scheduled_job_id = ${input.jobId}::uuid
      and integration_inbox_id = ${input.receiptId}::uuid
      and kind = ${GOOGLE_CHAT_INTERACTION_JOB_KIND}
      and status = 'pending'
    returning payload, attempts
  `);
  if (!job) {
    const [existing] = await db.execute<{
      status: string;
      result: Record<string, unknown> | null;
    }>(sql`
      select status, result
      from public.scheduled_job
      where scheduled_job_id = ${input.jobId}::uuid
        and integration_inbox_id = ${input.receiptId}::uuid
        and kind = ${GOOGLE_CHAT_INTERACTION_JOB_KIND}
      limit 1
    `);
    return {
      status: existing?.status ?? "not_found",
      result: existing?.result ?? null,
    };
  }
  try {
    const result = await runGoogleChatInteractionJob(job.payload);
    await db.execute(sql`
      update public.scheduled_job
      set status = 'completed', payload = '{}'::jsonb,
          result = ${JSON.stringify(result)}::jsonb, locked_at = null,
          completed_at = now(), last_error = null, updated_at = now()
      where scheduled_job_id = ${input.jobId}::uuid
        and status = 'running'
    `);
    return { status: "completed", result };
  } catch (error) {
    const retry = Number(job.attempts) < 3;
    if (!retry) {
      await failGoogleChatInteractionJob(job.payload, error);
    }
    await db.execute(sql`
      update public.scheduled_job
      set status = ${retry ? "pending" : "failed"},
          payload = ${retry ? JSON.stringify(job.payload) : "{}"}::jsonb,
          run_at = now(), locked_at = null,
          last_error = ${String(error).slice(0, 2_000)}, updated_at = now()
      where scheduled_job_id = ${input.jobId}::uuid
        and status = 'running'
    `);
    if (retry) throw error;
    return { status: "failed", result: null };
  }
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
  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || url.origin;
  const prompt = (
    event.message?.argumentText ??
    event.message?.text ??
    ""
  ).trim();
  const threadName = event.message?.thread?.name ?? null;
  const jobPayload =
    event.type === "MESSAGE" && prompt
      ? googleChatJobSchema.safeParse({
          receiptId: receipt.receiptId,
          externalEventId,
          employeeId: user.employeeId,
          spaceName: event.space.name,
          threadName,
          prompt,
          appOrigin,
          externalRef: `google-chat:${event.space.name}:${threadName ?? "root"}`,
          title: (event.space.displayName
            ? `Google Chat · ${event.space.displayName}`
            : "Google Chat"
          ).slice(0, 120),
        })
      : null;

  if (receipt.duplicate && jobPayload?.success) {
    if (receipt.status === "processing") {
      try {
        const jobId = await queueGoogleChatInteraction(jobPayload.data);
        if (jobId) {
          await dispatchGoogleChatInteraction({
            jobId,
            receiptId: receipt.receiptId,
          }).catch(() => false);
        }
      } catch {
        return Response.json({ error: "queue_unavailable" }, { status: 503 });
      }
    }
    return Response.json({});
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

    if (!prompt) {
      const text = responseText(
        "Tell me what you need: find prospects, review pipeline, check delivery, or open the next decision.",
        appOrigin,
      );
      await completeIntegrationReceipt(receipt.receiptId, { ok: true, text });
      return Response.json({ text });
    }
    if (!jobPayload?.success) {
      return Response.json({ error: "invalid_event" }, { status: 400 });
    }
    if (getDb()) {
      const text = "Got it — HRMNY will reply in this thread.";
      try {
        const jobId = await queueGoogleChatInteraction(jobPayload.data);
        if (!jobId) throw new Error("GOOGLE_CHAT_JOB_UNAVAILABLE");
        await updateIntegrationReceiptProgress(receipt.receiptId, {
          status: "processing",
          result: { bridgeStatus: "queued" },
        });
        await dispatchGoogleChatInteraction({
          jobId,
          receiptId: receipt.receiptId,
        }).catch(() => false);
      } catch {
        return Response.json({ error: "queue_unavailable" }, { status: 503 });
      }
      return Response.json({ text });
    }

    // Local no-database mode remains synchronous for developer acceptance.
    const thread = await getOrCreateExternalChatThread({
      employeeId: user.employeeId,
      externalRef: jobPayload.data.externalRef,
      title: jobPayload.data.title,
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

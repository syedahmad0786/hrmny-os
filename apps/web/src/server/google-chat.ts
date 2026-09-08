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
export const GOOGLE_CHAT_QM_JOB_KIND = "google_chat_qm_interaction";
export function qmGoogleChatAllowed(employeeId: string) {
  return (
    process.env.GOOGLE_CHAT_RUNTIME === "qm" &&
    (process.env.QM_GOOGLE_CHAT_EMPLOYEE_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .includes(employeeId)
  );
}
export const GOOGLE_CHAT_INTERACTION_EVENT =
  "google-chat/interaction.queued" as const;
const MAX_BODY_BYTES = 256_000;
const MAX_JWT_CHARS = 16_384;
const googleUserNameSchema = z
  .string()
  .max(100)
  .regex(/^users\/[0-9]+$/);
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
  .object({
    name: z.string().min(1).max(500),
    clientAssignedMessageId: z.string().min(1).max(63),
    text: z.string(),
    privateMessageViewer: z.object({ name: googleUserNameSchema }),
    thread: z.object({ name: googleThreadNameSchema }).optional(),
  })
  .passthrough();
export const googleChatJobSchema = z.object({
  receiptId: z.string().uuid(),
  externalEventId: z.string().min(1).max(500),
  employeeId: z.string().uuid(),
  googleUserName: googleUserNameSchema,
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
        name: googleUserNameSchema.optional(),
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

async function readGoogleChatMessage(messageName: string, accessToken: string) {
  const response = await fetch(`${GOOGLE_CHAT_API_URL}/${messageName}`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GOOGLE_CHAT_READBACK_${response.status}`);
  return googleChatMessageSchema.parse(await response.json());
}

async function requireActiveGoogleChatStaff(employeeId: string) {
  const user = await resolveActiveStaffById(employeeId);
  if (!user) throw new Error("GOOGLE_CHAT_STAFF_ACCESS_REVOKED");
  return user;
}

/** Idempotent Chat API delivery with exact provider readback. */
export async function sendGoogleChatReply(input: {
  employeeId: string;
  receiptId: string;
  spaceName: string;
  threadName: string | null;
  text: string;
  googleUserName: string;
}) {
  z.string().uuid().parse(input.employeeId);
  z.string().uuid().parse(input.receiptId);
  googleUserNameSchema.parse(input.googleUserName);
  googleSpaceNameSchema.parse(input.spaceName);
  if (
    input.threadName &&
    !input.threadName.startsWith(`${input.spaceName}/threads/`)
  ) {
    throw new Error("GOOGLE_CHAT_THREAD_SCOPE_MISMATCH");
  }
  const accessToken = await googleChatAccessToken();
  await requireActiveGoogleChatStaff(input.employeeId);
  const messageId = googleChatReplyMessageId(input.receiptId);
  const messageName = `${input.spaceName}/messages/${messageId}`;
  const verifyReply = (message: z.infer<typeof googleChatMessageSchema>) => {
    if (
      !message.name.startsWith(`${input.spaceName}/messages/`) ||
      !/^[A-Za-z0-9_.-]+$/.test(
        message.name.slice(`${input.spaceName}/messages/`.length),
      ) ||
      message.clientAssignedMessageId !== messageId ||
      message.text !== input.text ||
      message.privateMessageViewer.name !== input.googleUserName ||
      (input.threadName && message.thread?.name !== input.threadName)
    ) {
      throw new Error("GOOGLE_CHAT_REPLY_MISMATCH");
    }
    return message;
  };
  // Google can return 403 for an absent message. Create idempotently first;
  // reads below still fail closed and verify the provider's canonical resource.
  const params = new URLSearchParams({ messageId, requestId: input.receiptId });
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
          privateMessageViewer: { name: input.googleUserName },
          ...(input.threadName ? { thread: { name: input.threadName } } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    const recovered = await readGoogleChatMessage(messageName, accessToken);
    if (recovered) return verifyReply(recovered);
    throw new Error("GOOGLE_CHAT_SEND_AMBIGUOUS");
  }
  if (!response.ok && response.status !== 409) {
    throw new Error(`GOOGLE_CHAT_SEND_${response.status}`);
  }
  const verified = await readGoogleChatMessage(messageName, accessToken);
  if (!verified) throw new Error("GOOGLE_CHAT_SEND_UNVERIFIED");
  return verifyReply(verified);
}

async function queueGoogleChatInteraction(payload: GoogleChatJob) {
  const db = getDb();
  if (!db) return null;
  const kind = qmGoogleChatAllowed(payload.employeeId)
    ? GOOGLE_CHAT_QM_JOB_KIND
    : GOOGLE_CHAT_INTERACTION_JOB_KIND;
  const inserted = await db
    .insert(scheduledJob)
    .values({
      integrationInboxId: payload.receiptId,
      jobKey: `google-chat:${payload.receiptId}`,
      kind,
      runAt: new Date(),
      payload,
    })
    .onConflictDoNothing({ target: scheduledJob.jobKey })
    .returning({ id: scheduledJob.scheduledJobId });
  if (inserted[0]) return { jobId: inserted[0].id, kind };
  const [existing] = await db.execute<{
    scheduled_job_id: string;
    kind: string;
  }>(sql`
    select scheduled_job_id, kind
    from public.scheduled_job
    where job_key = ${`google-chat:${payload.receiptId}`}
      and kind in (${GOOGLE_CHAT_INTERACTION_JOB_KIND}, ${GOOGLE_CHAT_QM_JOB_KIND})
    limit 1
  `);
  if (!existing) throw new Error("GOOGLE_CHAT_JOB_CONFLICT");
  return { jobId: existing.scheduled_job_id, kind: existing.kind };
}

export async function dispatchGoogleChatInteraction(input: {
  jobId: string;
  receiptId: string;
  kind?: string;
}) {
  if (input.kind === GOOGLE_CHAT_QM_JOB_KIND) return false;
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
  if (
    !receipt ||
    receipt.receiptId !== payload.receiptId ||
    receipt.ownerEmployeeId !== payload.employeeId
  ) {
    throw new Error("GOOGLE_CHAT_RECEIPT_NOT_FOUND");
  }
  if (
    receipt.status === "completed" &&
    typeof receipt.result?.messageName === "string"
  ) {
    return { ok: true, messageName: receipt.result.messageName, replay: true };
  }
  const user = await requireActiveGoogleChatStaff(payload.employeeId);

  let text: string;
  let threadId: string | null;
  if (
    receipt.result?.bridgeStatus === "reply_ready" &&
    typeof receipt.result.text === "string" &&
    (typeof receipt.result.threadId === "string" ||
      typeof receipt.result.qmThreadRef === "string")
  ) {
    text = receipt.result.text;
    threadId =
      typeof receipt.result.threadId === "string"
        ? receipt.result.threadId
        : null;
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
      harness: "react",
      proposalOnly: true,
    });
    text = responseText(result.assistant.content, payload.appOrigin);
    await updateIntegrationReceiptProgress(payload.receiptId, {
      status: "processing",
      result: { bridgeStatus: "reply_ready", text, threadId },
    });
  }

  const delivered = await sendGoogleChatReply({
    employeeId: payload.employeeId,
    receiptId: payload.receiptId,
    spaceName: payload.spaceName,
    threadName: payload.threadName,
    text,
    googleUserName: payload.googleUserName,
  });
  await completeIntegrationReceipt(payload.receiptId, {
    ok: true,
    bridgeStatus: "delivered",
    text,
    threadId,
    ...(typeof receipt.result?.qmThreadRef === "string"
      ? {
          qmThreadRef: receipt.result.qmThreadRef,
          qmSessionId: receipt.result.qmSessionId,
          qmRunId: receipt.result.qmRunId,
        }
      : {}),
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
  // Staff context must never be broadcast to everyone in a shared Chat space.
  if (event.type === "MESSAGE" && !event.user.name) {
    return Response.json(
      { error: "chat_user_identity_required" },
      { status: 400 },
    );
  }
  const threadName = event.message?.thread?.name ?? null;
  if (
    (threadName && !threadName.startsWith(`${event.space.name}/threads/`)) ||
    (event.message &&
      !event.message.name.startsWith(`${event.space.name}/messages/`))
  ) {
    return Response.json({ error: "message_scope_mismatch" }, { status: 400 });
  }
  const privateReply = (text: string) =>
    Response.json({
      text,
      ...(event.user.name
        ? { privateMessageViewer: { name: event.user.name } }
        : {}),
    });

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
  const jobPayload =
    event.type === "MESSAGE" && prompt
      ? googleChatJobSchema.safeParse({
          receiptId: receipt.receiptId,
          externalEventId,
          employeeId: user.employeeId,
          googleUserName: event.user.name,
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
        const job = await queueGoogleChatInteraction(jobPayload.data);
        if (job) {
          await dispatchGoogleChatInteraction({
            ...job,
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
    return privateReply(
      priorText ?? "hrmny AI Assistant is already processing this message.",
    );
  }

  try {
    if (event.type === "ADDED_TO_SPACE") {
      const text = responseText(
        "hrmny AI Assistant is connected. Ask for a client, pipeline, delivery, or operating update. Answers are private to you; approvals and external sends remain explicit.",
        appOrigin,
      );
      await completeIntegrationReceipt(receipt.receiptId, {
        ok: true,
        text,
        eventType: event.type,
      });
      return privateReply(text);
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
      return privateReply(text);
    }
    if (!jobPayload?.success) {
      return Response.json({ error: "invalid_event" }, { status: 400 });
    }
    if (getDb()) {
      const text =
        "Got it — hrmny AI Assistant will reply privately in this thread.";
      try {
        await updateIntegrationReceiptProgress(receipt.receiptId, {
          status: "processing",
          result: { bridgeStatus: "queued" },
        });
        const job = await queueGoogleChatInteraction(jobPayload.data);
        if (!job) throw new Error("GOOGLE_CHAT_JOB_UNAVAILABLE");
        await dispatchGoogleChatInteraction({
          ...job,
          receiptId: receipt.receiptId,
        }).catch(() => false);
      } catch {
        return Response.json({ error: "queue_unavailable" }, { status: 503 });
      }
      return privateReply(text);
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
      harness: "react",
      proposalOnly: true,
    });
    await requireActiveGoogleChatStaff(user.employeeId);
    const text = responseText(result.assistant.content, appOrigin);
    await completeIntegrationReceipt(receipt.receiptId, {
      ok: true,
      text,
      threadId: thread.chatThreadId,
    });
    return privateReply(text);
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
    return privateReply(text);
  }
}

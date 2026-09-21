import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  normalizeResearchEvidence,
  ResearchEvidenceError,
} from "./research-evidence";

export const SALES_RESEARCH_RUN_JOB_KIND = "sales_research_run";
export const DISCOVERY_CALLBACK_MAX_BYTES = 256 * 1024;
export const DISCOVERY_CALLBACK_MAX_SKEW_SECONDS = 30;
export const DISCOVERY_CALLBACK_MAX_TOKEN_BYTES = 4 * 1024;
export const DISCOVERY_CALLBACK_ISSUER = "hrmny-n8n-discovery";
export const DISCOVERY_CALLBACK_AUDIENCE = "hrmny-os-discovery";
export const DISCOVERY_CALLBACK_MAX_LIFETIME_SECONDS = 5 * 60;

const UuidSchema = z.string().uuid();
const IsoDateSchema = z.string().datetime({ offset: true });
const AttemptGenerationSchema = z.number().int().positive().max(1_000_000);
const CredentialGenerationSchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000);

const PublicUrlReferenceSchema = z
  .object({
    kind: z.literal("public_url"),
    url: z
      .string()
      .max(2_048)
      .transform((value, ctx) => {
        try {
          return normalizeResearchEvidence(value);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              error instanceof ResearchEvidenceError
                ? error.message
                : "Public HTTPS URL required",
          });
          return z.NEVER;
        }
      }),
  })
  .strict();

const AuthorizedDocumentReferenceSchema = z
  .object({
    kind: z.literal("authorized_document"),
    artifactId: UuidSchema,
  })
  .strict();

export const DiscoveryObservationSchema = z
  .object({
    observationId: UuidSchema,
    sourceItemKey: z.string().trim().min(1).max(500),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/i),
    sourceReference: z.discriminatedUnion("kind", [
      PublicUrlReferenceSchema,
      AuthorizedDocumentReferenceSchema,
    ]),
    observedAt: IsoDateSchema,
    publishedAt: IsoDateSchema.nullable(),
    dateEvidence: z
      .object({
        method: z.enum([
          "provider",
          "feed",
          "page_metadata",
          "article_body",
          "operator",
        ]),
        precision: z.enum(["instant", "day", "month", "unknown"]),
      })
      .strict(),
    kind: z.enum([
      "news",
      "job",
      "leadership",
      "tender",
      "company_intent",
      "relationship",
      "inbound",
      "other",
    ]),
    title: z.string().trim().min(1).max(500),
    excerpt: z.string().trim().min(1).max(5_000),
    companyHints: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(300),
            domain: z
              .string()
              .trim()
              .max(253)
              .regex(
                /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
              )
              .nullable(),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

export const DiscoveryCheckpointSchema = z
  .object({
    cursor: z.string().min(1).max(4_096).nullable(),
    providerJobId: z.string().trim().min(1).max(300).nullable(),
    itemsSeen: z.number().int().nonnegative().max(1_000_000),
    pagesSeen: z.number().int().nonnegative().max(100_000),
  })
  .strict();

const DiscoveryUsageSchema = z
  .object({
    providerRequestId: z.string().trim().min(1).max(300).nullable(),
    units: z.number().nonnegative().max(1_000_000_000),
    unitKind: z.enum(["request", "credit", "token", "byte", "second"]),
  })
  .strict();

const CallbackBaseSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: UuidSchema,
  runId: UuidSchema,
  sourceId: UuidSchema,
  attemptToken: UuidSchema,
  attemptGeneration: AttemptGenerationSchema,
  credentialGeneration: CredentialGenerationSchema,
});

const ObservationsEnvelopeSchema = CallbackBaseSchema.extend({
  event: z.literal("sales.discovery.observations.v1"),
  payload: z
    .object({
      observations: z.array(DiscoveryObservationSchema).min(1).max(100),
      checkpoint: DiscoveryCheckpointSchema.optional(),
      usage: z.array(DiscoveryUsageSchema).max(20).optional(),
    })
    .strict(),
}).strict();

const CheckpointEnvelopeSchema = CallbackBaseSchema.extend({
  event: z.literal("sales.discovery.checkpoint.v1"),
  payload: z
    .object({
      checkpoint: DiscoveryCheckpointSchema,
      usage: z.array(DiscoveryUsageSchema).max(20).optional(),
    })
    .strict(),
}).strict();

const CompletionEnvelopeSchema = CallbackBaseSchema.extend({
  event: z.literal("sales.discovery.completion.v1"),
  payload: z
    .object({
      status: z.enum(["completed", "partial", "failed", "cancelled"]),
      counts: z
        .object({
          ingested: z.number().int().nonnegative().max(1_000_000),
          duplicate: z.number().int().nonnegative().max(1_000_000),
          quarantined: z.number().int().nonnegative().max(1_000_000),
          rejected: z.number().int().nonnegative().max(1_000_000),
        })
        .strict(),
      checkpoint: DiscoveryCheckpointSchema.optional(),
      usage: z.array(DiscoveryUsageSchema).max(20).optional(),
      error: z
        .object({
          code: z.enum([
            "source_unavailable",
            "rate_limited",
            "unauthorized",
            "cost_unverified",
            "contract_invalid",
            "cancelled",
            "internal_error",
          ]),
          retryable: z.boolean(),
        })
        .strict()
        .optional(),
    })
    .strict(),
}).strict();

export const DiscoveryRuntimeEnvelopeSchema = z.discriminatedUnion("event", [
  ObservationsEnvelopeSchema,
  CheckpointEnvelopeSchema,
  CompletionEnvelopeSchema,
]);

export type DiscoveryRuntimeEnvelope = z.infer<
  typeof DiscoveryRuntimeEnvelopeSchema
>;

type ValidationFailure = {
  ok: false;
  code:
    | "body_too_large"
    | "missing_token"
    | "invalid_token"
    | "unknown_key"
    | "invalid_body"
    | "event_id_mismatch";
};

export type DiscoveryCallbackValidation =
  | ValidationFailure
  | {
      ok: true;
      envelope: DiscoveryRuntimeEnvelope;
      eventId: string;
      bodyHash: string;
      keyId: string;
    };

const DiscoveryTokenHeaderSchema = z
  .object({
    alg: z.literal("HS256"),
    typ: z.literal("JWT"),
    kid: z.string().regex(/^[a-z0-9._-]{1,64}$/i),
  })
  .strict();

const DiscoveryTokenClaimsSchema = z
  .object({
    iss: z.literal(DISCOVERY_CALLBACK_ISSUER),
    aud: z.literal(DISCOVERY_CALLBACK_AUDIENCE),
    jti: UuidSchema,
    iat: z.number().int().safe(),
    exp: z.number().int().safe(),
    bodyHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

function encodeJson(value: unknown) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(segment: string): unknown {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) throw new Error("INVALID_TOKEN");
  const decoded = Buffer.from(segment, "base64url");
  if (decoded.toString("base64url") !== segment)
    throw new Error("INVALID_TOKEN");
  return JSON.parse(decoded.toString("utf8")) as unknown;
}

/** Test/proof helper matching the native n8n JWT node's HS256 output. */
export function signDiscoveryRuntimeToken(
  secret: string,
  keyId: string,
  rawBody: string,
  eventId: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
) {
  const header = encodeJson({ alg: "HS256", typ: "JWT", kid: keyId });
  const payload = encodeJson({
    iss: DISCOVERY_CALLBACK_ISSUER,
    aud: DISCOVERY_CALLBACK_AUDIENCE,
    jti: eventId,
    iat: nowSeconds,
    exp: nowSeconds + DISCOVERY_CALLBACK_MAX_LIFETIME_SECONDS,
    bodyHash: createHash("sha256").update(rawBody, "utf8").digest("hex"),
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret)
    .update(signingInput, "utf8")
    .digest("base64url");
  return `${signingInput}.${signature}`;
}

/** Loads a small rotation key ring without accepting the legacy n8n secret. */
export function loadDiscoveryN8nCallbackKeys(
  raw = process.env.DISCOVERY_N8N_CALLBACK_KEYS_JSON,
): Readonly<Record<string, string>> | null {
  if (!raw || Buffer.byteLength(raw, "utf8") > 16 * 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 8) return null;
  const keys: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  for (const [keyId, secret] of entries) {
    if (
      !/^[a-z0-9._-]{1,64}$/i.test(keyId) ||
      typeof secret !== "string" ||
      secret !== secret.trim() ||
      Buffer.byteLength(secret, "utf8") < 32 ||
      Buffer.byteLength(secret, "utf8") > 512
    )
      return null;
    keys[keyId] = secret;
  }
  return keys;
}

/**
 * Authenticates and parses a callback signed by n8n's native JWT node. Replay
 * acceptance remains a durable handler decision: compare eventId + bodyHash
 * before committing any result.
 */
export function validateDiscoveryRuntimeCallback(input: {
  rawBody: string;
  headers: Pick<Headers, "get">;
  keys: Readonly<Record<string, string>>;
  nowSeconds?: number;
  maxSkewSeconds?: number;
}): DiscoveryCallbackValidation {
  if (Buffer.byteLength(input.rawBody, "utf8") > DISCOVERY_CALLBACK_MAX_BYTES) {
    return { ok: false, code: "body_too_large" };
  }

  const token = input.headers.get("x-hrmny-discovery-token")?.trim();
  if (!token) return { ok: false, code: "missing_token" };
  if (Buffer.byteLength(token, "utf8") > DISCOVERY_CALLBACK_MAX_TOKEN_BYTES)
    return { ok: false, code: "invalid_token" };

  const segments = token.split(".");
  if (segments.length !== 3) return { ok: false, code: "invalid_token" };
  const [headerSegment, claimsSegment, signatureSegment] = segments as [
    string,
    string,
    string,
  ];
  let header: z.infer<typeof DiscoveryTokenHeaderSchema>;
  let claims: z.infer<typeof DiscoveryTokenClaimsSchema>;
  try {
    header = DiscoveryTokenHeaderSchema.parse(decodeJson(headerSegment));
    claims = DiscoveryTokenClaimsSchema.parse(decodeJson(claimsSegment));
  } catch {
    return { ok: false, code: "invalid_token" };
  }

  const keyId = header.kid;
  const configuredKey = Object.hasOwn(input.keys, keyId)
    ? input.keys[keyId]
    : undefined;
  const secret = typeof configuredKey === "string" ? configuredKey.trim() : "";
  if (!secret) return { ok: false, code: "unknown_key" };
  if (!/^[A-Za-z0-9_-]{43}$/.test(signatureSegment))
    return { ok: false, code: "invalid_token" };
  const expected = createHmac("sha256", secret)
    .update(`${headerSegment}.${claimsSegment}`, "utf8")
    .digest();
  const received = Buffer.from(signatureSegment, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(expected, received)
  )
    return { ok: false, code: "invalid_token" };

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const clockSkewSeconds =
    input.maxSkewSeconds ?? DISCOVERY_CALLBACK_MAX_SKEW_SECONDS;
  if (
    claims.exp <= claims.iat ||
    claims.exp - claims.iat > DISCOVERY_CALLBACK_MAX_LIFETIME_SECONDS ||
    claims.iat > nowSeconds + clockSkewSeconds ||
    claims.exp < nowSeconds - clockSkewSeconds
  ) {
    return { ok: false, code: "invalid_token" };
  }

  const bodyHash = createHash("sha256")
    .update(input.rawBody, "utf8")
    .digest("hex");
  if (claims.bodyHash !== bodyHash) return { ok: false, code: "invalid_token" };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, code: "invalid_body" };
  }
  const parsed = DiscoveryRuntimeEnvelopeSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, code: "invalid_body" };
  if (parsed.data.eventId !== claims.jti) {
    return { ok: false, code: "event_id_mismatch" };
  }

  return {
    ok: true,
    envelope: parsed.data,
    eventId: parsed.data.eventId,
    bodyHash,
    keyId,
  };
}

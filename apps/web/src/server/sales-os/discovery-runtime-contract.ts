import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  normalizeResearchEvidence,
  ResearchEvidenceError,
} from "./research-evidence";

export const SALES_RESEARCH_RUN_JOB_KIND = "sales_research_run";
export const DISCOVERY_CALLBACK_MAX_BYTES = 256 * 1024;
export const DISCOVERY_CALLBACK_MAX_SKEW_SECONDS = 5 * 60;

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
    | "missing_headers"
    | "invalid_timestamp"
    | "unknown_key"
    | "invalid_signature"
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

export function signDiscoveryRuntimeCallback(
  secret: string,
  timestamp: string,
  rawBody: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
}

/**
 * Authenticates and parses a callback. Replay acceptance remains a durable
 * handler decision: compare eventId + bodyHash before committing any result.
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

  const keyId = input.headers.get("x-hrmny-key-id")?.trim();
  const timestamp = input.headers.get("x-hrmny-timestamp")?.trim();
  const signature = input.headers.get("x-hrmny-signature")?.trim();
  const headerEventId = input.headers.get("x-hrmny-event-id")?.trim();
  if (!keyId || !timestamp || !signature || !headerEventId) {
    return { ok: false, code: "missing_headers" };
  }
  if (!/^[a-z0-9._-]{1,64}$/i.test(keyId)) {
    return { ok: false, code: "unknown_key" };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  const maxSkewSeconds =
    input.maxSkewSeconds ?? DISCOVERY_CALLBACK_MAX_SKEW_SECONDS;
  if (
    !/^\d{10,11}$/.test(timestamp) ||
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > maxSkewSeconds
  ) {
    return { ok: false, code: "invalid_timestamp" };
  }

  const configuredKey = Object.hasOwn(input.keys, keyId)
    ? input.keys[keyId]
    : undefined;
  const secret = typeof configuredKey === "string" ? configuredKey.trim() : "";
  if (!secret) return { ok: false, code: "unknown_key" };
  const signatureMatch = /^sha256=([0-9a-f]{64})$/i.exec(signature);
  if (!signatureMatch) return { ok: false, code: "invalid_signature" };
  const expected = Buffer.from(
    signDiscoveryRuntimeCallback(secret, timestamp, input.rawBody),
    "hex",
  );
  const received = Buffer.from(signatureMatch[1]!, "hex");
  if (!timingSafeEqual(expected, received)) {
    return { ok: false, code: "invalid_signature" };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, code: "invalid_body" };
  }
  const parsed = DiscoveryRuntimeEnvelopeSchema.safeParse(parsedJson);
  if (!parsed.success) return { ok: false, code: "invalid_body" };
  if (parsed.data.eventId !== headerEventId) {
    return { ok: false, code: "event_id_mismatch" };
  }

  return {
    ok: true,
    envelope: parsed.data,
    eventId: parsed.data.eventId,
    bodyHash: createHash("sha256").update(input.rawBody, "utf8").digest("hex"),
    keyId,
  };
}

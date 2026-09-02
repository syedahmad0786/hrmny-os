import { z } from "zod";
import { QM_UPSTREAM_PIN } from "./source-pin";

const uuidSchema = z.string().uuid();
const safeReferenceSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9:._-]*$/)
  .refine((value) => !value.includes(".."), {
    message: "QM references cannot contain traversal segments",
  });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const receiptReferenceSchema = z
  .string()
  .regex(/^receipt:[a-zA-Z0-9][a-zA-Z0-9:._/-]*$/);

export const QmCapabilitySchema = z.enum(["workspace.read", "effect.propose"]);

export type QmCapability = z.infer<typeof QmCapabilitySchema>;

const capabilitiesSchema = z
  .array(QmCapabilitySchema)
  .max(2)
  .refine((values) => new Set(values).size === values.length, {
    message: "QM capabilities must be unique",
  });

export const QmRuntimeBindingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("local-synthetic"),
      fixtureId: safeReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider"),
      provider: z.literal("flyio"),
      resourceRef: safeReferenceSchema,
      readbackReceipt: receiptReferenceSchema,
    })
    .strict(),
]);

export type QmRuntimeBinding = z.infer<typeof QmRuntimeBindingSchema>;

export const QmSessionBindingSchema = z
  .object({
    sessionId: uuidSchema,
    organizationId: uuidSchema,
    scopeId: safeReferenceSchema,
    ownerEmployeeId: uuidSchema,
    lifecycle: z.enum(["active", "suspended", "revoked"]),
    capabilities: capabilitiesSchema,
    runtime: QmRuntimeBindingSchema,
    upstream: z
      .object({
        version: z.literal(QM_UPSTREAM_PIN.version),
        commit: z.literal(QM_UPSTREAM_PIN.commit),
      })
      .strict(),
    stateVersion: z.number().int().nonnegative(),
  })
  .strict();

export type QmSessionBinding = z.infer<typeof QmSessionBindingSchema>;

/**
 * Supplied by the authenticated HRMNY server context, never by a QM command.
 */
export const QmTrustedPrincipalSchema = z
  .object({
    organizationId: uuidSchema,
    employeeId: uuidSchema,
  })
  .strict();

export type QmTrustedPrincipal = z.infer<typeof QmTrustedPrincipalSchema>;

export const QmEffectKindSchema = z.enum([
  "provider.message.send",
  "provider.record.write",
  "provider.credit.consume",
  "provider.publish",
]);

export type QmEffectKind = z.infer<typeof QmEffectKindSchema>;

export const QmCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("workspace.read_precheck_request"),
      resourceKind: z.enum(["work", "crm", "approved-memory"]),
      resourceId: uuidSchema,
      purpose: z.string().trim().min(1).max(240),
    })
    .strict(),
  z
    .object({
      kind: z.literal("effect.proposal_request"),
      effectKind: QmEffectKindSchema,
      targetRef: safeReferenceSchema,
      previewDigest: sha256Schema,
      rationale: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export type QmCommand = z.infer<typeof QmCommandSchema>;

/**
 * Actor and organization are intentionally absent. The caller must supply a
 * separately authenticated QmTrustedPrincipal to the evaluator.
 */
export const QmCommandEnvelopeSchema = z
  .object({
    sessionId: uuidSchema,
    requestId: uuidSchema,
    command: QmCommandSchema,
  })
  .strict();

export type QmCommandEnvelope = z.infer<typeof QmCommandEnvelopeSchema>;

export const QmDecisionOutcomeSchema = z.enum([
  "workspace_read_precheck_recorded",
  "effect_proposal_recorded",
  "denied",
  "idempotency_conflict",
]);

export type QmDecisionOutcome = z.infer<typeof QmDecisionOutcomeSchema>;

/** Public reason codes contain no personal-scope or authorization detail. */
export const QmReasonCodeSchema = z.enum([
  "WORKSPACE_READ_PRECHECK_RECORDED",
  "EFFECT_PROPOSAL_RECORDED",
  "AUTHORIZATION_DENIED",
  "REQUEST_ID_PAYLOAD_CONFLICT",
  "SESSION_POLICY_CHANGED",
]);

export type QmReasonCode = z.infer<typeof QmReasonCodeSchema>;

export type QmWorkspaceReadPrecheck = {
  precheckId: string;
  organizationId: string;
  scopeId: string;
  sessionId: string;
  requestedByEmployeeId: string;
  resourceKind: "work" | "crm" | "approved-memory";
  resourceId: string;
  purposeDigest: string;
  resolution: "repository-scope-required";
  createdAt: string;
};

export type QmEffectProposal = {
  proposalId: string;
  organizationId: string;
  scopeId: string;
  sessionId: string;
  proposedByEmployeeId: string;
  effectKind: QmEffectKind;
  targetRef: string;
  previewDigest: string;
  rationaleDigest: string;
  status: "proposed";
  createdAt: string;
};

export type QmDecisionReceipt = {
  receiptId: string;
  requestId: string;
  inputDigest: string;
  organizationId: string;
  actorEmployeeId: string;
  sessionId: string;
  scopeId: string | null;
  outcome: QmDecisionOutcome;
  reasonCode: QmReasonCode;
  requiredCapability: QmCapability;
  sessionStateVersion: number | null;
  sessionPolicyDigest: string | null;
  upstreamCommit: string | null;
  runtimeKind: QmRuntimeBinding["kind"] | null;
  providerReadbackReceipt: string | null;
  proposalId: string | null;
  precheckId: string | null;
  createdAt: string;
};

export type QmStoredDecision = {
  receipt: QmDecisionReceipt;
  proposal?: QmEffectProposal;
  readPrecheck?: QmWorkspaceReadPrecheck;
};

export type QmCommandDecision = QmStoredDecision & {
  replayed: boolean;
};

export type QmDecisionKey = {
  organizationId: string;
  actorEmployeeId: string;
  requestId: string;
};

export interface QmControlRepository {
  getSession(sessionId: string): Promise<QmSessionBinding | null>;
  getDecision(key: QmDecisionKey): Promise<QmStoredDecision | null>;
  /**
   * Must be a durable atomic insert unique on organization + actor + request.
   * The in-memory implementation in tests proves only this interface contract.
   */
  commitDecision(
    decision: QmStoredDecision,
  ): Promise<
    | { status: "inserted"; decision: QmStoredDecision }
    | { status: "existing"; decision: QmStoredDecision }
  >;
}

export function personalQmScopeId(
  organizationId: string,
  employeeId: string,
): string {
  const organization = uuidSchema.parse(organizationId);
  const employee = uuidSchema.parse(employeeId);
  return `qm:organization:${organization}:employee:${employee}`;
}

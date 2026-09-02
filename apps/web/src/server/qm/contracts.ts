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

const isoTimestampSchema = z.string().datetime();

export const QmWorkspaceReadPrecheckSchema = z
  .object({
    precheckId: uuidSchema,
    organizationId: uuidSchema,
    scopeId: safeReferenceSchema,
    sessionId: uuidSchema,
    requestedByEmployeeId: uuidSchema,
    resourceKind: z.enum(["work", "crm", "approved-memory"]),
    resourceId: uuidSchema,
    purposeDigest: sha256Schema,
    resolution: z.literal("repository-scope-required"),
    createdAt: isoTimestampSchema,
  })
  .strict();

export type QmWorkspaceReadPrecheck = z.infer<
  typeof QmWorkspaceReadPrecheckSchema
>;

export const QmEffectProposalSchema = z
  .object({
    proposalId: uuidSchema,
    organizationId: uuidSchema,
    scopeId: safeReferenceSchema,
    sessionId: uuidSchema,
    proposedByEmployeeId: uuidSchema,
    effectKind: QmEffectKindSchema,
    targetRef: safeReferenceSchema,
    previewDigest: sha256Schema,
    rationaleDigest: sha256Schema,
    status: z.literal("proposed"),
    createdAt: isoTimestampSchema,
  })
  .strict();

export type QmEffectProposal = z.infer<typeof QmEffectProposalSchema>;

export const QmDecisionReceiptSchema = z
  .object({
    receiptId: uuidSchema,
    requestId: uuidSchema,
    inputDigest: sha256Schema,
    organizationId: uuidSchema,
    actorEmployeeId: uuidSchema,
    sessionId: uuidSchema,
    scopeId: safeReferenceSchema.nullable(),
    outcome: QmDecisionOutcomeSchema,
    reasonCode: QmReasonCodeSchema,
    requiredCapability: QmCapabilitySchema,
    sessionStateVersion: z.number().int().nonnegative().nullable(),
    sessionPolicyDigest: sha256Schema.nullable(),
    upstreamCommit: z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .nullable(),
    runtimeKind: z.enum(["local-synthetic", "provider"]).nullable(),
    providerReadbackReceipt: receiptReferenceSchema.nullable(),
    proposalId: uuidSchema.nullable(),
    precheckId: uuidSchema.nullable(),
    createdAt: isoTimestampSchema,
  })
  .strict()
  .superRefine((receipt, context) => {
    const sessionMetadata = [
      receipt.scopeId,
      receipt.sessionStateVersion,
      receipt.sessionPolicyDigest,
      receipt.upstreamCommit,
      receipt.runtimeKind,
    ];
    if (receipt.outcome === "denied") {
      if (
        receipt.reasonCode !== "AUTHORIZATION_DENIED" ||
        sessionMetadata.some((value) => value !== null) ||
        receipt.providerReadbackReceipt !== null ||
        receipt.proposalId !== null ||
        receipt.precheckId !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Denied QM receipts cannot disclose session metadata",
        });
      }
      return;
    }

    const reasonMatchesOutcome =
      (receipt.outcome === "workspace_read_precheck_recorded" &&
        receipt.reasonCode === "WORKSPACE_READ_PRECHECK_RECORDED" &&
        receipt.requiredCapability === "workspace.read") ||
      (receipt.outcome === "effect_proposal_recorded" &&
        receipt.reasonCode === "EFFECT_PROPOSAL_RECORDED" &&
        receipt.requiredCapability === "effect.propose") ||
      (receipt.outcome === "idempotency_conflict" &&
        ["REQUEST_ID_PAYLOAD_CONFLICT", "SESSION_POLICY_CHANGED"].includes(
          receipt.reasonCode,
        ));
    if (!reasonMatchesOutcome) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "QM receipt reason and capability must match its outcome",
      });
    }

    if (sessionMetadata.some((value) => value === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Authorized QM receipts must bind the session policy",
      });
    }
    if (
      receipt.runtimeKind === "provider" &&
      receipt.providerReadbackReceipt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider QM receipts require provider readback",
      });
    }
    if (
      receipt.runtimeKind === "local-synthetic" &&
      receipt.providerReadbackReceipt !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local QM receipts cannot carry provider readback",
      });
    }
  });

export type QmDecisionReceipt = z.infer<typeof QmDecisionReceiptSchema>;

export const QmStoredDecisionSchema = z
  .object({
    receipt: QmDecisionReceiptSchema,
    proposal: QmEffectProposalSchema.optional(),
    readPrecheck: QmWorkspaceReadPrecheckSchema.optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    const { receipt, proposal, readPrecheck } = decision;
    if (receipt.outcome === "effect_proposal_recorded") {
      if (
        !proposal ||
        readPrecheck ||
        receipt.proposalId !== proposal.proposalId ||
        receipt.precheckId !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Effect decisions require exactly one matching proposal",
        });
      }
    } else if (receipt.outcome === "workspace_read_precheck_recorded") {
      if (
        !readPrecheck ||
        proposal ||
        receipt.precheckId !== readPrecheck.precheckId ||
        receipt.proposalId !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Read decisions require exactly one matching precheck",
        });
      }
    } else if (
      proposal ||
      readPrecheck ||
      receipt.proposalId !== null ||
      receipt.precheckId !== null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Denied or conflicting decisions cannot carry work records",
      });
    }

    const workRecord = proposal ?? readPrecheck;
    if (
      workRecord &&
      (workRecord.organizationId !== receipt.organizationId ||
        workRecord.scopeId !== receipt.scopeId ||
        workRecord.sessionId !== receipt.sessionId ||
        workRecord.createdAt !== receipt.createdAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "QM work records must match their decision receipt",
      });
    }
    if (
      (proposal && proposal.proposedByEmployeeId !== receipt.actorEmployeeId) ||
      (readPrecheck &&
        readPrecheck.requestedByEmployeeId !== receipt.actorEmployeeId)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "QM work records must match the authenticated actor",
      });
    }
  });

export type QmStoredDecision = z.infer<typeof QmStoredDecisionSchema>;

export type QmCommandDecision = QmStoredDecision & {
  replayed: boolean;
};

export const QmDecisionKeySchema = z
  .object({
    organizationId: uuidSchema,
    actorEmployeeId: uuidSchema,
    requestId: uuidSchema,
  })
  .strict();

export type QmDecisionKey = z.infer<typeof QmDecisionKeySchema>;

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

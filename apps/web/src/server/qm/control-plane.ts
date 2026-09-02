import { createHash, randomUUID } from "node:crypto";
import {
  QmCommandEnvelopeSchema,
  QmSessionBindingSchema,
  QmTrustedPrincipalSchema,
  personalQmScopeId,
  type QmCapability,
  type QmCommandDecision,
  type QmCommandEnvelope,
  type QmControlRepository,
  type QmDecisionOutcome,
  type QmDecisionReceipt,
  type QmEffectProposal,
  type QmReasonCode,
  type QmSessionBinding,
  type QmStoredDecision,
  type QmTrustedPrincipal,
  type QmWorkspaceReadPrecheck,
} from "./contracts";

export type QmControlPlaneDependencies = {
  repository: QmControlRepository;
  clock?: () => Date;
  idFactory?: () => string;
};

type Authorization =
  | {
      allowed: true;
      requiredCapability: QmCapability;
      session: QmSessionBinding;
    }
  | { allowed: false; requiredCapability: QmCapability };

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function objectDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function qmCommandDigest(
  principal: QmTrustedPrincipal,
  envelope: QmCommandEnvelope,
): string {
  return objectDigest({ principal, envelope });
}

export function qmSessionPolicyDigest(session: QmSessionBinding): string {
  return objectDigest({
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    scopeId: session.scopeId,
    ownerEmployeeId: session.ownerEmployeeId,
    lifecycle: session.lifecycle,
    capabilities: [...session.capabilities].sort(),
    runtime: session.runtime,
    upstream: session.upstream,
    stateVersion: session.stateVersion,
  });
}

function textDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredCapability(
  command: QmCommandEnvelope["command"],
): QmCapability {
  return command.kind === "workspace.read_precheck_request"
    ? "workspace.read"
    : "effect.propose";
}

async function authorize(
  principal: QmTrustedPrincipal,
  envelope: QmCommandEnvelope,
  repository: QmControlRepository,
): Promise<Authorization> {
  const capability = requiredCapability(envelope.command);
  const rawSession = await repository.getSession(envelope.sessionId);
  const parsedSession = QmSessionBindingSchema.safeParse(rawSession);
  if (!parsedSession.success) {
    return { allowed: false, requiredCapability: capability };
  }

  const session = parsedSession.data;
  const expectedScope = personalQmScopeId(
    session.organizationId,
    session.ownerEmployeeId,
  );
  if (
    session.lifecycle !== "active" ||
    session.organizationId !== principal.organizationId ||
    session.ownerEmployeeId !== principal.employeeId ||
    session.scopeId !== expectedScope ||
    !session.capabilities.includes(capability)
  ) {
    return { allowed: false, requiredCapability: capability };
  }

  return { allowed: true, requiredCapability: capability, session };
}

function newReceipt(input: {
  principal: QmTrustedPrincipal;
  envelope: QmCommandEnvelope;
  inputDigest: string;
  authorization: Authorization;
  outcome: QmDecisionOutcome;
  reasonCode: QmReasonCode;
  proposalId?: string;
  precheckId?: string;
  createdAt: string;
  idFactory: () => string;
}): QmDecisionReceipt {
  const session = input.authorization.allowed
    ? input.authorization.session
    : null;
  return {
    receiptId: input.idFactory(),
    requestId: input.envelope.requestId,
    inputDigest: input.inputDigest,
    organizationId: input.principal.organizationId,
    actorEmployeeId: input.principal.employeeId,
    sessionId: input.envelope.sessionId,
    scopeId: session?.scopeId ?? null,
    outcome: input.outcome,
    reasonCode: input.reasonCode,
    requiredCapability: input.authorization.requiredCapability,
    sessionStateVersion: session?.stateVersion ?? null,
    sessionPolicyDigest: session ? qmSessionPolicyDigest(session) : null,
    upstreamCommit: session?.upstream.commit ?? null,
    runtimeKind: session?.runtime.kind ?? null,
    providerReadbackReceipt:
      session?.runtime.kind === "provider"
        ? session.runtime.readbackReceipt
        : null,
    proposalId: input.proposalId ?? null,
    precheckId: input.precheckId ?? null,
    createdAt: input.createdAt,
  };
}

function replayOrConflict(input: {
  existing: QmStoredDecision;
  principal: QmTrustedPrincipal;
  envelope: QmCommandEnvelope;
  inputDigest: string;
  authorization: Extract<Authorization, { allowed: true }>;
  createdAt: string;
  idFactory: () => string;
}): QmCommandDecision {
  const receipt = input.existing.receipt;
  const currentPolicyDigest = qmSessionPolicyDigest(
    input.authorization.session,
  );
  const policyUnchanged =
    receipt.organizationId === input.principal.organizationId &&
    receipt.actorEmployeeId === input.principal.employeeId &&
    receipt.sessionId === input.envelope.sessionId &&
    receipt.sessionStateVersion === input.authorization.session.stateVersion &&
    receipt.sessionPolicyDigest === currentPolicyDigest;

  if (!policyUnchanged) {
    return {
      replayed: false,
      receipt: newReceipt({
        principal: input.principal,
        envelope: input.envelope,
        inputDigest: input.inputDigest,
        authorization: input.authorization,
        outcome: "idempotency_conflict",
        reasonCode: "SESSION_POLICY_CHANGED",
        createdAt: input.createdAt,
        idFactory: input.idFactory,
      }),
    };
  }

  if (receipt.inputDigest !== input.inputDigest) {
    return {
      replayed: false,
      receipt: newReceipt({
        principal: input.principal,
        envelope: input.envelope,
        inputDigest: input.inputDigest,
        authorization: input.authorization,
        outcome: "idempotency_conflict",
        reasonCode: "REQUEST_ID_PAYLOAD_CONFLICT",
        createdAt: input.createdAt,
        idFactory: input.idFactory,
      }),
    };
  }

  return { ...input.existing, replayed: true };
}

function deniedDecision(input: {
  principal: QmTrustedPrincipal;
  envelope: QmCommandEnvelope;
  inputDigest: string;
  authorization: Extract<Authorization, { allowed: false }>;
  createdAt: string;
  idFactory: () => string;
}): QmStoredDecision {
  return {
    receipt: newReceipt({
      ...input,
      outcome: "denied",
      reasonCode: "AUTHORIZATION_DENIED",
    }),
  };
}

/**
 * Re-authorize and record a QM request without reading repository data or
 * executing an external effect. The principal must come from HRMNY's trusted
 * server context; identity fields are deliberately absent from the command.
 *
 * A read result is only a precheck. A repository adapter must still resolve
 * resource ownership. External work remains a proposal until HRMNY's separate
 * approval and effect-broker lifecycle authorizes it.
 */
export async function evaluateQmCommand(
  rawEnvelope: unknown,
  rawPrincipal: unknown,
  dependencies: QmControlPlaneDependencies,
): Promise<QmCommandDecision> {
  const envelope = QmCommandEnvelopeSchema.parse(rawEnvelope);
  const principal = QmTrustedPrincipalSchema.parse(rawPrincipal);
  const inputDigest = qmCommandDigest(principal, envelope);
  const createdAt = (dependencies.clock ?? (() => new Date()))().toISOString();
  const idFactory = dependencies.idFactory ?? randomUUID;
  const authorization = await authorize(
    principal,
    envelope,
    dependencies.repository,
  );

  if (!authorization.allowed) {
    const denial = deniedDecision({
      principal,
      envelope,
      inputDigest,
      authorization,
      createdAt,
      idFactory,
    });
    const committed = await dependencies.repository.commitDecision(denial);
    if (committed.status === "inserted") {
      return { ...committed.decision, replayed: false };
    }

    // Never replay a previously allowed decision after authorization fails.
    return { ...denial, replayed: false };
  }

  const decisionKey = {
    organizationId: principal.organizationId,
    actorEmployeeId: principal.employeeId,
    requestId: envelope.requestId,
  };
  const prior = await dependencies.repository.getDecision(decisionKey);
  if (prior) {
    return replayOrConflict({
      existing: prior,
      principal,
      envelope,
      inputDigest,
      authorization,
      createdAt,
      idFactory,
    });
  }

  let proposal: QmEffectProposal | undefined;
  let readPrecheck: QmWorkspaceReadPrecheck | undefined;
  let outcome: QmDecisionOutcome;
  let reasonCode: QmReasonCode;

  if (envelope.command.kind === "workspace.read_precheck_request") {
    const precheckId = idFactory();
    outcome = "workspace_read_precheck_recorded";
    reasonCode = "WORKSPACE_READ_PRECHECK_RECORDED";
    readPrecheck = {
      precheckId,
      organizationId: principal.organizationId,
      scopeId: authorization.session.scopeId,
      sessionId: envelope.sessionId,
      requestedByEmployeeId: principal.employeeId,
      resourceKind: envelope.command.resourceKind,
      resourceId: envelope.command.resourceId,
      purposeDigest: textDigest(envelope.command.purpose),
      resolution: "repository-scope-required",
      createdAt,
    };
  } else {
    const proposalId = idFactory();
    outcome = "effect_proposal_recorded";
    reasonCode = "EFFECT_PROPOSAL_RECORDED";
    proposal = {
      proposalId,
      organizationId: principal.organizationId,
      scopeId: authorization.session.scopeId,
      sessionId: envelope.sessionId,
      proposedByEmployeeId: principal.employeeId,
      effectKind: envelope.command.effectKind,
      targetRef: envelope.command.targetRef,
      previewDigest: envelope.command.previewDigest,
      rationaleDigest: textDigest(envelope.command.rationale),
      status: "proposed",
      createdAt,
    };
  }

  const decision: QmStoredDecision = {
    receipt: newReceipt({
      principal,
      envelope,
      inputDigest,
      authorization,
      outcome,
      reasonCode,
      proposalId: proposal?.proposalId,
      precheckId: readPrecheck?.precheckId,
      createdAt,
      idFactory,
    }),
    ...(proposal ? { proposal } : {}),
    ...(readPrecheck ? { readPrecheck } : {}),
  };
  const committed = await dependencies.repository.commitDecision(decision);
  if (committed.status === "existing") {
    return replayOrConflict({
      existing: committed.decision,
      principal,
      envelope,
      inputDigest,
      authorization,
      createdAt,
      idFactory,
    });
  }
  return { ...committed.decision, replayed: false };
}

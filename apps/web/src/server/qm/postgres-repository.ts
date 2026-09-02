import {
  and,
  eq,
  qmCommandDecision,
  qmSessionBinding,
  type Db,
} from "@hrmny/db";
import {
  QmDecisionKeySchema,
  QmSessionBindingSchema,
  QmStoredDecisionSchema,
  type QmControlRepository,
  type QmDecisionKey,
  type QmSessionBinding,
  type QmStoredDecision,
} from "./contracts";
import { qmSessionPolicyDigest } from "./control-plane";

type QmSessionRow = typeof qmSessionBinding.$inferSelect;
type QmDecisionRow = typeof qmCommandDecision.$inferSelect;

export const QM_SESSION_POLICY_CHANGED_BEFORE_COMMIT =
  "QM_SESSION_POLICY_CHANGED_BEFORE_COMMIT";
export const QM_DECISION_RECONCILIATION_REQUIRED =
  "QM_DECISION_RECONCILIATION_REQUIRED";

export function parseQmSessionRow(row: QmSessionRow): QmSessionBinding {
  const capabilities = [
    ...(row.workspaceReadEnabled ? (["workspace.read"] as const) : []),
    ...(row.effectProposeEnabled ? (["effect.propose"] as const) : []),
  ];
  let runtime: QmSessionBinding["runtime"];
  if (
    row.runtimeKind === "local-synthetic" &&
    row.localFixtureId !== null &&
    row.provider === null &&
    row.providerResourceRef === null &&
    row.providerReadbackReceipt === null
  ) {
    runtime = {
      kind: "local-synthetic",
      fixtureId: row.localFixtureId,
    };
  } else if (
    row.runtimeKind === "provider" &&
    row.localFixtureId === null &&
    row.provider === "flyio" &&
    row.providerResourceRef !== null &&
    row.providerReadbackReceipt !== null
  ) {
    runtime = {
      kind: "provider",
      provider: row.provider,
      resourceRef: row.providerResourceRef,
      readbackReceipt: row.providerReadbackReceipt,
    };
  } else {
    throw new Error("QM_SESSION_RUNTIME_ROW_INVALID");
  }

  return QmSessionBindingSchema.parse({
    sessionId: row.sessionId,
    organizationId: row.organizationId,
    ownerEmployeeId: row.ownerEmployeeId,
    scopeId: row.scopeId,
    lifecycle: row.lifecycle,
    capabilities,
    runtime,
    upstream: {
      version: row.upstreamVersion,
      commit: row.upstreamCommit,
    },
    stateVersion: row.stateVersion,
  });
}

export function parseQmDecisionRow(row: QmDecisionRow): QmStoredDecision {
  return QmStoredDecisionSchema.parse({
    receipt: {
      receiptId: row.receiptId,
      requestId: row.requestId,
      inputDigest: row.inputDigest,
      organizationId: row.organizationId,
      actorEmployeeId: row.actorEmployeeId,
      sessionId: row.sessionId,
      scopeId: row.scopeId,
      outcome: row.outcome,
      reasonCode: row.reasonCode,
      requiredCapability: row.requiredCapability,
      sessionStateVersion: row.sessionStateVersion,
      sessionPolicyDigest: row.sessionPolicyDigest,
      upstreamCommit: row.upstreamCommit,
      runtimeKind: row.runtimeKind,
      providerReadbackReceipt: row.providerReadbackReceipt,
      proposalId: row.proposalId,
      precheckId: row.precheckId,
      createdAt: row.recordedAt.toISOString(),
    },
    ...(row.proposal === null ? {} : { proposal: row.proposal }),
    ...(row.readPrecheck === null ? {} : { readPrecheck: row.readPrecheck }),
  });
}

function assertSessionStillAuthorizes(
  session: QmSessionBinding,
  decision: QmStoredDecision,
): void {
  const { receipt } = decision;
  const providerReadback =
    session.runtime.kind === "provider"
      ? session.runtime.readbackReceipt
      : null;
  const valid =
    session.lifecycle === "active" &&
    session.sessionId === receipt.sessionId &&
    session.organizationId === receipt.organizationId &&
    session.ownerEmployeeId === receipt.actorEmployeeId &&
    session.scopeId === receipt.scopeId &&
    session.capabilities.includes(receipt.requiredCapability) &&
    session.stateVersion === receipt.sessionStateVersion &&
    qmSessionPolicyDigest(session) === receipt.sessionPolicyDigest &&
    session.upstream.commit === receipt.upstreamCommit &&
    session.runtime.kind === receipt.runtimeKind &&
    providerReadback === receipt.providerReadbackReceipt;
  if (!valid) throw new Error(QM_SESSION_POLICY_CHANGED_BEFORE_COMMIT);
}

function decisionValues(decision: QmStoredDecision) {
  const { receipt } = decision;
  return {
    receiptId: receipt.receiptId,
    requestId: receipt.requestId,
    inputDigest: receipt.inputDigest,
    organizationId: receipt.organizationId,
    actorEmployeeId: receipt.actorEmployeeId,
    sessionId: receipt.sessionId,
    scopeId: receipt.scopeId,
    outcome: receipt.outcome,
    reasonCode: receipt.reasonCode,
    requiredCapability: receipt.requiredCapability,
    sessionStateVersion: receipt.sessionStateVersion,
    sessionPolicyDigest: receipt.sessionPolicyDigest,
    upstreamCommit: receipt.upstreamCommit,
    runtimeKind: receipt.runtimeKind,
    providerReadbackReceipt: receipt.providerReadbackReceipt,
    proposalId: receipt.proposalId,
    precheckId: receipt.precheckId,
    proposal: decision.proposal ?? null,
    readPrecheck: decision.readPrecheck ?? null,
    recordedAt: new Date(receipt.createdAt),
  };
}

/**
 * Server-only durable authority ledger. A Db must be supplied explicitly;
 * this repository never falls back to process memory.
 */
export function createPostgresQmControlRepository(db: Db): QmControlRepository {
  return {
    async getSession(sessionId) {
      const parsedSessionId =
        QmSessionBindingSchema.shape.sessionId.parse(sessionId);
      const [row] = await db
        .select()
        .from(qmSessionBinding)
        .where(eq(qmSessionBinding.sessionId, parsedSessionId))
        .limit(1);
      return row ? parseQmSessionRow(row) : null;
    },

    async getDecision(rawKey: QmDecisionKey) {
      const key = QmDecisionKeySchema.parse(rawKey);
      const [row] = await db
        .select()
        .from(qmCommandDecision)
        .where(
          and(
            eq(qmCommandDecision.organizationId, key.organizationId),
            eq(qmCommandDecision.actorEmployeeId, key.actorEmployeeId),
            eq(qmCommandDecision.requestId, key.requestId),
          ),
        )
        .limit(1);
      return row ? parseQmDecisionRow(row) : null;
    },

    async commitDecision(rawDecision) {
      const decision = QmStoredDecisionSchema.parse(rawDecision);
      return db.transaction(async (tx) => {
        if (decision.receipt.outcome !== "denied") {
          const [sessionRow] = await tx
            .select()
            .from(qmSessionBinding)
            .where(eq(qmSessionBinding.sessionId, decision.receipt.sessionId))
            .for("share")
            .limit(1);
          if (!sessionRow) {
            throw new Error(QM_SESSION_POLICY_CHANGED_BEFORE_COMMIT);
          }
          assertSessionStillAuthorizes(parseQmSessionRow(sessionRow), decision);
        }

        const [inserted] = await tx
          .insert(qmCommandDecision)
          .values(decisionValues(decision))
          .onConflictDoNothing({
            target: [
              qmCommandDecision.organizationId,
              qmCommandDecision.actorEmployeeId,
              qmCommandDecision.requestId,
            ],
          })
          .returning();
        if (inserted) {
          return {
            status: "inserted" as const,
            decision: parseQmDecisionRow(inserted),
          };
        }

        const [existing] = await tx
          .select()
          .from(qmCommandDecision)
          .where(
            and(
              eq(
                qmCommandDecision.organizationId,
                decision.receipt.organizationId,
              ),
              eq(
                qmCommandDecision.actorEmployeeId,
                decision.receipt.actorEmployeeId,
              ),
              eq(qmCommandDecision.requestId, decision.receipt.requestId),
            ),
          )
          .limit(1);
        if (!existing) {
          throw new Error(QM_DECISION_RECONCILIATION_REQUIRED);
        }
        return {
          status: "existing" as const,
          decision: parseQmDecisionRow(existing),
        };
      });
    },
  };
}

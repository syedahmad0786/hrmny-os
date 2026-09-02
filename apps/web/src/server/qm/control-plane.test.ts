import { describe, expect, it } from "vitest";
import {
  QmCommandEnvelopeSchema,
  QmRuntimeBindingSchema,
  QmTrustedPrincipalSchema,
  personalQmScopeId,
  type QmControlRepository,
  type QmDecisionKey,
  type QmSessionBinding,
  type QmStoredDecision,
  type QmTrustedPrincipal,
} from "./contracts";
import { evaluateQmCommand, qmSessionPolicyDigest } from "./control-plane";
import { QM_UPSTREAM_PIN } from "./source-pin";

const ORGANIZATION_A = "10000000-0000-4000-8000-000000000001";
const ORGANIZATION_B = "10000000-0000-4000-8000-000000000002";
const EMPLOYEE_A = "20000000-0000-4000-8000-000000000001";
const EMPLOYEE_B = "20000000-0000-4000-8000-000000000002";
const SESSION_A = "30000000-0000-4000-8000-000000000001";
const SESSION_B = "30000000-0000-4000-8000-000000000002";
const REQUEST_A = "40000000-0000-4000-8000-000000000001";
const REQUEST_B = "40000000-0000-4000-8000-000000000002";
const RESOURCE_A = "60000000-0000-4000-8000-000000000001";
const PREVIEW_DIGEST = "a".repeat(64);

const PRINCIPAL_A: QmTrustedPrincipal = {
  organizationId: ORGANIZATION_A,
  employeeId: EMPLOYEE_A,
};
const PRINCIPAL_B: QmTrustedPrincipal = {
  organizationId: ORGANIZATION_A,
  employeeId: EMPLOYEE_B,
};

function session(input: {
  sessionId: string;
  organizationId?: string;
  employeeId: string;
  capabilities?: Array<"workspace.read" | "effect.propose">;
  lifecycle?: "active" | "suspended" | "revoked";
  stateVersion?: number;
  fixtureId?: string;
}): QmSessionBinding {
  const organizationId = input.organizationId ?? ORGANIZATION_A;
  return {
    sessionId: input.sessionId,
    organizationId,
    ownerEmployeeId: input.employeeId,
    scopeId: personalQmScopeId(organizationId, input.employeeId),
    lifecycle: input.lifecycle ?? "active",
    capabilities: input.capabilities ?? ["workspace.read", "effect.propose"],
    runtime: {
      kind: "local-synthetic",
      fixtureId: input.fixtureId ?? `fixture:${input.sessionId}`,
    },
    upstream: {
      version: QM_UPSTREAM_PIN.version,
      commit: QM_UPSTREAM_PIN.commit,
    },
    stateVersion: input.stateVersion ?? 0,
  };
}

class MemoryRepository implements QmControlRepository {
  readonly sessions = new Map<string, QmSessionBinding>();
  readonly decisions = new Map<string, QmStoredDecision>();
  commits = 0;

  constructor(sessions: QmSessionBinding[]) {
    for (const binding of sessions) {
      this.sessions.set(binding.sessionId, binding);
    }
  }

  async getSession(sessionId: string) {
    return this.sessions.get(sessionId) ?? null;
  }

  private decisionKey(key: QmDecisionKey) {
    return `${key.organizationId}:${key.actorEmployeeId}:${key.requestId}`;
  }

  async getDecision(key: QmDecisionKey) {
    return this.decisions.get(this.decisionKey(key)) ?? null;
  }

  async commitDecision(decision: QmStoredDecision) {
    const key = this.decisionKey(decision.receipt);
    const existing = this.decisions.get(key);
    if (existing) return { status: "existing" as const, decision: existing };
    this.decisions.set(key, decision);
    this.commits += 1;
    return { status: "inserted" as const, decision };
  }
}

function dependencies(repository: QmControlRepository) {
  let nextId = 0;
  return {
    repository,
    clock: () => new Date("2026-09-02T03:00:00.000Z"),
    idFactory: () =>
      `50000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
  };
}

function readEnvelope(input?: { sessionId?: string; requestId?: string }) {
  return {
    sessionId: input?.sessionId ?? SESSION_A,
    requestId: input?.requestId ?? REQUEST_A,
    command: {
      kind: "workspace.read_precheck_request" as const,
      resourceKind: "work" as const,
      resourceId: RESOURCE_A,
      purpose: "Precheck my owned synthetic work item",
    },
  };
}

function proposalEnvelope(requestId = REQUEST_B) {
  return {
    sessionId: SESSION_A,
    requestId,
    command: {
      kind: "effect.proposal_request" as const,
      effectKind: "provider.message.send" as const,
      targetRef: "google-chat:space:synthetic",
      previewDigest: PREVIEW_DIGEST,
      rationale: "Ask a human reviewer to approve the synthetic preview",
    },
  };
}

describe("QM control-plane contract", () => {
  it("uses a trusted principal and records only a repository-scope precheck", async () => {
    const binding = session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A });
    const repository = new MemoryRepository([binding]);

    const own = await evaluateQmCommand(
      readEnvelope(),
      PRINCIPAL_A,
      dependencies(repository),
    );

    expect(own.receipt).toMatchObject({
      outcome: "workspace_read_precheck_recorded",
      reasonCode: "WORKSPACE_READ_PRECHECK_RECORDED",
      scopeId: personalQmScopeId(ORGANIZATION_A, EMPLOYEE_A),
      requiredCapability: "workspace.read",
      sessionStateVersion: 0,
      sessionPolicyDigest: qmSessionPolicyDigest(binding),
      upstreamCommit: QM_UPSTREAM_PIN.commit,
      runtimeKind: "local-synthetic",
      providerReadbackReceipt: null,
    });
    expect(own.readPrecheck).toMatchObject({
      resourceId: RESOURCE_A,
      resolution: "repository-scope-required",
    });
    expect(own.readPrecheck?.purposeDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(own)).not.toContain(
      "Precheck my owned synthetic work item",
    );
  });

  it("denies cross-owner access without disclosing stored scope metadata", async () => {
    const repository = new MemoryRepository([
      session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A }),
    ]);

    const result = await evaluateQmCommand(
      readEnvelope(),
      PRINCIPAL_B,
      dependencies(repository),
    );

    expect(result.replayed).toBe(false);
    expect(result.receipt).toMatchObject({
      outcome: "denied",
      reasonCode: "AUTHORIZATION_DENIED",
      actorEmployeeId: EMPLOYEE_B,
      scopeId: null,
      sessionStateVersion: null,
      sessionPolicyDigest: null,
      upstreamCommit: null,
      runtimeKind: null,
      providerReadbackReceipt: null,
    });
    expect(result.readPrecheck).toBeUndefined();
  });

  it("fails closed when a capability is not explicitly granted", async () => {
    const repository = new MemoryRepository([
      session({
        sessionId: SESSION_A,
        employeeId: EMPLOYEE_A,
        capabilities: ["workspace.read"],
      }),
    ]);

    const result = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      dependencies(repository),
    );

    expect(result.receipt).toMatchObject({
      outcome: "denied",
      reasonCode: "AUTHORIZATION_DENIED",
      requiredCapability: "effect.propose",
      scopeId: null,
      proposalId: null,
    });
    expect(result.proposal).toBeUndefined();
  });

  it("records a digest-only proposal and exposes no direct-effect command", async () => {
    const repository = new MemoryRepository([
      session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A }),
    ]);

    const result = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      dependencies(repository),
    );

    expect(result.receipt).toMatchObject({
      outcome: "effect_proposal_recorded",
      reasonCode: "EFFECT_PROPOSAL_RECORDED",
      requiredCapability: "effect.propose",
    });
    expect(result.proposal).toMatchObject({
      status: "proposed",
      effectKind: "provider.message.send",
      previewDigest: PREVIEW_DIGEST,
    });
    expect(result.proposal?.rationaleDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(
      "Ask a human reviewer to approve the synthetic preview",
    );
    expect(() =>
      QmCommandEnvelopeSchema.parse({
        ...proposalEnvelope(),
        command: {
          kind: "effect.execute",
          effectKind: "provider.message.send",
          payload: "send now",
        },
      }),
    ).toThrow();
  });

  it("strictly rejects caller identity, payload, credential, and principal extras", () => {
    expect(() =>
      QmCommandEnvelopeSchema.parse({
        ...proposalEnvelope(),
        organizationId: ORGANIZATION_A,
        actorEmployeeId: EMPLOYEE_A,
      }),
    ).toThrow();
    expect(() =>
      QmCommandEnvelopeSchema.parse({
        ...proposalEnvelope(),
        command: {
          ...proposalEnvelope().command,
          payload: { secret: "must-not-enter-the-ledger" },
          credential: "forbidden",
        },
      }),
    ).toThrow();
    expect(() =>
      QmTrustedPrincipalSchema.parse({
        ...PRINCIPAL_A,
        sessionToken: "forbidden",
      }),
    ).toThrow();
  });

  it("replays identical requests and rejects request-id payload changes", async () => {
    const repository = new MemoryRepository([
      session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A }),
    ]);
    const deps = dependencies(repository);
    const first = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      deps,
    );
    const replay = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      deps,
    );
    const conflict = await evaluateQmCommand(
      {
        ...proposalEnvelope(),
        command: {
          ...proposalEnvelope().command,
          targetRef: "google-chat:space:different",
        },
      },
      PRINCIPAL_A,
      deps,
    );

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(replay.proposal?.proposalId).toBe(first.proposal?.proposalId);
    expect(repository.commits).toBe(1);
    expect(conflict.receipt).toMatchObject({
      outcome: "idempotency_conflict",
      reasonCode: "REQUEST_ID_PAYLOAD_CONFLICT",
    });
  });

  it("does not replay an allowed decision after session revocation", async () => {
    const active = session({
      sessionId: SESSION_A,
      employeeId: EMPLOYEE_A,
    });
    const repository = new MemoryRepository([active]);
    const deps = dependencies(repository);
    const first = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      deps,
    );
    repository.sessions.set(SESSION_A, {
      ...active,
      lifecycle: "revoked",
      stateVersion: 1,
    });

    const afterRevocation = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      deps,
    );

    expect(first.receipt.outcome).toBe("effect_proposal_recorded");
    expect(afterRevocation.replayed).toBe(false);
    expect(afterRevocation.receipt).toMatchObject({
      outcome: "denied",
      reasonCode: "AUTHORIZATION_DENIED",
      scopeId: null,
      sessionStateVersion: null,
    });
    expect(afterRevocation.receipt.receiptId).not.toBe(first.receipt.receiptId);
    expect(afterRevocation.proposal).toBeUndefined();
  });

  it("does not replay after capability removal", async () => {
    const active = session({
      sessionId: SESSION_A,
      employeeId: EMPLOYEE_A,
    });
    const repository = new MemoryRepository([active]);
    const deps = dependencies(repository);
    await evaluateQmCommand(proposalEnvelope(), PRINCIPAL_A, deps);
    repository.sessions.set(SESSION_A, {
      ...active,
      capabilities: ["workspace.read"],
      stateVersion: 1,
    });

    const result = await evaluateQmCommand(
      proposalEnvelope(),
      PRINCIPAL_A,
      deps,
    );

    expect(result.replayed).toBe(false);
    expect(result.receipt).toMatchObject({
      outcome: "denied",
      reasonCode: "AUTHORIZATION_DENIED",
      scopeId: null,
    });
  });

  it("requires a new request ID after an authorized session policy change", async () => {
    const active = session({
      sessionId: SESSION_A,
      employeeId: EMPLOYEE_A,
    });
    const repository = new MemoryRepository([active]);
    const deps = dependencies(repository);
    await evaluateQmCommand(readEnvelope(), PRINCIPAL_A, deps);
    repository.sessions.set(SESSION_A, {
      ...active,
      stateVersion: 1,
      runtime: {
        kind: "local-synthetic",
        fixtureId: "fixture:rotated",
      },
    });

    const result = await evaluateQmCommand(readEnvelope(), PRINCIPAL_A, deps);

    expect(result.replayed).toBe(false);
    expect(result.receipt).toMatchObject({
      outcome: "idempotency_conflict",
      reasonCode: "SESSION_POLICY_CHANGED",
      sessionStateVersion: 1,
    });
  });

  it("uses the same generic denial for suspended and wrong-organization sessions", async () => {
    const suspendedRepository = new MemoryRepository([
      session({
        sessionId: SESSION_A,
        employeeId: EMPLOYEE_A,
        lifecycle: "suspended",
      }),
    ]);
    const wrongOrganizationRepository = new MemoryRepository([
      session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A }),
    ]);
    const wrongOrganizationPrincipal = {
      organizationId: ORGANIZATION_B,
      employeeId: EMPLOYEE_A,
    };

    const suspended = await evaluateQmCommand(
      readEnvelope(),
      PRINCIPAL_A,
      dependencies(suspendedRepository),
    );
    const wrongOrganization = await evaluateQmCommand(
      readEnvelope(),
      wrongOrganizationPrincipal,
      dependencies(wrongOrganizationRepository),
    );

    for (const result of [suspended, wrongOrganization]) {
      expect(result.receipt).toMatchObject({
        outcome: "denied",
        reasonCode: "AUTHORIZATION_DENIED",
        scopeId: null,
        sessionPolicyDigest: null,
      });
    }
  });

  it("requires provider readback and rejects unmodeled runtime fields", () => {
    expect(() =>
      QmRuntimeBindingSchema.parse({
        kind: "provider",
        provider: "flyio",
        resourceRef: "fly:app:synthetic",
      }),
    ).toThrow();
    expect(() =>
      QmRuntimeBindingSchema.parse({
        kind: "provider",
        provider: "flyio",
        resourceRef: "fly:app:synthetic",
        readbackReceipt: "receipt:flyio:synthetic-readback",
        credential: "forbidden",
      }),
    ).toThrow();
    expect(
      QmRuntimeBindingSchema.parse({
        kind: "provider",
        provider: "flyio",
        resourceRef: "fly:app:synthetic",
        readbackReceipt: "receipt:flyio:synthetic-readback",
      }),
    ).toMatchObject({ kind: "provider", provider: "flyio" });
  });

  it("commits a concurrent duplicate once at the repository boundary", async () => {
    const repository = new MemoryRepository([
      session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A }),
    ]);
    const deps = dependencies(repository);
    const [first, second] = await Promise.all([
      evaluateQmCommand(proposalEnvelope(), PRINCIPAL_A, deps),
      evaluateQmCommand(proposalEnvelope(), PRINCIPAL_A, deps),
    ]);

    expect(repository.commits).toBe(1);
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
  });

  it("namespaces request IDs by trusted organization and principal", async () => {
    const repository = new MemoryRepository([
      session({ sessionId: SESSION_A, employeeId: EMPLOYEE_A }),
      session({ sessionId: SESSION_B, employeeId: EMPLOYEE_B }),
    ]);
    const deps = dependencies(repository);
    const first = await evaluateQmCommand(readEnvelope(), PRINCIPAL_A, deps);
    const independent = await evaluateQmCommand(
      readEnvelope({ sessionId: SESSION_B }),
      PRINCIPAL_B,
      deps,
    );

    expect(independent.replayed).toBe(false);
    expect(independent.receipt).toMatchObject({
      outcome: "workspace_read_precheck_recorded",
      reasonCode: "WORKSPACE_READ_PRECHECK_RECORDED",
      actorEmployeeId: EMPLOYEE_B,
      scopeId: personalQmScopeId(ORGANIZATION_A, EMPLOYEE_B),
    });
    expect(independent.receipt.receiptId).not.toBe(first.receipt.receiptId);
    expect(repository.commits).toBe(2);
  });
});

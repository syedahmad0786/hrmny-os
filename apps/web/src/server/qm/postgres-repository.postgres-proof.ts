import { randomUUID } from "node:crypto";
import {
  and,
  createDb,
  employee,
  eq,
  qmCommandDecision,
  qmSessionBinding,
  sql,
} from "@hrmny/db";
import { beforeAll, describe, expect, it } from "vitest";
import {
  personalQmScopeId,
  type QmControlRepository,
  type QmSessionBinding,
  type QmStoredDecision,
} from "./contracts";
import { evaluateQmCommand, qmSessionPolicyDigest } from "./control-plane";
import {
  createPostgresQmControlRepository,
  QM_SESSION_POLICY_CHANGED_BEFORE_COMMIT,
} from "./postgres-repository";
import { QM_UPSTREAM_PIN } from "./source-pin";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("CI_POSTGRES_DATABASE_URL_REQUIRED");

const databaseA = createDb(databaseUrl);
const databaseB = createDb(databaseUrl);
const repositoryA = createPostgresQmControlRepository(databaseA);
const repositoryB = createPostgresQmControlRepository(databaseB);

const ORGANIZATION_A = randomUUID();
const ORGANIZATION_B = randomUUID();
const EMPLOYEE_A = randomUUID();
const EMPLOYEE_B = randomUUID();
const SESSION_A = randomUUID();
const SESSION_B = randomUUID();
const REQUEST_A = randomUUID();
const REQUEST_B = randomUUID();
const RESOURCE_B = randomUUID();

function binding(input: {
  organizationId: string;
  employeeId: string;
  sessionId: string;
  fixtureId: string;
}): QmSessionBinding {
  return {
    sessionId: input.sessionId,
    organizationId: input.organizationId,
    ownerEmployeeId: input.employeeId,
    scopeId: personalQmScopeId(input.organizationId, input.employeeId),
    lifecycle: "active",
    capabilities: ["workspace.read", "effect.propose"],
    runtime: { kind: "local-synthetic", fixtureId: input.fixtureId },
    upstream: {
      version: QM_UPSTREAM_PIN.version,
      commit: QM_UPSTREAM_PIN.commit,
    },
    stateVersion: 0,
  };
}

const BINDING_A = binding({
  organizationId: ORGANIZATION_A,
  employeeId: EMPLOYEE_A,
  sessionId: SESSION_A,
  fixtureId: "fixture:ci-qm-a",
});
const BINDING_B = binding({
  organizationId: ORGANIZATION_B,
  employeeId: EMPLOYEE_B,
  sessionId: SESSION_B,
  fixtureId: "fixture:ci-qm-b",
});

function sessionValues(session: QmSessionBinding) {
  if (session.runtime.kind !== "local-synthetic") {
    throw new Error("CI_QM_LOCAL_FIXTURE_REQUIRED");
  }
  return {
    sessionId: session.sessionId,
    organizationId: session.organizationId,
    ownerEmployeeId: session.ownerEmployeeId,
    scopeId: session.scopeId,
    lifecycle: session.lifecycle,
    workspaceReadEnabled: session.capabilities.includes("workspace.read"),
    effectProposeEnabled: session.capabilities.includes("effect.propose"),
    runtimeKind: session.runtime.kind,
    localFixtureId: session.runtime.fixtureId,
    upstreamVersion: session.upstream.version,
    upstreamCommit: session.upstream.commit,
    stateVersion: session.stateVersion,
  };
}

beforeAll(async () => {
  await databaseA.insert(employee).values([
    {
      employeeId: EMPLOYEE_A,
      displayName: "QM CI Employee A",
      email: `qm-ci-a-${EMPLOYEE_A}@hrmny.invalid`,
    },
    {
      employeeId: EMPLOYEE_B,
      displayName: "QM CI Employee B",
      email: `qm-ci-b-${EMPLOYEE_B}@hrmny.invalid`,
    },
  ]);
  await databaseA
    .insert(qmSessionBinding)
    .values([sessionValues(BINDING_A), sessionValues(BINDING_B)]);
});

describe("QM durable repository on disposable PostgreSQL", () => {
  it("linearizes concurrent identical proposals into one immutable record", async () => {
    const envelope = {
      sessionId: SESSION_A,
      requestId: REQUEST_A,
      command: {
        kind: "effect.proposal_request" as const,
        effectKind: "provider.message.send" as const,
        targetRef: "google-chat:space:ci-synthetic",
        previewDigest: "a".repeat(64),
        rationale: "Synthetic CI proposal only; no provider execution",
      },
    };
    const principal = {
      organizationId: ORGANIZATION_A,
      employeeId: EMPLOYEE_A,
    };
    const [first, second] = await Promise.all([
      evaluateQmCommand(envelope, principal, {
        repository: repositoryA,
        idFactory: randomUUID,
      }),
      evaluateQmCommand(envelope, principal, {
        repository: repositoryB,
        idFactory: randomUUID,
      }),
    ]);

    expect([first.replayed, second.replayed].sort()).toEqual([false, true]);
    expect(first.receipt.receiptId).toBe(second.receipt.receiptId);
    expect(first.proposal?.proposalId).toBe(second.proposal?.proposalId);
    const rows = await databaseA
      .select()
      .from(qmCommandDecision)
      .where(
        and(
          eq(qmCommandDecision.organizationId, ORGANIZATION_A),
          eq(qmCommandDecision.actorEmployeeId, EMPLOYEE_A),
          eq(qmCommandDecision.requestId, REQUEST_A),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.proposal).not.toHaveProperty("rationale");

    await expect(
      databaseA
        .update(qmCommandDecision)
        .set({ inputDigest: "b".repeat(64) })
        .where(eq(qmCommandDecision.receiptId, first.receipt.receiptId)),
    ).rejects.toThrow(/QM_DECISION_IMMUTABLE/);
    await expect(
      databaseA
        .delete(qmCommandDecision)
        .where(eq(qmCommandDecision.receiptId, first.receipt.receiptId)),
    ).rejects.toThrow(/QM_DECISION_IMMUTABLE/);
  });

  it("rejects an authorization decision after its session policy changes", async () => {
    let captured: QmStoredDecision | null = null;
    const captureRepository: QmControlRepository = {
      async getSession() {
        return BINDING_B;
      },
      async getDecision() {
        return null;
      },
      async commitDecision(decision) {
        captured = decision;
        return { status: "inserted", decision };
      },
    };
    await evaluateQmCommand(
      {
        sessionId: SESSION_B,
        requestId: REQUEST_B,
        command: {
          kind: "workspace.read_precheck_request",
          resourceKind: "work",
          resourceId: RESOURCE_B,
          purpose: "Synthetic stale-policy proof",
        },
      },
      { organizationId: ORGANIZATION_B, employeeId: EMPLOYEE_B },
      { repository: captureRepository, idFactory: randomUUID },
    );
    expect(captured).not.toBeNull();
    await databaseA
      .update(qmSessionBinding)
      .set({ lifecycle: "revoked", stateVersion: 1 })
      .where(eq(qmSessionBinding.sessionId, SESSION_B));

    await expect(repositoryA.commitDecision(captured!)).rejects.toThrow(
      QM_SESSION_POLICY_CHANGED_BEFORE_COMMIT,
    );
    expect(
      await repositoryA.getDecision({
        organizationId: ORGANIZATION_B,
        actorEmployeeId: EMPLOYEE_B,
        requestId: REQUEST_B,
      }),
    ).toBeNull();
  });

  it("keeps both authority tables inaccessible to browser Data API roles", async () => {
    const [boundary] = await databaseA.execute<{ ok: boolean }>(sql`
      select not (
        has_table_privilege('anon', 'public.qm_session_binding', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.qm_session_binding', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('anon', 'public.qm_command_decision', 'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated', 'public.qm_command_decision', 'SELECT,INSERT,UPDATE,DELETE')
      ) as ok
    `);
    expect(boundary?.ok).toBe(true);
  });

  it("rejects malformed raw JSON before it can consume an immutable key", async () => {
    const recordedAt = new Date("2026-09-02T06:00:00.000Z");
    await expect(
      databaseA.insert(qmCommandDecision).values({
        receiptId: randomUUID(),
        requestId: randomUUID(),
        inputDigest: "d".repeat(64),
        organizationId: ORGANIZATION_A,
        actorEmployeeId: EMPLOYEE_A,
        sessionId: SESSION_A,
        scopeId: BINDING_A.scopeId,
        outcome: "effect_proposal_recorded",
        reasonCode: "EFFECT_PROPOSAL_RECORDED",
        requiredCapability: "effect.propose",
        sessionStateVersion: 0,
        sessionPolicyDigest: qmSessionPolicyDigest(BINDING_A),
        upstreamCommit: QM_UPSTREAM_PIN.commit,
        runtimeKind: "local-synthetic",
        providerReadbackReceipt: null,
        proposalId: randomUUID(),
        precheckId: null,
        proposal: {},
        readPrecheck: null,
        recordedAt,
      }),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

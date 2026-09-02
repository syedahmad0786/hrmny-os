import { describe, expect, it } from "vitest";
import { personalQmScopeId } from "./contracts";
import { parseQmDecisionRow, parseQmSessionRow } from "./postgres-repository";
import { qmTrustedPrincipalFromStaffSession } from "./server-adapter";
import { QM_UPSTREAM_PIN } from "./source-pin";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000011";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000011";
const SESSION_ID = "30000000-0000-4000-8000-000000000011";
const REQUEST_ID = "40000000-0000-4000-8000-000000000011";
const RECEIPT_ID = "50000000-0000-4000-8000-000000000011";
const PRECHECK_ID = "60000000-0000-4000-8000-000000000011";
const RESOURCE_ID = "70000000-0000-4000-8000-000000000011";
const RECORDED_AT = new Date("2026-09-02T05:00:00.000Z");

function sessionRow() {
  return {
    sessionId: SESSION_ID,
    organizationId: ORGANIZATION_ID,
    ownerEmployeeId: EMPLOYEE_ID,
    scopeId: personalQmScopeId(ORGANIZATION_ID, EMPLOYEE_ID),
    lifecycle: "active",
    workspaceReadEnabled: true,
    effectProposeEnabled: false,
    runtimeKind: "local-synthetic",
    localFixtureId: "fixture:qm-unit",
    provider: null,
    providerResourceRef: null,
    providerReadbackReceipt: null,
    upstreamVersion: QM_UPSTREAM_PIN.version,
    upstreamCommit: QM_UPSTREAM_PIN.commit,
    stateVersion: 2,
    createdAt: RECORDED_AT,
    updatedAt: RECORDED_AT,
  };
}

function decisionRow() {
  const scopeId = personalQmScopeId(ORGANIZATION_ID, EMPLOYEE_ID);
  return {
    receiptId: RECEIPT_ID,
    requestId: REQUEST_ID,
    inputDigest: "a".repeat(64),
    organizationId: ORGANIZATION_ID,
    actorEmployeeId: EMPLOYEE_ID,
    sessionId: SESSION_ID,
    scopeId,
    outcome: "workspace_read_precheck_recorded",
    reasonCode: "WORKSPACE_READ_PRECHECK_RECORDED",
    requiredCapability: "workspace.read",
    sessionStateVersion: 2,
    sessionPolicyDigest: "b".repeat(64),
    upstreamCommit: QM_UPSTREAM_PIN.commit,
    runtimeKind: "local-synthetic",
    providerReadbackReceipt: null,
    proposalId: null,
    precheckId: PRECHECK_ID,
    proposal: null,
    readPrecheck: {
      precheckId: PRECHECK_ID,
      organizationId: ORGANIZATION_ID,
      scopeId,
      sessionId: SESSION_ID,
      requestedByEmployeeId: EMPLOYEE_ID,
      resourceKind: "work",
      resourceId: RESOURCE_ID,
      purposeDigest: "c".repeat(64),
      resolution: "repository-scope-required",
      createdAt: RECORDED_AT.toISOString(),
    },
    recordedAt: RECORDED_AT,
  };
}

describe("QM PostgreSQL row contracts", () => {
  it("rebuilds explicit capabilities and the pinned synthetic runtime", () => {
    expect(parseQmSessionRow(sessionRow())).toEqual({
      sessionId: SESSION_ID,
      organizationId: ORGANIZATION_ID,
      ownerEmployeeId: EMPLOYEE_ID,
      scopeId: personalQmScopeId(ORGANIZATION_ID, EMPLOYEE_ID),
      lifecycle: "active",
      capabilities: ["workspace.read"],
      runtime: { kind: "local-synthetic", fixtureId: "fixture:qm-unit" },
      upstream: {
        version: QM_UPSTREAM_PIN.version,
        commit: QM_UPSTREAM_PIN.commit,
      },
      stateVersion: 2,
    });
  });

  it("fails closed on mixed provider and local runtime columns", () => {
    expect(() =>
      parseQmSessionRow({
        ...sessionRow(),
        provider: "flyio",
      }),
    ).toThrow("QM_SESSION_RUNTIME_ROW_INVALID");
  });

  it("strictly reconstructs a sanitized decision artifact", () => {
    const decision = parseQmDecisionRow(decisionRow());
    expect(decision.receipt.createdAt).toBe(RECORDED_AT.toISOString());
    expect(decision.readPrecheck?.precheckId).toBe(PRECHECK_ID);
  });

  it("rejects malformed or secret-bearing JSON work artifacts", () => {
    expect(() =>
      parseQmDecisionRow({
        ...decisionRow(),
        readPrecheck: {
          ...decisionRow().readPrecheck,
          credential: "must-not-persist",
        },
      }),
    ).toThrow();
    expect(() =>
      parseQmDecisionRow({
        ...decisionRow(),
        readPrecheck: {
          ...decisionRow().readPrecheck,
          precheckId: "60000000-0000-4000-8000-000000000012",
        },
      }),
    ).toThrow();
    expect(() =>
      parseQmDecisionRow({
        ...decisionRow(),
        readPrecheck: {
          ...decisionRow().readPrecheck,
          requestedByEmployeeId: "20000000-0000-4000-8000-000000000012",
        },
      }),
    ).toThrow();
  });
});

describe("QM trusted staff adapter", () => {
  const authority = {
    authenticationSource: "verified-supabase",
    organizationSource: "server-config",
    organizationId: ORGANIZATION_ID,
  } as const;

  it("uses only the server staff session and configured organization", () => {
    expect(
      qmTrustedPrincipalFromStaffSession(
        { employeeId: EMPLOYEE_ID, actorType: "staff", clientId: null },
        authority,
      ),
    ).toEqual({ organizationId: ORGANIZATION_ID, employeeId: EMPLOYEE_ID });
  });

  it("rejects portal/client principals and unverified authority sources", () => {
    expect(() =>
      qmTrustedPrincipalFromStaffSession(
        {
          employeeId: EMPLOYEE_ID,
          actorType: "portal",
          clientId: "80000000-0000-4000-8000-000000000011",
        },
        authority,
      ),
    ).toThrow("QM_AUTHORIZATION_DENIED");
    expect(() =>
      qmTrustedPrincipalFromStaffSession(
        { employeeId: EMPLOYEE_ID, actorType: "staff", clientId: null },
        { ...authority, authenticationSource: "development" },
      ),
    ).toThrow();
  });
});

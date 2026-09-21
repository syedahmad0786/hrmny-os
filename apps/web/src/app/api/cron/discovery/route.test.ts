import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  reconcileDiscoveryRuns: vi.fn(),
  dispatchPendingDiscoveryJobs: vi.fn(),
  continuePendingDiscoveryInterpretationJobs: vi.fn(),
}));

vi.mock("@/server/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/sales-os/discovery-runs", () => ({
  reconcileDiscoveryRuns: mocks.reconcileDiscoveryRuns,
}));
vi.mock("@/server/inngest/discovery", () => ({
  dispatchPendingDiscoveryJobs: mocks.dispatchPendingDiscoveryJobs,
}));
vi.mock("@/server/sales-os/discovery-callback-ingest", () => ({
  continuePendingDiscoveryInterpretationJobs:
    mocks.continuePendingDiscoveryInterpretationJobs,
}));

import { GET } from "./route";

describe("Discovery repair route", () => {
  beforeEach(() => {
    vi.stubEnv("DISCOVERY_REPAIR_SECRET", "repair-secret-for-tests");
    mocks.getDb.mockReset();
    mocks.reconcileDiscoveryRuns.mockReset();
    mocks.dispatchPendingDiscoveryJobs.mockReset();
    mocks.continuePendingDiscoveryInterpretationJobs.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a missing or mismatched repair secret", async () => {
    const unauthorized = await GET(
      new Request("http://localhost/api/cron/discovery"),
    );
    expect(unauthorized.status).toBe(401);
    expect(mocks.reconcileDiscoveryRuns).not.toHaveBeenCalled();
  });

  it("does not run repair against a memory store", async () => {
    mocks.getDb.mockReturnValue(null);
    const response = await GET(
      new Request("http://localhost/api/cron/discovery", {
        headers: { authorization: "Bearer repair-secret-for-tests" },
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "DATABASE_UNAVAILABLE",
    });
    expect(mocks.reconcileDiscoveryRuns).not.toHaveBeenCalled();
  });

  it("continues pending interpretation outside the reconcile transaction", async () => {
    mocks.getDb.mockReturnValue({});
    mocks.reconcileDiscoveryRuns.mockResolvedValue({
      expiredDispatchLeases: 0,
      failedDeadlines: 0,
      dispatchRepairNeeded: 0,
    });
    mocks.dispatchPendingDiscoveryJobs.mockResolvedValue({
      status: "execution_disabled",
      nextWakeAt: null,
      results: [],
    });
    mocks.continuePendingDiscoveryInterpretationJobs.mockResolvedValue({
      status: "idle",
      results: [],
    });
    const response = await GET(
      new Request("http://localhost/api/cron/discovery", {
        headers: { authorization: "Bearer repair-secret-for-tests" },
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      interpretation: { status: "idle" },
    });
    expect(mocks.reconcileDiscoveryRuns).toHaveBeenCalledOnce();
    expect(mocks.continuePendingDiscoveryInterpretationJobs).toHaveBeenCalledOnce();
    expect(mocks.reconcileDiscoveryRuns.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.continuePendingDiscoveryInterpretationJobs.mock.invocationCallOrder[0]!,
    );
  });
});

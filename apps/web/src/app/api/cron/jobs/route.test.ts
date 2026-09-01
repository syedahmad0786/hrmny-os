import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  order: [] as string[],
  execute: vi.fn(),
  getDb: vi.fn(),
  emitHealthSignal: vi.fn(),
  redact: vi.fn(),
  getSettings: vi.fn(),
  runApolloJob: vi.fn(),
  deliverWorkWebhooks: vi.fn(),
  cleanupAiRuns: vi.fn(),
  runDueReports: vi.fn(),
  runCrmTaskDigest: vi.fn(),
  runLeadgenDailyCron: vi.fn(),
  runReconSweepers: vi.fn(),
}));

vi.mock("@/server/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/m1-persistence", () => ({
  emitHealthSignal: mocks.emitHealthSignal,
}));
vi.mock("@/server/features", () => ({ featureEnabled: vi.fn() }));
vi.mock("@/server/asana-sync", () => ({ syncAsanaWorkspace: vi.fn() }));
vi.mock("@/server/trpc/connections-router", () => ({
  getVerifiedAsanaConnection: vi.fn(),
}));
vi.mock("@/server/asana-webhooks", () => ({
  refreshAsanaWebhooksIfEnabled: vi.fn(),
}));
vi.mock("@/server/work-api", () => ({
  deliverPendingWorkWebhooks: mocks.deliverWorkWebhooks,
}));
vi.mock("@/server/work-ai", () => ({
  cleanupExpiredWorkAiRuns: mocks.cleanupAiRuns,
}));
vi.mock("@/server/work-ai-studio", () => ({
  runWorkAiStudioJob: vi.fn(),
}));
vi.mock("@/server/work-ai-teammates", () => ({
  runWorkAiTeammateJob: vi.fn(),
}));
vi.mock("@/server/work-form-receipts", () => ({
  runWorkFormReceiptJob: vi.fn(),
}));
vi.mock("@/server/trpc/work-management-router", () => ({
  runScheduledWorkRuleJob: vi.fn(),
}));
vi.mock("@/server/inngest/report-scheduler", () => ({
  runDueReports: mocks.runDueReports,
}));
vi.mock("@/server/inngest/client", () => ({
  inngestCloudConfigured: vi.fn(() => false),
}));
vi.mock("@/server/reminders/crm-task-digest", () => ({
  runCrmTaskDigest: mocks.runCrmTaskDigest,
}));
vi.mock("@/server/leadgen/daily-cron", () => ({
  runLeadgenDailyCron: mocks.runLeadgenDailyCron,
}));
vi.mock("@/server/recon/cron-sweepers", () => ({
  runReconSweepers: mocks.runReconSweepers,
}));
vi.mock("@/server/sales-os/apollo-search", () => ({
  APOLLO_PEOPLE_SEARCH_JOB_KIND: "apollo_people_search",
  redactExpiredApolloPeopleSearchCandidates: mocks.redact,
  runApolloPeopleSearchQueuedJob: mocks.runApolloJob,
}));
vi.mock("@/server/sales-os/store", () => ({
  getSalesOsSettings: mocks.getSettings,
}));

import { GET } from "./route";

function request() {
  return new Request("http://localhost/api/cron/jobs", {
    headers: { authorization: "Bearer cron-test-secret" },
  });
}

describe("cron Apollo retention ordering", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = "cron-test-secret";
    mocks.order.length = 0;
    let executeCall = 0;
    mocks.execute.mockReset().mockImplementation(async () => {
      executeCall += 1;
      if (executeCall === 1) return [{ scheduled_job_id: "apollo-job-1" }];
      if (executeCall === 4) return [{ count: 0 }];
      return [];
    });
    mocks.getDb.mockReset().mockReturnValue({ execute: mocks.execute });
    mocks.emitHealthSignal.mockReset().mockResolvedValue(undefined);
    mocks.getSettings.mockReset().mockResolvedValue({ retentionMonths: 24 });
    mocks.redact.mockReset().mockImplementation(async () => {
      mocks.order.push("retention");
      return 2;
    });
    mocks.runApolloJob.mockReset().mockImplementation(async () => {
      mocks.order.push("provider");
      return { status: "completed" };
    });
    mocks.deliverWorkWebhooks.mockReset().mockResolvedValue({ delivered: 0 });
    mocks.cleanupAiRuns.mockReset().mockResolvedValue({ deleted: 0 });
    mocks.runDueReports.mockReset().mockResolvedValue({ sent: 0 });
    mocks.runCrmTaskDigest.mockReset().mockResolvedValue({ posted: false });
    mocks.runLeadgenDailyCron.mockReset().mockResolvedValue({ ran: false });
    mocks.runReconSweepers.mockReset().mockResolvedValue({ swept: 0 });
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("runs governed erasure before any external Apollo work", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.order).toEqual(["retention", "provider"]);
    await expect(response.json()).resolves.toMatchObject({
      apollo: {
        considered: 1,
        completed: 1,
        runtimeFailures: 0,
        candidatesRedacted: 2,
        redactionError: null,
        redactionBacklog: false,
      },
    });
  });

  it("surfaces retention failure but preserves queue processing", async () => {
    mocks.redact.mockImplementationOnce(async () => {
      mocks.order.push("retention");
      throw new Error("synthetic retention outage");
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.order).toEqual(["retention", "provider"]);
    expect(mocks.emitHealthSignal).toHaveBeenCalledWith(
      "apollo_candidate_retention",
      "warn",
      { reason: "APOLLO_CANDIDATE_REDACTION_FAILED" },
    );
    await expect(response.json()).resolves.toMatchObject({
      apollo: {
        completed: 1,
        candidatesRedacted: 0,
        redactionError: "APOLLO_CANDIDATE_REDACTION_FAILED",
      },
    });
  });

  it("emits a secret-safe health signal and fails the cron visibly on worker bugs", async () => {
    mocks.runApolloJob.mockRejectedValueOnce(
      new TypeError("sensitive implementation detail"),
    );
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(mocks.emitHealthSignal).toHaveBeenCalledWith(
      "apollo_people_search_worker",
      "warn",
      {
        jobId: "apollo-job-1",
        reason: "APOLLO_WORKER_RUNTIME_FAILURE",
      },
    );
    expect(JSON.stringify(mocks.emitHealthSignal.mock.calls)).not.toContain(
      "sensitive implementation detail",
    );
    await expect(response.json()).resolves.toMatchObject({
      apollo: { failed: 1, runtimeFailures: 1 },
    });
  });

  it("drains retention in bounded batches instead of growing a daily backlog", async () => {
    mocks.redact
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(500)
      .mockResolvedValueOnce(7);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.redact).toHaveBeenCalledTimes(3);
    expect(mocks.redact).toHaveBeenNthCalledWith(1, {
      retentionMonths: 24,
      limit: 500,
    });
    await expect(response.json()).resolves.toMatchObject({
      apollo: { candidatesRedacted: 1007, redactionBacklog: false },
    });
  });
});

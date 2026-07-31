import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  deliverHealthSignal: vi.fn(),
  emitHealthSignal: vi.fn(),
  deliverPendingWorkWebhooks: vi.fn(),
  cleanupExpiredWorkAiRuns: vi.fn(),
  runDueReports: vi.fn(),
}));

vi.mock("@/server/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/server/m1-persistence", () => ({
  deliverHealthSignal: mocks.deliverHealthSignal,
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
  deliverPendingWorkWebhooks: mocks.deliverPendingWorkWebhooks,
}));
vi.mock("@/server/work-ai", () => ({
  cleanupExpiredWorkAiRuns: mocks.cleanupExpiredWorkAiRuns,
}));
vi.mock("@/server/work-ai-studio", () => ({ runWorkAiStudioJob: vi.fn() }));
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

import { GET } from "../app/api/cron/jobs/route";

type JobUpdate = Record<string, unknown>;

function fakeDb(executeResults: unknown[][]) {
  const updates: JobUpdate[] = [];
  return {
    updates,
    execute: vi.fn(async () => executeResults.shift() ?? []),
    update: vi.fn(() => ({
      set: (values: JobUpdate) => ({
        where: async () => {
          updates.push(values);
          return [];
        },
      }),
    })),
  };
}

function job(attempts: number, kind = "health_delivery") {
  return {
    scheduled_job_id: "00000000-0000-4000-8000-000000000001",
    kind,
    payload:
      kind === "health_signal"
        ? { signalKey: "m1_test", severity: "info", payload: {} }
        : { healthSignalId: "00000000-0000-4000-8000-000000000002" },
    attempts,
    run_at: new Date(),
  };
}

function authorizedRequest() {
  return new Request("https://hrmny.example/api/cron/jobs", {
    headers: { authorization: "Bearer m1-test-secret" },
  });
}

describe("scheduled-job cron boundary", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "m1-test-secret");
    mocks.deliverHealthSignal.mockReset();
    mocks.emitHealthSignal.mockReset();
    mocks.deliverPendingWorkWebhooks.mockReset().mockResolvedValue(0);
    mocks.cleanupExpiredWorkAiRuns.mockReset().mockResolvedValue(0);
    mocks.runDueReports.mockReset().mockResolvedValue({ sent: 0 });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("rejects missing and incorrect CRON_SECRET before database access", async () => {
    mocks.db = fakeDb([]);
    const missing = await GET(
      new Request("https://hrmny.example/api/cron/jobs"),
    );
    expect(missing.status).toBe(401);

    const incorrect = await GET(
      new Request("https://hrmny.example/api/cron/jobs", {
        headers: { authorization: "Bearer wrong" },
      }),
    );
    expect(incorrect.status).toBe(401);
  });

  it("does not redeliver a job that a repeated cron call cannot claim", async () => {
    const db = fakeDb([
      [],
      [job(1, "health_signal")],
      [{ count: 0 }],
      [],
      [],
      [{ count: 0 }],
    ]);
    mocks.db = db;

    expect((await GET(authorizedRequest())).status).toBe(200);
    expect((await GET(authorizedRequest())).status).toBe(200);
    expect(mocks.emitHealthSignal).toHaveBeenCalledOnce();
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ status: "completed" });
  });

  it.each([
    { attempts: 2, status: "pending" },
    { attempts: 3, status: "failed" },
  ])(
    "marks attempt $attempts as $status after delivery failure",
    async ({ attempts, status }) => {
      const db = fakeDb([[], [job(attempts)], [{ count: 0 }]]);
      mocks.db = db;
      mocks.deliverHealthSignal.mockRejectedValueOnce(
        new Error("fake webhook"),
      );

      expect((await GET(authorizedRequest())).status).toBe(200);
      expect(db.updates).toHaveLength(1);
      expect(db.updates[0]).toMatchObject({ status, lockedAt: null });
    },
  );

  it("emits job_lag when overdue pending work remains", async () => {
    mocks.db = fakeDb([[], [], [{ count: 2 }]]);

    expect((await GET(authorizedRequest())).status).toBe(200);
    expect(mocks.emitHealthSignal).toHaveBeenCalledWith("job_lag", "warn", {
      delayedJobs: 2,
    });
  });
});

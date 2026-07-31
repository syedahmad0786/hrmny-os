import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("./db", () => ({ getDb: () => mocks.db }));

import { deliverHealthSignal, emitHealthSignal } from "./m1-persistence";

function fakeDb(notificationAttempts = 0) {
  const updates: Record<string, unknown>[] = [];
  const row = {
    healthSignalId: "00000000-0000-4000-8000-000000000001",
    signalKey: "job_lag",
    severity: "warn",
    payload: { delayedJobs: 2 },
    deliveryStatus: "pending",
    notificationAttempts,
  };
  return {
    updates,
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [row] }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          return [];
        },
      }),
    }),
  };
}

function fakeEmitDb() {
  const inserts: Record<string, unknown>[] = [];
  let existing: Record<string, unknown> | undefined;
  const tx = {
    execute: vi.fn(async () => []),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (existing ? [existing] : []) }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        inserts.push(values);
        if ("signalKey" in values) {
          existing = {
            healthSignalId: "00000000-0000-4000-8000-000000000001",
            ...values,
            notificationAttempts: 0,
            notifiedAt: null,
            lastError: null,
            createdAt: new Date("2026-07-31T00:00:00.000Z"),
          };
        }
        return { returning: async () => [existing] };
      },
    }),
  };
  return {
    inserts,
    tx,
    transaction: vi.fn(async (run: (value: typeof tx) => unknown) => run(tx)),
  };
}

describe("health signal Chat delivery", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("records successful fake-webhook delivery", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.example.test/hook");
    const db = fakeDb();
    mocks.db = db;
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deliverHealthSignal("00000000-0000-4000-8000-000000000001"),
    ).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(db.updates[0]).toMatchObject({
      deliveryStatus: "delivered",
      notificationAttempts: 1,
      lastError: null,
    });
  });

  it("keeps a failed fake-webhook delivery pending for the worker retry", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.example.test/hook");
    const db = fakeDb();
    mocks.db = db;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );

    await expect(
      deliverHealthSignal("00000000-0000-4000-8000-000000000001"),
    ).rejects.toThrow("Google Chat webhook failed (503)");
    expect(db.updates[0]).toMatchObject({
      deliveryStatus: "pending",
      notificationAttempts: 1,
    });
  });

  it("does not call Chat after the third delivery attempt", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.example.test/hook");
    const db = fakeDb(3);
    mocks.db = db;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      deliverHealthSignal("00000000-0000-4000-8000-000000000001"),
    ).resolves.toEqual({ ok: false, exhausted: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.updates).toHaveLength(0);
  });

  it("stores one signal, delivery job and audit row per incident key", async () => {
    vi.stubEnv("GOOGLE_CHAT_WEBHOOK_URL", "https://chat.example.test/hook");
    const db = fakeEmitDb();
    mocks.db = db;
    const options = {
      incidentKey: "job-lag:00000000-0000-4000-8000-000000000003",
      audit: {
        actorEmployeeId: null,
        action: "health.job_lag",
        entityType: "health_signal",
        entityId: null,
        before: null,
        after: { delayedJobs: 2 },
        reason: "cron lag incident",
      },
    };

    const first = await emitHealthSignal(
      "job_lag",
      "warn",
      { delayedJobs: 2 },
      options,
    );
    const repeated = await emitHealthSignal(
      "job_lag",
      "warn",
      { delayedJobs: 2 },
      options,
    );

    expect(repeated).toEqual(first);
    expect(db.transaction).toHaveBeenCalledTimes(2);
    expect(db.tx.execute).toHaveBeenCalledTimes(2);
    expect(db.inserts).toHaveLength(3);
    expect(db.inserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ signalKey: "job_lag" }),
        expect.objectContaining({ kind: "health_delivery" }),
        expect.objectContaining({ action: "health.job_lag" }),
      ]),
    );
  });
});

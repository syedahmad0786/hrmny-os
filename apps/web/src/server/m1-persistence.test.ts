import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("./db", () => ({ getDb: () => mocks.db }));

import { deliverHealthSignal } from "./m1-persistence";

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
});

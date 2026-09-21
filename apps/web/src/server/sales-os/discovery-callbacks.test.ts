import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  acceptDiscoveryRuntimeCallback,
  admitDiscoveryCallbackForRunStatus,
} from "./discovery-callbacks";
import { signDiscoveryRuntimeToken } from "./discovery-runtime-contract";

const SECRET = "s".repeat(32);
const KEY_ID = "n8n-2026-09";
const EVENT_ID = "10000000-0000-4000-8000-000000000001";

function observationBody() {
  return JSON.stringify({
    schemaVersion: 1,
    event: "sales.discovery.observations.v1",
    eventId: EVENT_ID,
    runId: "10000000-0000-4000-8000-000000000002",
    sourceId: "10000000-0000-4000-8000-000000000003",
    attemptToken: "10000000-0000-4000-8000-000000000004",
    attemptGeneration: 1,
    credentialGeneration: 2,
    payload: {
      observations: [
        {
          observationId: "10000000-0000-4000-8000-000000000005",
          sourceItemKey: "publisher-guid-42",
          contentHash: "a".repeat(64),
          sourceReference: {
            kind: "public_url",
            url: "https://www.hrmny.co/news/42",
          },
          observedAt: "2026-09-20T00:00:00.000Z",
          publishedAt: "2026-09-19T00:00:00.000Z",
          dateEvidence: { method: "article_body", precision: "day" },
          kind: "news",
          title: "HRMNY source observation",
          excerpt: "Evidence captured from the source.",
          companyHints: [{ name: "Example LLC", domain: "example.com" }],
        },
      ],
    },
  });
}

describe("Discovery runtime callback ingress", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_MODE", "memory");
    vi.stubEnv("DISCOVERY_N8N_CALLBACK_KEYS_JSON", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects when the dedicated callback key ring is missing", async () => {
    await expect(
      acceptDiscoveryRuntimeCallback({
        rawBody: observationBody(),
        headers: new Headers(),
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "CALLBACK_KEYS_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("rejects a missing token without touching the run ledger", async () => {
    vi.stubEnv(
      "DISCOVERY_N8N_CALLBACK_KEYS_JSON",
      JSON.stringify({ [KEY_ID]: SECRET }),
    );
    await expect(
      acceptDiscoveryRuntimeCallback({
        rawBody: observationBody(),
        headers: new Headers(),
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "missing_token",
      httpStatus: 401,
    });
  });

  it("does not invent a durable callback receipt in memory mode", async () => {
    vi.stubEnv(
      "DISCOVERY_N8N_CALLBACK_KEYS_JSON",
      JSON.stringify({ [KEY_ID]: SECRET }),
    );
    const rawBody = observationBody();
    await expect(
      acceptDiscoveryRuntimeCallback({
        rawBody,
        headers: new Headers({
          "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
            SECRET,
            KEY_ID,
            rawBody,
            EVENT_ID,
          ),
        }),
      }),
    ).resolves.toEqual({
      status: "rejected",
      code: "DEPENDENCY_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("admits only a cancelled terminal completion after cancel_requested", () => {
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "running",
        event: "sales.discovery.observations.v1",
      }),
    ).toEqual({ ok: true });
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "cancel_requested",
        event: "sales.discovery.observations.v1",
      }),
    ).toEqual({ ok: false, code: "RUN_CANCEL_REQUESTED" });
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "cancel_requested",
        event: "sales.discovery.checkpoint.v1",
      }),
    ).toEqual({ ok: false, code: "RUN_CANCEL_REQUESTED" });
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "cancel_requested",
        event: "sales.discovery.completion.v1",
        completionStatus: "completed",
      }),
    ).toEqual({ ok: false, code: "RUN_CANCEL_REQUESTED" });
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "cancel_requested",
        event: "sales.discovery.completion.v1",
        completionStatus: "partial",
      }),
    ).toEqual({ ok: false, code: "RUN_CANCEL_REQUESTED" });
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "cancel_requested",
        event: "sales.discovery.completion.v1",
        completionStatus: "cancelled",
      }),
    ).toEqual({ ok: true });
    expect(
      admitDiscoveryCallbackForRunStatus({
        status: "cancelled",
        event: "sales.discovery.completion.v1",
        completionStatus: "cancelled",
      }),
    ).toEqual({ ok: false, code: "RUN_NOT_OPEN" });
  });
});

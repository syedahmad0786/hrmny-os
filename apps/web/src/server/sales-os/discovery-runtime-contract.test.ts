import { describe, expect, it } from "vitest";
import {
  DISCOVERY_CALLBACK_MAX_BYTES,
  loadDiscoveryN8nCallbackKeys,
  signDiscoveryRuntimeToken,
  validateDiscoveryRuntimeCallback,
} from "./discovery-runtime-contract";

const SECRET = "discovery-test-secret";
const KEY_ID = "n8n-2026-09";
const NOW = 1_789_848_000;
const EVENT_ID = "10000000-0000-4000-8000-000000000001";

function body(extra: Record<string, unknown> = {}) {
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
      checkpoint: {
        cursor: "opaque-page-2",
        providerJobId: null,
        itemsSeen: 1,
        pagesSeen: 1,
      },
    },
    ...extra,
  });
}

function headers(rawBody: string, nowSeconds = NOW, keyId = KEY_ID) {
  return new Headers({
    "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
      SECRET,
      keyId,
      rawBody,
      EVENT_ID,
      nowSeconds,
    ),
  });
}

describe("Discovery runtime callback contract", () => {
  it("validates an exact-body signed observation and returns its replay digest", () => {
    const rawBody = body();
    const result = validateDiscoveryRuntimeCallback({
      rawBody,
      headers: headers(rawBody),
      keys: { [KEY_ID]: SECRET, "n8n-previous": "previous-secret" },
      nowSeconds: NOW,
    });

    expect(result).toMatchObject({
      ok: true,
      eventId: EVENT_ID,
      keyId: KEY_ID,
    });
    if (result.ok) expect(result.bodyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts only the bounded checkpoint and completion payload shapes", () => {
    const checkpoint = {
      cursor: "opaque-page-3",
      providerJobId: "provider-job-42",
      itemsSeen: 100,
      pagesSeen: 3,
    };
    const checkpointBody = body({
      event: "sales.discovery.checkpoint.v1",
      credentialGeneration: 0,
      payload: { checkpoint },
    });
    const completionBody = body({
      event: "sales.discovery.completion.v1",
      payload: {
        status: "completed",
        counts: { ingested: 8, duplicate: 1, quarantined: 0, rejected: 2 },
        checkpoint,
        usage: [
          {
            providerRequestId: "provider-request-42",
            units: 1,
            unitKind: "request",
          },
        ],
      },
    });

    for (const rawBody of [checkpointBody, completionBody]) {
      expect(
        validateDiscoveryRuntimeCallback({
          rawBody,
          headers: headers(rawBody),
          keys: { [KEY_ID]: SECRET },
          nowSeconds: NOW,
        }).ok,
      ).toBe(true);
    }
  });

  it("rejects tampering, stale timestamps, unknown keys, and header/body replay mismatch", () => {
    const rawBody = body();
    const keys = { [KEY_ID]: SECRET };
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody: `${rawBody} `,
        headers: headers(rawBody),
        keys,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "invalid_token" });
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: headers(rawBody, NOW - 331),
        keys,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "invalid_token" });
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: headers(rawBody, NOW, "retired-key"),
        keys,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "unknown_key" });
    for (const keyId of ["__proto__", "constructor", "toString"]) {
      expect(
        validateDiscoveryRuntimeCallback({
          rawBody,
          headers: headers(rawBody, NOW, keyId),
          keys,
          nowSeconds: NOW,
        }),
      ).toEqual({ ok: false, code: "unknown_key" });
    }
    const mismatched = new Headers({
      "x-hrmny-discovery-token": signDiscoveryRuntimeToken(
        SECRET,
        KEY_ID,
        rawBody,
        "10000000-0000-4000-8000-000000000099",
        NOW,
      ),
    });
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: mismatched,
        keys,
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "event_id_mismatch" });
  });

  it("strictly rejects credential echo and unbounded extension fields", () => {
    const rawBody = body({ credential: "must-not-cross-boundary" });
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: headers(rawBody),
        keys: { [KEY_ID]: SECRET },
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "invalid_body" });
  });

  it("rejects private or placeholder public evidence URLs", () => {
    const parsed = JSON.parse(body()) as {
      payload: { observations: Array<{ sourceReference: unknown }> };
    };
    parsed.payload.observations[0]!.sourceReference = {
      kind: "public_url",
      url: "https://127.0.0.1/private",
    };
    const rawBody = JSON.stringify(parsed);
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: headers(rawBody),
        keys: { [KEY_ID]: SECRET },
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "invalid_body" });
  });

  it("rejects oversized bodies before parsing", () => {
    const rawBody = "x".repeat(DISCOVERY_CALLBACK_MAX_BYTES + 1);
    expect(
      validateDiscoveryRuntimeCallback({
        rawBody,
        headers: new Headers(),
        keys: {},
        nowSeconds: NOW,
      }),
    ).toEqual({ ok: false, code: "body_too_large" });
  });

  it("loads only a bounded dedicated callback key ring", () => {
    const secret = "s".repeat(32);
    expect(
      loadDiscoveryN8nCallbackKeys(JSON.stringify({ [KEY_ID]: secret })),
    ).toMatchObject({ [KEY_ID]: secret });
    expect(loadDiscoveryN8nCallbackKeys("{}")).toBeNull();
    expect(
      loadDiscoveryN8nCallbackKeys(
        JSON.stringify({ [KEY_ID]: "too-short", constructor: secret }),
      ),
    ).toBeNull();
  });
});

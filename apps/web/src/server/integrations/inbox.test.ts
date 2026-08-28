import { beforeEach, describe, expect, it } from "vitest";
import {
  hashIntegrationPayload,
  recordIntegrationReceipt,
  resetIntegrationReceiptMemory,
} from "./inbox";

describe("integration inbox", () => {
  beforeEach(() => resetIntegrationReceiptMemory());

  it("uses a deterministic SHA-256 payload hash", () => {
    expect(hashIntegrationPayload("same")).toBe(hashIntegrationPayload("same"));
    expect(hashIntegrationPayload("same")).not.toBe(hashIntegrationPayload("other"));
  });

  it("marks a repeated provider event as a duplicate", async () => {
    const input = {
      provider: "xero",
      externalEventId: "event-001",
      operation: "invoice.updated",
      rawBody: '{"event":"invoice.updated"}',
      completed: true,
    } as const;
    const first = await recordIntegrationReceipt(input);
    const replay = await recordIntegrationReceipt(input);
    expect(first.duplicate).toBe(false);
    expect(replay).toMatchObject({
      receiptId: first.receiptId,
      duplicate: true,
      status: "completed",
    });
  });

  it("rejects reuse of an event id for another payload", async () => {
    await recordIntegrationReceipt({
      provider: "composio",
      externalEventId: "msg_001",
      operation: "trigger.received",
      rawBody: '{"value":1}',
    });
    await expect(
      recordIntegrationReceipt({
        provider: "composio",
        externalEventId: "msg_001",
        operation: "trigger.received",
        rawBody: '{"value":2}',
      }),
    ).rejects.toThrow(/PAYLOAD_MISMATCH/);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import {
  completeIntegrationReceipt,
  failIntegrationReceipt,
  findIntegrationReceiptByDealId,
  getIntegrationReceipt,
  hashIntegrationPayload,
  recordIntegrationReceipt,
  resetIntegrationReceiptMemory,
} from "./inbox";

describe("integration inbox", () => {
  beforeEach(() => resetIntegrationReceiptMemory());

  it("uses a deterministic SHA-256 payload hash", () => {
    expect(hashIntegrationPayload("same")).toBe(hashIntegrationPayload("same"));
    expect(hashIntegrationPayload("same")).not.toBe(
      hashIntegrationPayload("other"),
    );
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

  it("moves a claimed receipt through completed readback", async () => {
    const claimed = await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: "one-person-canary",
      operation: "people.match",
      rawBody: '{"id":"person-1"}',
      status: "processing",
    });
    await completeIntegrationReceipt(claimed.receiptId, {
      matched: true,
      contactId: "contact-1",
    });
    expect(
      await getIntegrationReceipt("apollo", "one-person-canary"),
    ).toMatchObject({
      receiptId: claimed.receiptId,
      status: "completed",
      result: { matched: true, contactId: "contact-1" },
    });
  });

  it("finds the saved provider candidate that created a deal", async () => {
    await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: "free-save:employee:person-1",
      operation: "people.search.save_candidate",
      rawBody: '{"externalId":"person-1"}',
      payload: { externalId: "person-1", fullName: "Sana Example" },
      completed: true,
      result: { dealId: "deal-1", contactId: "contact-1" },
    });

    await expect(
      findIntegrationReceiptByDealId({
        provider: "apollo",
        operation: "people.search.save_candidate",
        dealId: "deal-1",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      payload: { externalId: "person-1", fullName: "Sana Example" },
    });
  });

  it("retains a fail-closed receipt after an uncertain provider attempt", async () => {
    const claimed = await recordIntegrationReceipt({
      provider: "apollo",
      externalEventId: "uncertain-canary",
      operation: "people.match",
      rawBody: '{"id":"person-2"}',
      status: "processing",
    });
    await failIntegrationReceipt(claimed.receiptId, "provider timeout");
    expect(
      await getIntegrationReceipt("apollo", "uncertain-canary"),
    ).toMatchObject({ status: "failed" });
  });
});

import { describe, expect, it } from "vitest";
import {
  isSyntheticAgent,
  isSyntheticChatThread,
  isSyntheticRecordName,
} from "./synthetic-records";

describe("synthetic record visibility", () => {
  it("recognizes automated run records without hiding named demo sandboxes", () => {
    expect(isSyntheticRecordName("E2E Apollo Retail 123")).toBe(true);
    expect(isSyntheticRecordName("Live Proof 123")).toBe(true);
    expect(isSyntheticRecordName("Closed Loop 123")).toBe(true);
    expect(isSyntheticRecordName("Demo Co LLC")).toBe(false);
    expect(isSyntheticRecordName("Emaar Hospitality Group")).toBe(false);
  });

  it("recognizes generated agents and sessions", () => {
    expect(isSyntheticAgent({ slug: "proof-agent-123" })).toBe(true);
    expect(isSyntheticAgent({ slug: "chat-bind-abc" })).toBe(true);
    expect(isSyntheticAgent({ slug: "delivery-coach" })).toBe(false);
    expect(
      isSyntheticChatThread({
        title: "Normal conversation",
        clientName: "E2E Apollo Loop 123",
      }),
    ).toBe(true);
  });
});

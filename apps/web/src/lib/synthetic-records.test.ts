import { describe, expect, it } from "vitest";
import {
  hasSyntheticMarker,
  isSyntheticAgent,
  isSyntheticChatThread,
  isSyntheticRecordName,
} from "./synthetic-records";

describe("synthetic record visibility", () => {
  it("recognizes automated and demo records without hiding real accounts", () => {
    expect(isSyntheticRecordName("E2E Apollo Retail 123")).toBe(true);
    expect(isSyntheticRecordName("Live Proof 123")).toBe(true);
    expect(isSyntheticRecordName("Closed Loop 123")).toBe(true);
    expect(isSyntheticRecordName("Demo Co LLC")).toBe(true);
    expect(isSyntheticRecordName("M1-PROOF handover")).toBe(true);
    expect(isSyntheticRecordName("Personal 1787286650761")).toBe(true);
    expect(isSyntheticRecordName("Emaar Hospitality Group")).toBe(false);
    expect(hasSyntheticMarker("Normal draft", "apollo+123@example.com")).toBe(
      true,
    );
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

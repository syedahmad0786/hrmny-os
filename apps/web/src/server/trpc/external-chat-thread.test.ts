import { describe, expect, it } from "vitest";
import {
  externalChatThreadId,
  getOrCreateExternalChatThread,
} from "./chat-router";

const employeeId = "c0000000-0000-4000-8000-000000000001";

describe("external Chat threads", () => {
  it("keeps one valid UUID conversation per employee and Google Chat space", async () => {
    const first = await getOrCreateExternalChatThread({
      employeeId,
      externalRef: "google-chat:spaces/AAAA",
      title: "Google Chat",
    });
    const replay = await getOrCreateExternalChatThread({
      employeeId,
      externalRef: "google-chat:spaces/AAAA",
      title: "Renamed space",
    });
    expect(first.chatThreadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(replay.chatThreadId).toBe(first.chatThreadId);
    expect(
      externalChatThreadId(employeeId, "google-chat:spaces/BBBB"),
    ).not.toBe(first.chatThreadId);
  });
});

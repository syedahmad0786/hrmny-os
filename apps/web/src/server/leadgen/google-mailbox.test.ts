import { afterEach, expect, it, vi } from "vitest";
import { verifiedGmailIdentities } from "./google-mailbox-identities";
import { listGoogleMailboxPage } from "./google-mailbox";
import { createGoogleWorkspaceGmailSend } from "./google-workspace-send";

vi.mock("../trpc/connections-router", () => ({
  listGoogleWorkspaceMonitorAccounts: async () => [],
  getGoogleWorkspaceAccessToken: async () => "test-token",
}));
afterEach(() => vi.unstubAllGlobals());

it("uses only verified aliases and verifies the actual From address after sending", async () => {
  const aliases = {
    sendAs: [
      { sendAsEmail: "owner@domain-one.test", isPrimary: true },
      { sendAsEmail: "sales@domain-two.test", verificationStatus: "accepted" },
      { sendAsEmail: "pending@domain-two.test", verificationStatus: "pending" },
    ],
  };
  expect(
    verifiedGmailIdentities(aliases).map((item) => item.email),
  ).not.toContain("pending@domain-two.test");
  let raw = "";
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("settings/sendAs")) return Response.json(aliases);
    if (init?.method === "POST") {
      raw = Buffer.from(
        JSON.parse(String(init.body)).raw,
        "base64url",
      ).toString();
      return Response.json({ id: "message-one", threadId: "thread-one" });
    }
    return Response.json({
      id: "message-one",
      threadId: "thread-one",
      labelIds: ["SENT"],
      payload: {
        headers: [
          { name: "To", value: "buyer@client.test" },
          { name: "From", value: "sales@domain-two.test" },
        ],
      },
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const sender = createGoogleWorkspaceGmailSend("test-owner");
  await expect(
    sender.sendAfterApproval({
      toolkit: "gmail",
      to: "buyer@client.test",
      fromEmail: "pending@domain-two.test",
      body: "Test",
    }),
  ).rejects.toThrow("not a verified alias");
  expect(raw).toBe("");
  await expect(
    sender.sendAfterApproval({
      toolkit: "gmail",
      to: "buyer@client.test",
      fromEmail: "sales@domain-two.test",
      body: "Test",
    }),
  ).resolves.toMatchObject({ sent: true, providerAccepted: true });
  expect(raw).toContain("From: sales@domain-two.test\r\n");
  await expect(
    sender.readbackAfterSend({
      externalId: "message-one",
      recipient: "buyer@client.test",
      expectedFromEmail: "wrong@domain.test",
    }),
  ).rejects.toThrow("sender does not match");
});

it("paginates Inbox and Sent with a fixed page size without modifying mail", async () => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    urls.push(url);
    expect(init?.method).toBeUndefined();
    return url.includes("format=metadata")
      ? Response.json({
          id: "m1",
          snippet: "Hello",
          payload: { headers: [{ name: "Subject", value: "A real inquiry" }] },
        })
      : Response.json({ messages: [{ id: "m1" }], nextPageToken: "older" });
  });
  expect(
    await listGoogleMailboxPage("test", "SENT", "second-page"),
  ).toMatchObject({
    nextPageToken: "older",
    messages: [{ subject: "A real inquiry" }],
  });
  expect(urls[0]).toContain("labelIds=SENT");
  expect(urls[0]).toContain("maxResults=20");
  expect(urls[0]).toContain("pageToken=second-page");
});

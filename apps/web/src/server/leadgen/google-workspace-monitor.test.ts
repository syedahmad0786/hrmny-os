process.env.DATABASE_URL = "";

import { describe, expect, it, vi } from "vitest";
import { runGoogleWorkspaceOutreachMonitor } from "./google-workspace-monitor";

const encoded = (value: string) => Buffer.from(value).toString("base64url");

describe("Google Workspace outreach monitor", () => {
  it("ingests only thread replies and delivery notices once without writing to Gmail", async () => {
    const completed = new Set<string>();
    const ingestReply = vi.fn(async () => ({ applied: true as const }));
    const ingestDelivery = vi.fn(async () => ({ applied: true as const }));
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
      const url = String(input);
      if (url.includes("format=full")) {
        const notice = url.includes("bounce-1");
        return new Response(
          JSON.stringify({
            id: notice ? "bounce-1" : "reply-1",
            threadId: notice ? "bounce-thread" : "thread-1",
            labelIds: ["INBOX"],
            snippet: notice ? "Delivery failed" : "Interested — let's meet.",
            payload: {
              mimeType: notice ? "multipart/report" : "text/plain",
              headers: [
                {
                  name: "From",
                  value: notice
                    ? "Mail Delivery Subsystem <mailer-daemon@googlemail.com>"
                    : "Buyer <buyer@brand.test>",
                },
                {
                  name: "Subject",
                  value: notice
                    ? "Delivery Status Notification (Failure)"
                    : "Re: Brand launch",
                },
              ],
              ...(notice
                ? {
                    parts: [
                      {
                        mimeType: "text/plain",
                        body: { data: encoded("Message was not delivered.") },
                      },
                      {
                        mimeType: "message/delivery-status",
                        body: {
                          data: encoded(
                            "Final-Recipient: rfc822; missing@brand.test",
                          ),
                        },
                      },
                    ],
                  }
                : {
                    body: {
                      data: encoded("Interested — let's meet next week."),
                    },
                  }),
            },
          }),
        );
      }
      const query = new URL(url).searchParams.get("q") ?? "";
      return new Response(
        JSON.stringify({
          messages: query.includes("mailer-daemon")
            ? [{ id: "bounce-1", threadId: "bounce-thread" }]
            : [
                { id: "reply-1", threadId: "thread-1" },
                { id: "unrelated-1", threadId: "other-thread" },
              ],
        }),
      );
      },
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const recordReceipt = vi.fn(async (input: { externalEventId: string }) => ({
      receiptId: input.externalEventId,
      duplicate: completed.has(input.externalEventId),
      status: completed.has(input.externalEventId) ? "completed" : "processing",
      stateVersion: 0,
    }));
    const completeReceipt = vi.fn(async (id: string) => {
      completed.add(id);
    });
    const deps = {
      listAccounts: vi.fn(async () => [
        {
          connectionAccountId: "70000000-0000-4000-8000-000000000001",
          ownerEmployeeId: "70000000-0000-4000-8000-000000000002",
        },
      ]),
      getAccessToken: vi.fn(async () => "token"),
      listEvents: vi.fn(async () => [
        {
          id: "event-1",
          outreachItemId: "outreach-1",
          contactId: null,
          kind: "sent" as const,
          provider: "gmail",
          externalId: "sent-1",
          payload: {
            threadId: "thread-1",
            ownerEmployeeId: "rep-employee-id",
            senderConnectionAccountId:
              "70000000-0000-4000-8000-000000000001",
          },
          occurredAt: "2026-09-04T00:00:00.000Z",
        },
      ]),
      recordReceipt,
      transitionReceipt: vi.fn(async () => false),
      completeReceipt,
      failReceipt: vi.fn(async () => undefined),
      ingestReply,
      ingestDelivery,
      health: vi.fn(async () => undefined),
      fetchImpl,
    };

    await expect(runGoogleWorkspaceOutreachMonitor(deps)).resolves.toMatchObject(
      { candidates: 2, processed: 2, replies: 1, deliveryNotices: 1 },
    );
    await expect(runGoogleWorkspaceOutreachMonitor(deps)).resolves.toMatchObject(
      { candidates: 2, processed: 0, duplicates: 2 },
    );
    expect(ingestReply).toHaveBeenCalledOnce();
    expect(ingestReply).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thread-1",
        senderConnectionAccountId:
          "70000000-0000-4000-8000-000000000001",
      }),
    );
    expect(ingestDelivery).toHaveBeenCalledOnce();
    expect(ingestDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(
          "Final-Recipient: rfc822; missing@brand.test",
        ),
      }),
    );
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
    expect(
      fetchMock.mock.calls
        .map(([url]) => String(url))
        .filter((url) => url.includes("/messages?"))
        .every((url) =>
          (new URL(url).searchParams.get("q") ?? "").includes(
            "-in:sent -in:draft",
          ),
        ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("unrelated-1?")),
    ).toBe(false);
  });
});

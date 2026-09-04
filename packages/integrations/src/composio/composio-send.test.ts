import { describe, expect, it, vi } from "vitest";
import {
  createComposioLiveSend,
  createComposioStub,
  type ComposioLiveClient,
} from "../index";

describe("createComposioLiveSend", () => {
  it("sends Gmail live via Composio proxy", async () => {
    const proxy = vi.fn(
      async (input: {
        connectedAccountId: string;
        endpoint: string;
        method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
        body?: Record<string, unknown>;
      }) =>
        input.method === "GET"
          ? {
              status: 200,
              data: {
                id: "msg-live-1",
                threadId: "thread-live-1",
                labelIds: ["SENT"],
                payload: {
                  headers: [{ name: "To", value: "lead@example.com" }],
                },
              } as unknown,
              headers: {} as Record<string, string>,
            }
          : {
              status: 200,
              data: { id: "msg-live-1", threadId: "thread-live-1" } as unknown,
              headers: {} as Record<string, string>,
            },
    ) as unknown as ComposioLiveClient["proxy"];
    const adapter = createComposioLiveSend({
      client: { proxy },
      connectedAccountId: "conn-1",
    });
    const res = await adapter.sendAfterApproval({
      toolkit: "gmail",
      to: "lead@example.com",
      subject: "Hello",
      body: "Demo outreach after HITL",
      messageId: "<hrmny-outreach-test@hrmny.co>",
    });
    expect(res.mode).toBe("live");
    expect(res.sent).toBe(true);
    expect(res.externalId).toBe("msg-live-1");
    expect(res.threadId).toBe("thread-live-1");
    expect(res.providerAccepted).toBe(true);
    expect(res.readbackRecipient).toBe("lead@example.com");
    expect(vi.mocked(proxy)).toHaveBeenCalledTimes(2);
    const arg = vi.mocked(proxy).mock.calls[0]![0];
    expect(arg.endpoint).toBe("/gmail/v1/users/me/messages/send");
    expect(arg.method).toBe("POST");
    expect(arg.body && "raw" in arg.body).toBe(true);
    const raw = String(arg.body?.raw);
    expect(Buffer.from(raw, "base64url").toString("utf8")).toContain(
      "Message-ID: <hrmny-outreach-test@hrmny.co>",
    );
    expect(vi.mocked(proxy).mock.calls[1]![0]).toMatchObject({
      endpoint: "/gmail/v1/users/me/messages/msg-live-1",
      method: "GET",
    });
  });

  it("keeps LinkedIn as copy-draft", async () => {
    const adapter = createComposioLiveSend({
      client: { proxy: vi.fn() as ComposioLiveClient["proxy"] },
      connectedAccountId: "conn-1",
    });
    const res = await adapter.sendAfterApproval({
      toolkit: "linkedin",
      to: "https://linkedin.com/in/x",
      body: "Draft note",
    });
    expect(res.sent).toBe(false);
    expect(res.mode).toBe("copy_draft");
  });

  it("fails loud when Gmail proxy errors (no stub fallback)", async () => {
    const adapter = createComposioLiveSend({
      client: {
        proxy: vi.fn(async () => {
          throw new Error("composio down");
        }) as ComposioLiveClient["proxy"],
      },
      connectedAccountId: "conn-1",
      fallback: createComposioStub(),
    });
    await expect(
      adapter.sendAfterApproval({
        toolkit: "gmail",
        to: "lead@example.com",
        body: "Fallback path",
      }),
    ).rejects.toThrow(/composio down/);
  });

  it("refuses to fabricate a Gmail receipt when the provider omits its id", async () => {
    const adapter = createComposioLiveSend({
      client: {
        proxy: vi.fn(async () => ({
          status: 200,
          data: {},
          headers: {},
        })) as ComposioLiveClient["proxy"],
      },
      connectedAccountId: "conn-1",
    });
    await expect(
      adapter.sendAfterApproval({
        toolkit: "gmail",
        to: "lead@example.com",
        body: "No fake receipt",
      }),
    ).rejects.toThrow(/no provider message id/i);
  });

  it("keeps a sent message uncertain when readback does not confirm its recipient", async () => {
    const proxy = vi.fn(async (input: { method?: string }) => ({
      status: 200,
      data:
        input.method === "GET"
          ? {
              id: "msg-live-2",
              labelIds: ["SENT"],
              payload: {
                headers: [{ name: "To", value: "someone-else@example.com" }],
              },
            }
          : { id: "msg-live-2" },
      headers: {},
    })) as unknown as ComposioLiveClient["proxy"];
    const adapter = createComposioLiveSend({
      client: { proxy },
      connectedAccountId: "conn-1",
    });

    await expect(
      adapter.sendAfterApproval({
        toolkit: "gmail",
        to: "lead@example.com",
        body: "Approved body",
      }),
    ).rejects.toMatchObject({
      name: "GmailProviderReadbackError",
      externalId: "msg-live-2",
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createComposioLiveSend,
  createComposioStub,
  type ComposioLiveClient,
} from "../index";

describe("createComposioLiveSend", () => {
  it("sends Gmail live via Composio proxy", async () => {
    const proxy = vi.fn(async (_input: {
      connectedAccountId: string;
      endpoint: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      body?: Record<string, unknown>;
    }) => ({
      status: 200,
      data: { id: "msg-live-1" } as unknown,
      headers: {} as Record<string, string>,
    })) as unknown as ComposioLiveClient["proxy"];
    const adapter = createComposioLiveSend({
      client: { proxy },
      connectedAccountId: "conn-1",
    });
    const res = await adapter.sendAfterApproval({
      toolkit: "gmail",
      to: "lead@example.com",
      subject: "Hello",
      body: "Demo outreach after HITL",
    });
    expect(res.mode).toBe("live");
    expect(res.sent).toBe(true);
    expect(res.externalId).toBe("msg-live-1");
    expect(vi.mocked(proxy)).toHaveBeenCalledOnce();
    const arg = vi.mocked(proxy).mock.calls[0]![0];
    expect(arg.endpoint).toBe("/gmail/v1/users/me/messages/send");
    expect(arg.method).toBe("POST");
    expect(arg.body && "raw" in arg.body).toBe(true);
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
});

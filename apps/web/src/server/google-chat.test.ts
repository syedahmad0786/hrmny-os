import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIntegrationReceipt,
  resetIntegrationReceiptMemory,
} from "./integrations/inbox";
import { createCaller } from "./trpc/root";
import { resolveActiveStaffById } from "./auth/session";
import {
  googleChatAsyncConfigured,
  googleChatConversationKind,
  googleChatEndpoint,
  googleChatJobSchema,
  googleChatReplyMessageId,
  handleGoogleChatRequest,
  sendGoogleChatReply,
  verifyGoogleChatJwt,
} from "./google-chat";

const { chatSend } = vi.hoisted(() => ({
  chatSend: vi.fn(async () => ({
    assistant: { content: "Scoped task result" },
  })),
}));
vi.mock("./trpc/root", () => ({
  createCaller: vi.fn(() => ({ chat: { send: chatSend } })),
}));

vi.mock("./auth/session", () => ({
  resolveActiveStaffById: vi.fn(async (employeeId: string) =>
    employeeId === "c0000000-0000-4000-8000-000000000001"
      ? {
          employeeId,
          email: "operator@hrmny.co",
          displayName: "Operator",
          roles: ["partner"],
          permissions: [],
          actorType: "staff",
          clientId: null,
        }
      : null,
  ),
  resolveActiveStaffByEmail: vi.fn(async (email: string) =>
    email === "operator@hrmny.co"
      ? {
          employeeId: "c0000000-0000-4000-8000-000000000001",
          email,
          displayName: "Operator",
          roles: ["partner"],
          permissions: [],
          actorType: "staff",
          clientId: null,
        }
      : null,
  ),
  sessionCanViewMargin: vi.fn(() => true),
}));

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2_048,
});
const exportedPublicKey = publicKey.export({ format: "jwk" });
if (!exportedPublicKey.n || !exportedPublicKey.e) {
  throw new Error("RSA test key is incomplete");
}
const publicJwk = {
  alg: "RS256" as const,
  e: exportedPublicKey.e,
  kid: "test-key",
  kty: "RSA" as const,
  n: exportedPublicKey.n,
  use: "sig" as const,
};
const audience =
  "https://hrmny-os.vercel.app/api/integrations/google-chat/events";
const now = 1_800_000_000;

beforeEach(() => resetIntegrationReceiptMemory());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function token(overrides: Record<string, unknown> = {}) {
  const encodedHeader = Buffer.from(
    JSON.stringify({ alg: "RS256", kid: publicJwk.kid, typ: "JWT" }),
  ).toString("base64url");
  const encodedPayload = Buffer.from(
    JSON.stringify({
      aud: audience,
      email: "chat@system.gserviceaccount.com",
      email_verified: true,
      exp: now + 300,
      iat: now - 10,
      iss: "https://accounts.google.com",
      ...overrides,
    }),
  ).toString("base64url");
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(signingInput, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

describe("Google Chat request verification", () => {
  it.each([
    [{ type: "DM" }, "dm"],
    [{ spaceType: "DIRECT_MESSAGE", singleUserBotDm: true }, "dm"],
    [{ singleUserBotDm: true }, "dm"],
    [{ type: "ROOM", spaceType: "SPACE" }, null],
    [{ spaceType: "GROUP_CHAT" }, null],
    [{ spaceType: "DIRECT_MESSAGE", singleUserBotDm: false }, null],
    [{ type: "DM", spaceType: "SPACE", singleUserBotDm: true }, null],
    [{}, null],
  ])("classifies signed Chat space metadata %#", (space, expected) => {
    expect(googleChatConversationKind(space)).toBe(expected);
  });

  it("requires the trusted DM kind on jobs before either worker can execute them", () => {
    const job = {
      receiptId: "550e8400-e29b-41d4-a716-446655440000",
      externalEventId: "spaces/AAAA/messages/request-1",
      employeeId: "c0000000-0000-4000-8000-000000000001",
      conversationKind: "dm",
      googleUserName: "users/123456",
      spaceName: "spaces/AAAA",
      threadName: "spaces/AAAA/threads/thread-1",
      prompt: "Check delivery",
      appOrigin: "https://hrmny-os.vercel.app",
      externalRef: "google-chat:spaces/AAAA:root",
      title: "Google Chat",
    };
    expect(googleChatJobSchema.safeParse(job).success).toBe(true);
    expect(
      googleChatJobSchema.safeParse({ ...job, conversationKind: "space" })
        .success,
    ).toBe(false);
    expect(
      googleChatJobSchema.safeParse({ ...job, conversationKind: undefined })
        .success,
    ).toBe(false);
  });

  it("accepts only the exact endpoint audience and Google Chat service identity", () => {
    expect(verifyGoogleChatJwt(token(), audience, [publicJwk], now).email).toBe(
      "chat@system.gserviceaccount.com",
    );
    expect(() =>
      verifyGoogleChatJwt(token(), `${audience}/wrong`, [publicJwk], now),
    ).toThrow(/AUDIENCE/);
    expect(() =>
      verifyGoogleChatJwt(
        token({ email: "attacker@example.com" }),
        audience,
        [publicJwk],
        now,
      ),
    ).toThrow();
  });

  it("rejects expired and tampered tokens", () => {
    expect(() =>
      verifyGoogleChatJwt(token({ exp: now - 60 }), audience, [publicJwk], now),
    ).toThrow(/TIME/);
    const parts = token().split(".");
    const signature = Buffer.from(parts[2]!, "base64url");
    signature[0] = (signature[0] ?? 0) ^ 1;
    const tampered = `${parts[0]}.${parts[1]}.${signature.toString("base64url")}`;
    expect(() =>
      verifyGoogleChatJwt(tampered, audience, [publicJwk], now),
    ).toThrow(/SIGNATURE/);
    expect(() =>
      verifyGoogleChatJwt("a".repeat(16_385), audience, [publicJwk], now),
    ).toThrow(/INVALID/);
  });

  it("publishes the exact Google Chat endpoint", () => {
    expect(googleChatEndpoint("https://hrmny-os.vercel.app/")).toBe(audience);
  });

  it("posts one deterministic threaded reply and verifies it by readback", async () => {
    vi.stubEnv(
      "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        client_email: "hrmny-chat@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
      }),
    );
    const receiptId = "550e8400-e29b-41d4-a716-446655440000";
    const messageId = googleChatReplyMessageId(receiptId);
    const messageName = "spaces/AAAA/messages/server-id.server-id";
    const verifiedMessage = {
      name: messageName,
      clientAssignedMessageId: messageId,
      text: "Pipeline is ready.",
      privateMessageViewer: { name: "users/123456" },
      thread: { name: "spaces/AAAA/threads/thread-1" },
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(Response.json({ name: messageName }))
      .mockResolvedValueOnce(Response.json(verifiedMessage));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendGoogleChatReply({
        employeeId: "c0000000-0000-4000-8000-000000000001",
        receiptId,
        spaceName: "spaces/AAAA",
        threadName: "spaces/AAAA/threads/thread-1",
        text: "Pipeline is ready.",
        googleUserName: "users/123456",
      }),
    ).resolves.toMatchObject({ name: messageName });
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(Response.json(verifiedMessage));
    await expect(
      sendGoogleChatReply({
        employeeId: "c0000000-0000-4000-8000-000000000001",
        receiptId,
        spaceName: "spaces/AAAA",
        threadName: "spaces/AAAA/threads/thread-1",
        text: "Pipeline is ready.",
        googleUserName: "users/123456",
      }),
    ).resolves.toMatchObject({ name: messageName });
    expect(googleChatAsyncConfigured()).toBe(true);
    expect(messageId).toMatch(/^client-[a-f0-9]{40}$/);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      "messageReplyOption=REPLY_MESSAGE_OR_FAIL",
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain(
      `requestId=${receiptId}`,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      String(fetchMock.mock.calls[4]?.[0]),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(
      JSON.stringify({
        text: "Pipeline is ready.",
        privateMessageViewer: { name: "users/123456" },
        thread: { name: "spaces/AAAA/threads/thread-1" },
      }),
    );
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/messages?") && init?.method === "POST",
      ),
    ).toHaveLength(2);
    for (const wrong of [
      { ...verifiedMessage, name: "spaces/BBBB/messages/server-id.server-id" },
      { ...verifiedMessage, clientAssignedMessageId: "client-another-receipt" },
      { ...verifiedMessage, privateMessageViewer: { name: "users/999999" } },
      { ...verifiedMessage, text: "Different content" },
      { ...verifiedMessage, thread: { name: "spaces/BBBB/threads/thread-1" } },
    ]) {
      fetchMock
        .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
        .mockResolvedValueOnce(new Response(null, { status: 409 }))
        .mockResolvedValueOnce(Response.json(wrong));
      await expect(
        sendGoogleChatReply({
          employeeId: "c0000000-0000-4000-8000-000000000001",
          receiptId,
          spaceName: "spaces/AAAA",
          threadName: "spaces/AAAA/threads/thread-1",
          text: "Pipeline is ready.",
          googleUserName: "users/123456",
        }),
      ).rejects.toThrow("GOOGLE_CHAT_REPLY_MISMATCH");
    }
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockResolvedValueOnce(Response.json(verifiedMessage));
    await expect(
      sendGoogleChatReply({
        employeeId: "c0000000-0000-4000-8000-000000000001",
        receiptId,
        spaceName: "spaces/AAAA",
        threadName: "spaces/AAAA/threads/thread-1",
        text: "Pipeline is ready.",
        googleUserName: "users/123456",
      }),
    ).resolves.toMatchObject({ name: messageName });
    fetchMock
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(new Response(null, { status: 409 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      sendGoogleChatReply({
        employeeId: "c0000000-0000-4000-8000-000000000001",
        receiptId,
        spaceName: "spaces/AAAA",
        threadName: "spaces/AAAA/threads/thread-1",
        text: "Pipeline is ready.",
        googleUserName: "users/123456",
      }),
    ).rejects.toThrow("GOOGLE_CHAT_READBACK_403");
  });

  it("does not send a prepared answer after revocation or a directory failure", async () => {
    vi.stubEnv(
      "GOOGLE_CHAT_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        client_email: "hrmny-chat@example.iam.gserviceaccount.com",
        private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
      }),
    );
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ access_token: "access-token" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    for (const outcome of [null, new Error("Directory unavailable")]) {
      if (outcome)
        vi.mocked(resolveActiveStaffById).mockRejectedValueOnce(outcome);
      else vi.mocked(resolveActiveStaffById).mockResolvedValueOnce(null);
      await expect(
        sendGoogleChatReply({
          employeeId: "c0000000-0000-4000-8000-000000000001",
          receiptId: "550e8400-e29b-41d4-a716-446655440000",
          spaceName: "spaces/AAAA",
          threadName: "spaces/AAAA/threads/thread-1",
          text: "Private prepared answer",
          googleUserName: "users/123456",
        }),
      ).rejects.toThrow(outcome?.message ?? "GOOGLE_CHAT_STAFF_ACCESS_REVOKED");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      fetchMock.mock.calls.every(
        ([url]) => String(url) === "https://oauth2.googleapis.com/token",
      ),
    ).toBe(true);
  });

  it("accepts and replays one signed staff onboarding event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [publicJwk] })),
    );
    const liveNow = Math.floor(Date.now() / 1_000);
    const body = JSON.stringify({
      type: "ADDED_TO_SPACE",
      eventTime: "2026-09-03T12:00:00Z",
      space: { name: "spaces/AAAA", displayName: "Sales", type: "DM" },
      user: { email: "operator@hrmny.co", displayName: "Operator" },
    });
    const send = () =>
      handleGoogleChatRequest(
        new Request(audience, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token({ exp: liveNow + 300, iat: liveNow - 10 })}`,
            "content-type": "application/json",
          },
          body,
        }),
      );

    const first = await send();
    const replay = await send();
    expect(first.status).toBe(200);
    const firstPayload = await first.json();
    const replayPayload = await replay.json();
    expect(firstPayload).toEqual(replayPayload);
    expect(replayPayload).toMatchObject({
      text: expect.stringContaining("hrmny AI Assistant is connected"),
    });
  });

  it("rejects shared and ambiguous messages before creating a personal receipt or assistant turn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [publicJwk] })),
    );
    const liveNow = Math.floor(Date.now() / 1_000);
    const chatCalls = chatSend.mock.calls.length;
    const spaces = [
      { type: "ROOM", spaceType: "SPACE", singleUserBotDm: false },
      { spaceType: "GROUP_CHAT" },
      { spaceType: "DIRECT_MESSAGE", singleUserBotDm: false },
      { type: "DM", spaceType: "SPACE", singleUserBotDm: true },
      {},
    ];
    for (const [index, space] of spaces.entries()) {
      const spaceName = `spaces/Denied${index}`;
      const messageName = `${spaceName}/messages/request-${index}`;
      const response = await handleGoogleChatRequest(
        new Request(audience, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token({ exp: liveNow + 300, iat: liveNow - 10 })}`,
          },
          body: JSON.stringify({
            type: "MESSAGE",
            space: { name: spaceName, ...space },
            user: { name: "users/123456", email: "operator@hrmny.co" },
            message: { name: messageName, text: "Use my private context" },
          }),
        }),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "direct_message_required",
      });
      await expect(
        getIntegrationReceipt("google-chat", messageName),
      ).resolves.toBeNull();
    }
    const sharedOnboarding = await handleGoogleChatRequest(
      new Request(audience, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token({ exp: liveNow + 300, iat: liveNow - 10 })}`,
        },
        body: JSON.stringify({
          type: "ADDED_TO_SPACE",
          eventTime: "2026-09-11T12:00:00Z",
          space: { name: "spaces/Shared", spaceType: "SPACE" },
          user: { name: "users/123456", email: "operator@hrmny.co" },
        }),
      }),
    );
    expect(sharedOnboarding.status).toBe(403);
    await expect(sharedOnboarding.json()).resolves.toEqual({
      error: "direct_message_required",
    });
    expect(chatSend).toHaveBeenCalledTimes(chatCalls);
  });

  it("binds signed messages to staff, enables tools, and returns private replies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [publicJwk] })),
    );
    const liveNow = Math.floor(Date.now() / 1_000);
    const event = {
      type: "MESSAGE",
      space: { name: "spaces/AAAA", type: "DM" },
      user: { name: "users/123456", email: "operator@hrmny.co" },
      message: {
        name: "spaces/AAAA/messages/request-1",
        text: "Check delivery",
        thread: { name: "spaces/AAAA/threads/thread-1" },
      },
    };
    const send = (body: unknown) =>
      handleGoogleChatRequest(
        new Request(audience, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token({ exp: liveNow + 300, iat: liveNow - 10 })}`,
          },
          body: JSON.stringify(body),
        }),
      );
    const response = await send(event);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      text: expect.stringContaining("Scoped task result"),
      privateMessageViewer: { name: "users/123456" },
    });
    expect(chatSend).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: "react",
        proposalOnly: true,
        content: "Check delivery",
      }),
    );
    expect(createCaller).toHaveBeenCalledWith(
      expect.objectContaining({
        employeeId: "c0000000-0000-4000-8000-000000000001",
        clientId: null,
      }),
    );
    const modern = await send({
      ...event,
      space: {
        name: "spaces/BBBB",
        spaceType: "DIRECT_MESSAGE",
        singleUserBotDm: true,
      },
      message: {
        ...event.message,
        name: "spaces/BBBB/messages/request-modern",
        thread: { name: "spaces/BBBB/threads/thread-1" },
      },
    });
    expect(modern.status).toBe(200);
    expect(await modern.json()).toMatchObject({
      text: expect.stringContaining("Scoped task result"),
      privateMessageViewer: { name: "users/123456" },
    });
    chatSend.mockImplementationOnce(async () => {
      vi.mocked(resolveActiveStaffById).mockResolvedValueOnce(null);
      return {
        assistant: { content: "Private answer generated during revocation" },
      };
    });
    const revoked = await send({
      ...event,
      message: {
        ...event.message,
        name: "spaces/AAAA/messages/request-revoked",
      },
    });
    expect(await revoked.json()).toMatchObject({
      text: expect.not.stringContaining(
        "Private answer generated during revocation",
      ),
      privateMessageViewer: { name: "users/123456" },
    });
    expect(
      (await send({ ...event, user: { email: "operator@hrmny.co" } })).status,
    ).toBe(400);
    expect(
      (
        await send({
          ...event,
          user: { ...event.user, email: "outsider@example.com" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await send({
          ...event,
          message: {
            ...event.message,
            thread: { name: "spaces/BBBB/threads/thread-1" },
          },
        })
      ).status,
    ).toBe(400);
  });
});

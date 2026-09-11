import { afterEach, expect, it, vi } from "vitest";
import { operateQmGoogleChat } from "@/server/qm/google-chat-worker";
import { resolveEmployeeGoogleIdentity } from "@/server/qm/google-identity";
import { POST } from "./route";

vi.mock("@/server/qm/google-chat-worker", async (original) => ({
  ...(await original<typeof import("@/server/qm/google-chat-worker")>()),
  operateQmGoogleChat: vi.fn(async () => ({ job: null })),
}));
vi.mock("@/server/qm/google-identity", async (original) => ({
  ...(await original<typeof import("@/server/qm/google-identity")>()),
  resolveEmployeeGoogleIdentity: vi.fn(async () => ({
    employeeId: "11111111-1111-4111-8111-111111111111",
    principal: "developer@hrmny.co",
  })),
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
const secret = "synthetic-bridge-credential-".repeat(2);
const request = (body: string, authorization = `Bearer ${secret}`) =>
  new Request("https://os.example/api/qm/google-chat", {
    method: "POST",
    headers: { authorization },
    body,
  });

it("requires the service credential and bounded strict actions before accessing the queue", async () => {
  vi.stubEnv("QM_CHAT_BRIDGE_TOKEN", secret);
  expect(
    (await POST(request('{"action":"claim"}', "Bearer browser-session")))
      .status,
  ).toBe(403);
  expect(
    (await POST(request('{"action":"claim","employeeId":"spoofed"}'))).status,
  ).toBe(400);
  expect((await POST(request("x".repeat(128_001)))).status).toBe(413);
  expect(operateQmGoogleChat).not.toHaveBeenCalled();
  const response = await POST(request('{"action":"claim"}'));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ job: null });
  vi.stubEnv("QM_CHAT_BRIDGE_TOKEN", "");
  expect((await POST(request('{"action":"claim"}'))).status).toBe(403);
});

it("returns only safe revocation and unavailable errors", async () => {
  vi.stubEnv("QM_CHAT_BRIDGE_TOKEN", secret);
  vi.mocked(operateQmGoogleChat).mockRejectedValueOnce(
    new Error("QM_CHAT_STAFF_REVOKED"),
  );
  expect((await POST(request('{"action":"claim"}'))).status).toBe(403);
  vi.mocked(operateQmGoogleChat).mockRejectedValueOnce(
    new Error("synthetic private error detail"),
  );
  const response = await POST(request('{"action":"claim"}'));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "QM_CHAT_UNAVAILABLE" });
});

it("authenticates and strictly validates identity reads without accepting employee authority", async () => {
  vi.stubEnv("QM_CHAT_BRIDGE_TOKEN", secret);
  const denied = await POST(
    request(
      JSON.stringify({
        action: "resolve_identity",
        proof: "chat",
        googleChatUser: "users/123",
      }),
      "Bearer browser-session",
    ),
  );
  expect(denied.status).toBe(403);
  expect(resolveEmployeeGoogleIdentity).not.toHaveBeenCalled();

  for (const body of [
    {
      action: "resolve_identity",
      proof: "chat",
      googleChatUser: "users/not-numeric",
    },
    {
      action: "resolve_identity",
      proof: "oidc",
      principal: "developer@hrmny.co",
      googleIssuer: "https://evil.example",
      googleSubject: "123",
    },
    {
      action: "resolve_identity",
      proof: "chat",
      googleChatUser: "users/123",
      employeeId: "11111111-1111-4111-8111-111111111111",
    },
  ]) {
    expect((await POST(request(JSON.stringify(body)))).status).toBe(400);
  }
  expect(resolveEmployeeGoogleIdentity).not.toHaveBeenCalled();

  const response = await POST(
    request(
      JSON.stringify({
        action: "resolve_identity",
        proof: "oidc",
        principal: "developer@hrmny.co",
        googleIssuer: "https://accounts.google.com",
        googleSubject: "123",
      }),
    ),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({
    identity: {
      employeeId: "11111111-1111-4111-8111-111111111111",
      principal: "developer@hrmny.co",
    },
  });
  const chatResponse = await POST(
    request(
      JSON.stringify({
        action: "resolve_identity",
        proof: "chat",
        googleChatUser: "users/123",
      }),
    ),
  );
  expect(chatResponse.status).toBe(200);
  expect(resolveEmployeeGoogleIdentity).toHaveBeenCalledTimes(2);
});

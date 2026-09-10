import { afterEach, expect, it, vi } from "vitest";
import { operateQmGoogleChat } from "@/server/qm/google-chat-worker";
import { POST } from "./route";

vi.mock("@/server/qm/google-chat-worker", async (original) => ({
  ...(await original<typeof import("@/server/qm/google-chat-worker")>()),
  operateQmGoogleChat: vi.fn(async () => ({ job: null })),
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
  const delivery = JSON.stringify({
    action: "deliver",
    deliveryId: "550e8400-e29b-41d4-a716-446655440000",
    targetEmail: "developer@hrmny.co",
    text: "Private cron digest",
    attachments: [],
    audienceScopeId: "personal:developer@hrmny.co",
    onBehalfOf: "developer@hrmny.co",
    provenance: {
      trigger: "cron",
      surface: "cron",
      sourceScopeId: "personal:developer@hrmny.co",
    },
  });
  expect((await POST(request(delivery))).status).toBe(200);
  expect((await POST(request(delivery.replace('"attachments":[]', '"attachments":["blocked"]')))).status).toBe(400);
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

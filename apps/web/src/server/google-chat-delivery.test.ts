import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const employeeId = "c0000000-0000-4000-8000-000000000001";
const deliveryId = "550e8400-e29b-41d4-a716-446655440000";
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2_048 });
const state = vi.hoisted(() => ({
  db: {} as { execute: ReturnType<typeof vi.fn> } | null,
  user: null as Record<string, unknown> | null,
  binding: null as Record<string, unknown> | null,
  receipt: null as Record<string, unknown> | null,
  completed: null as Record<string, unknown> | null,
}));

vi.mock("./db", () => ({ getDb: () => state.db }));
vi.mock("./auth/session", () => ({
  resolveActiveStaffByEmail: vi.fn(async () => state.user),
  resolveActiveStaffById: vi.fn(async () => state.user),
  sessionCanViewMargin: vi.fn(() => false),
}));
vi.mock("./integrations/inbox", () => ({
  recordIntegrationReceipt: vi.fn(async (input: Record<string, unknown>) => {
    if (!state.receipt) {
      state.receipt = {
        receiptId: "660e8400-e29b-41d4-a716-446655440000",
        status: "processing",
        ownerEmployeeId: input.ownerEmployeeId,
        payload: input.payload,
        payloadHash: "hash",
        result: null,
      };
    }
    return state.receipt;
  }),
  completeIntegrationReceipt: vi.fn(async (_id: string, result: Record<string, unknown>) => {
    state.completed = result;
    if (state.receipt) {
      state.receipt.status = "completed";
      state.receipt.result = result;
    }
  }),
  getIntegrationReceipt: vi.fn(),
  hashIntegrationPayload: vi.fn(() => "hash"),
  transitionIntegrationReceiptProgress: vi.fn(),
  updateIntegrationReceiptProgress: vi.fn(),
}));

import { operateQmGoogleChat } from "./qm/google-chat-worker";

const envelope = () => ({
  action: "deliver" as const,
  deliveryId,
  targetEmail: "developer@hrmny.co",
  text: "Private digest",
  attachments: [],
  audienceScopeId: "personal:developer@hrmny.co",
  onBehalfOf: "developer@hrmny.co",
  provenance: { trigger: "cron" as const, surface: "cron" as const, sourceScopeId: "personal:developer@hrmny.co" },
});

function binding(spaceName = "spaces/AAAA", googleUserName = "users/123456") {
  return { payload: { privateDm: { employeeId, googleUserName, spaceName, threadName: null } }, owner_employee_id: employeeId };
}

beforeEach(() => {
  state.user = { employeeId, email: "developer@hrmny.co", actorType: "staff", clientId: null, roles: [] };
  state.binding = binding();
  state.receipt = null;
  state.completed = null;
  state.db = { execute: vi.fn(async () => (state.binding ? [state.binding] : [])) };
  vi.stubEnv("GOOGLE_CHAT_RUNTIME", "qm");
  vi.stubEnv("QM_GOOGLE_CHAT_EMPLOYEE_IDS", employeeId);
  vi.stubEnv("GOOGLE_CHAT_SERVICE_ACCOUNT_JSON", JSON.stringify({
    client_email: "hrmny-chat@example.iam.gserviceaccount.com",
    private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("personal cron Google Chat delivery", () => {
  it("freezes the signed DM binding across an ambiguous retry and stores the verified message", async () => {
    let messageId = "";
    const posts: string[] = [];
    let ambiguous = true;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "token" });
      if (init?.method === "POST") {
        posts.push(new URL(href).pathname);
        if (ambiguous) throw new Error("lost response");
        messageId = new URL(href).searchParams.get("messageId") ?? "";
        return Response.json({ name: "spaces/AAAA/messages/provider-message" });
      }
      if (ambiguous) return new Response(null, { status: 404 });
      return Response.json({ name: "spaces/AAAA/messages/provider-message", clientAssignedMessageId: messageId, text: "Private digest", privateMessageViewer: { name: "users/123456" } });
    }));
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("GOOGLE_CHAT_SEND_AMBIGUOUS");
    state.binding = binding("spaces/BBBB");
    ambiguous = false;
    await expect(operateQmGoogleChat(envelope())).resolves.toMatchObject({ ok: true });
    expect(posts).toEqual(["/v1/spaces/AAAA/messages", "/v1/spaces/AAAA/messages"]);
    expect(state.completed).toMatchObject({ messageName: "spaces/AAAA/messages/provider-message" });
  });

  it("fails closed for malformed scope, no database, missing or foreign DM, and changed Google identity", async () => {
    await expect(operateQmGoogleChat({ ...envelope(), attachments: ["file"] })).rejects.toThrow();
    await expect(operateQmGoogleChat({ ...envelope(), onBehalfOf: "other@hrmny.co" })).rejects.toThrow("QM_CHAT_DELIVERY_SCOPE_INVALID");
    state.db = null;
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_DATABASE_REQUIRED");
    state.db = { execute: vi.fn(async () => []) };
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_DM_REQUIRED");
    state.db = { execute: vi.fn(async () => (state.binding ? [state.binding] : [])) };
    state.binding = { payload: { privateDm: { ...binding().payload.privateDm, employeeId: "c0000000-0000-4000-8000-000000000099" } }, owner_employee_id: "c0000000-0000-4000-8000-000000000099" };
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_DM_REQUIRED");
    state.binding = { payload: { space: "spaces/legacy" }, owner_employee_id: employeeId };
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_DM_REQUIRED");
    state.binding = binding();
    const { action: _action, ...delivery } = envelope();
    state.receipt = { receiptId: "660e8400-e29b-41d4-a716-446655440000", status: "processing", ownerEmployeeId: employeeId, payloadHash: "hash", payload: { delivery, binding: binding().payload.privateDm }, result: null };
    state.binding = binding("spaces/AAAA", "users/999999");
    state.db = { execute: vi.fn(async () => (state.binding ? [state.binding] : [])) };
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_DM_REVOKED");
  });

  it("rejects changed receipt ownership or payload and rechecks the pilot after token acquisition", async () => {
    const { action: _action, ...delivery } = envelope();
    const frozen = { delivery, binding: binding().payload.privateDm };
    state.receipt = { receiptId: "660e8400-e29b-41d4-a716-446655440000", status: "processing",
      ownerEmployeeId: "c0000000-0000-4000-8000-000000000099", payloadHash: "hash", payload: frozen, result: null };
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_RECEIPT_MISMATCH");
    state.receipt = { ...state.receipt, ownerEmployeeId: employeeId, payloadHash: "wrong" };
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_RECEIPT_MISMATCH");
    state.receipt = null;
    let providerPosts = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes("oauth2.googleapis.com/token")) {
        vi.stubEnv("QM_GOOGLE_CHAT_EMPLOYEE_IDS", "");
        return Response.json({ access_token: "token" });
      }
      if (init?.method === "POST") providerPosts += 1;
      return Response.json({});
    }));
    await expect(operateQmGoogleChat(envelope())).rejects.toThrow("QM_CHAT_DELIVERY_STAFF_REVOKED");
    expect(providerPosts).toBe(0);
  });

  it("returns a completed verified receipt without another provider request", async () => {
    const first = envelope();
    const { action: _action, ...delivery } = first;
    const recipientThreadRef = `web:developer@hrmny.co:google-chat-${employeeId}-fee03f4338aaac82be37ad9f67d8729977a664828520f8dfad67151ccd5d9b58`;
    state.receipt = { receiptId: "660e8400-e29b-41d4-a716-446655440000", status: "completed",
      ownerEmployeeId: employeeId, payloadHash: "hash", payload: { delivery, binding: binding().payload.privateDm },
      result: { recipientThreadRef, messageName: "spaces/AAAA/messages/provider-message" } };
    const provider = vi.fn();
    vi.stubGlobal("fetch", provider);
    await expect(operateQmGoogleChat(first)).resolves.toEqual({ ok: true, recipientThreadRef });
    expect(provider).not.toHaveBeenCalled();
  });
});

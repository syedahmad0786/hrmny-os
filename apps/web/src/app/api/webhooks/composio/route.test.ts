import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetIntegrationReceiptMemory } from "@/server/integrations/inbox";
import { handleComposioPost } from "./handler";
import { POST } from "./route";
import { resetCrmMemory } from "@/server/crm/memory";
import {
  createCompany,
  createContact,
  createDeal,
  updateContact,
} from "@/server/crm/repository";
import {
  insertOutreach,
  patchOutreach,
  resetLeadgenStore,
} from "@/server/leadgen/store";
import {
  listEmailEvents,
  recordEmailEvent,
  resetSalesOsStore,
} from "@/server/sales-os/store";
import { ingestGmailReply } from "@/server/sales-os/replies";

const SECRET = "composio-webhook-secret";

function request(id: string, body: string): Request {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const digest = createHmac("sha256", SECRET)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest("base64");
  return new Request("http://localhost/api/webhooks/composio", {
    method: "POST",
    headers: {
      "webhook-id": id,
      "webhook-timestamp": timestamp,
      "webhook-signature": `v1,${digest}`,
    },
    body,
  });
}

describe("Composio webhook route", () => {
  beforeEach(() => {
    vi.stubEnv("COMPOSIO_WEBHOOK_SECRET", SECRET);
    vi.stubEnv("DATABASE_URL", "");
    resetIntegrationReceiptMemory();
    resetCrmMemory();
    resetLeadgenStore();
    resetSalesOsStore();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("durably claims a signed event before acknowledging a replay", async () => {
    const body = JSON.stringify({
      metadata: { trigger_slug: "GMAIL_NEW_EMAIL" },
      data: {},
    });
    const first = await POST(request("msg_1", body));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      ok: true,
      duplicate: false,
      handled: "acknowledged",
    });

    const replay = await POST(request("msg_1", body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, duplicate: true });
  });

  it("rejects an invalid signature before creating a receipt", async () => {
    const response = await POST(
      new Request("http://localhost/api/webhooks/composio", {
        method: "POST",
        headers: {
          "webhook-id": "msg_bad",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,invalid",
        },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("rejects a webhook id reused for a different signed payload", async () => {
    expect((await POST(request("msg_conflict", '{"value":1}'))).status).toBe(
      200,
    );
    const conflict = await POST(request("msg_conflict", '{"value":2}'));
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "EVENT_ID_CONFLICT",
    });
  });

  it("ingests a signed Gmail reply once for its connected owner and thread", async () => {
    const ownerEmployeeId = "11111111-1111-1111-1111-111111111111";
    const company = await createCompany({ name: "Acme LLC" });
    const contact = await createContact({
      companyId: company.companyId,
      firstName: "Sara",
      email: "sara@acme.example",
    });
    await updateContact(contact.contactId, { emailVerified: true });
    const deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
      primaryContactId: contact.contactId,
    });
    const outreach = await insertOutreach({
      dealId: deal.dealId,
      channel: "gmail",
      recipient: "sara@acme.example",
      body: "Hi Sara — I noticed Acme LLC is growing in the UAE.",
      contactId: contact.contactId,
    });
    await patchOutreach(outreach.id, {
      state: "sent",
      externalId: "sent-1",
      sentAt: new Date().toISOString(),
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      contactId: contact.contactId,
      kind: "sent",
      externalId: "sent-1",
      payload: { ownerEmployeeId, threadId: "thread-1" },
    });

    const body = JSON.stringify({
      type: "composio.trigger.message",
      metadata: {
        trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
        user_id: ownerEmployeeId,
        connected_account_id: "conn-1",
      },
      data: {
        id: "reply-1",
        thread_id: "thread-1",
        headers: [{ name: "Message-ID", value: "<reply-1@example.com>" }],
        sender: "Sara <sara@acme.example>",
        message_text: "Interested — let's schedule a call.",
        label_ids: ["INBOX"],
      },
    });
    const verifyAccountOwner = vi.fn(async () => true);
    const deps = { verifyAccountOwner, ingestReply: ingestGmailReply };
    const first = await handleComposioPost(request("reply-hook-1", body), deps);
    const replay = await handleComposioPost(
      request("reply-hook-1", body),
      deps,
    );

    await expect(first.json()).resolves.toMatchObject({
      ok: true,
      handled: "gmail_reply",
      result: { intent: "interested", applied: true },
    });
    await expect(replay.json()).resolves.toMatchObject({
      ok: true,
      duplicate: true,
    });
    expect(verifyAccountOwner).toHaveBeenCalledTimes(1);
    expect(await listEmailEvents({ kind: "replied" })).toHaveLength(1);
    await expect(listEmailEvents({ kind: "replied" })).resolves.toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          threadId: "thread-1",
          rfcMessageId: "<reply-1@example.com>",
          senderConnectionAccountId: "conn-1",
        }),
      }),
    ]);
  });

  it("fails closed when the signed event names another Gmail owner", async () => {
    const body = JSON.stringify({
      type: "composio.trigger.message",
      metadata: {
        trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
        user_id: "11111111-1111-1111-1111-111111111111",
        connected_account_id: "conn-wrong",
      },
      data: {
        id: "reply-wrong",
        sender: "person@example.com",
        message_text: "Interested",
      },
    });
    const response = await handleComposioPost(request("wrong-owner", body), {
      verifyAccountOwner: async () => false,
      ingestReply: ingestGmailReply,
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "PROCESSING_FAILED",
      reason: expect.stringMatching(/owner mismatch/i),
    });
    expect(await listEmailEvents({ kind: "replied" })).toHaveLength(0);
  });

  it("records a Gmail bounce, suppresses the recipient, and discards its queued follow-up", async () => {
    const ownerEmployeeId = "11111111-1111-1111-1111-111111111111";
    const company = await createCompany({ name: "Bounce Co" });
    const contact = await createContact({
      companyId: company.companyId,
      firstName: "Nora",
      email: "nora@bounce.example",
    });
    const deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
      primaryContactId: contact.contactId,
    });
    const sent = await insertOutreach({
      dealId: deal.dealId,
      channel: "gmail",
      recipient: "nora@bounce.example",
      body: "First message",
      contactId: contact.contactId,
    });
    await patchOutreach(sent.id, {
      state: "sent",
      externalId: "sent-bounce-1",
      sentAt: new Date().toISOString(),
    });
    const queued = await insertOutreach({
      dealId: deal.dealId,
      channel: "gmail",
      recipient: "nora@bounce.example",
      body: "Follow-up",
      contactId: contact.contactId,
      cadenceTouch: 2,
    });
    await recordEmailEvent({
      outreachItemId: sent.id,
      contactId: contact.contactId,
      kind: "sent",
      externalId: "sent-bounce-1",
      payload: { ownerEmployeeId, threadId: "thread-bounce-1" },
    });
    const body = JSON.stringify({
      type: "composio.trigger.message",
      metadata: {
        trigger_slug: "GMAIL_NEW_GMAIL_MESSAGE",
        user_id: ownerEmployeeId,
        connected_account_id: "conn-1",
      },
      data: {
        id: "bounce-1",
        thread_id: "thread-bounce-1",
        sender: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        message_text:
          "Your message was not delivered. Final-Recipient: rfc822; nora@bounce.example",
        label_ids: ["INBOX"],
      },
    });
    const response = await handleComposioPost(request("bounce-hook-1", body), {
      verifyAccountOwner: async () => true,
      ingestReply: ingestGmailReply,
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      handled: "gmail_bounce",
      result: { applied: true, discardedFollowups: 1 },
    });
    expect(await listEmailEvents({ kind: "bounced" })).toHaveLength(1);
    await expect(
      (await import("@/server/leadgen/store")).getOutreach(queued.id),
    ).resolves.toMatchObject({ state: "discarded" });
  });
});

process.env.DATABASE_URL = "";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createComposioStub,
  type ComposioSendAdapter,
} from "@hrmny/integrations";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { resetCrmMemory } from "../crm/memory";
import {
  createCompany,
  createContact,
  createDeal,
  listActivities,
  updateContact,
} from "../crm/repository";
import { resetIntegrationReceiptMemory } from "../integrations/inbox";
import {
  insertOutreach,
  listOutreach,
  patchOutreach,
  resetLeadgenStore,
} from "../leadgen/store";
import { createCaller } from "../trpc/root";
import { sendOutreach } from "../trpc/leadgen-router";
import { ingestGmailReply } from "./replies";
import { recordEmailEvent, resetSalesOsStore } from "./store";
import { listSalesConversations } from "./conversations";

const MAILBOX_ID = "70000000-0000-4000-8000-000000000001";

describe("Sales Gmail conversations", () => {
  beforeEach(() => {
    resetCrmMemory();
    resetLeadgenStore();
    resetSalesOsStore();
    resetIntegrationReceiptMemory();
  });

  async function fixture() {
    const company = await createCompany({ name: "Inbox Proof Hospitality" });
    const contact = await createContact({
      companyId: company.companyId,
      firstName: "Sana",
      lastName: "Rahman",
      email: "sana@inbox-proof.test",
      isPrimary: true,
    });
    await updateContact(contact.contactId, { emailVerified: true });
    const deal = await createDeal({
      companyId: company.companyId,
      companyName: company.name,
      primaryContactId: contact.contactId,
    });
    const outreach = await insertOutreach({
      dealId: deal.dealId,
      contactId: contact.contactId,
      channel: "gmail",
      recipient: contact.email!,
      subject: "Winter campaign idea",
      body: "Original outbound message",
    });
    await patchOutreach(outreach.id, {
      state: "sent",
      sentAt: "2026-09-04T08:00:00.000Z",
      externalId: "gmail-sent-proof",
    });
    await recordEmailEvent({
      outreachItemId: outreach.id,
      contactId: contact.contactId,
      kind: "sent",
      provider: "gmail",
      externalId: "gmail-sent-proof",
      payload: {
        threadId: "gmail-thread-proof",
        dealId: deal.dealId,
        recipient: contact.email,
        subject: outreach.subject,
        body: outreach.body,
        senderEmail: "sales@hrmny.co",
        senderConnectionAccountId: MAILBOX_ID,
      },
    });
    return { company, contact, deal, outreach };
  }

  it("joins Gmail messages to the CRM deal and records one timeline activity", async () => {
    const { deal } = await fixture();
    const reply = {
      fromEmail: "sana@inbox-proof.test",
      subject: "Re: Winter campaign idea",
      body: "Interested. Can we meet on Tuesday?",
      externalId: "gmail-reply-proof",
      threadId: "gmail-thread-proof",
      rfcMessageId: "<gmail-reply-proof@example.com>",
      senderConnectionAccountId: MAILBOX_ID,
    };
    await ingestGmailReply(reply);
    await ingestGmailReply(reply);

    const conversations = await listSalesConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      dealId: deal.dealId,
      companyName: "Inbox Proof Hospitality",
      contactName: "Sana Rahman",
      contactEmail: "sana@inbox-proof.test",
      subject: "Re: Winter campaign idea",
      latestInboundBody: "Interested. Can we meet on Tuesday?",
    });
    expect(
      conversations[0]!.messages.map((message) => message.direction),
    ).toEqual(["outbound", "inbound"]);
    const replyActivities = (
      await listActivities({ dealId: deal.dealId })
    ).filter((activity) => activity.metadata.emailEventId);
    expect(replyActivities).toHaveLength(1);
    expect(replyActivities[0]).toMatchObject({
      type: "email",
      dealId: deal.dealId,
      body: "Interested. Can we meet on Tuesday?",
    });
  });

  it("creates a reply as draft only and reuses it on a repeated request", async () => {
    await fixture();
    await ingestGmailReply({
      fromEmail: "sana@inbox-proof.test",
      subject: "Re: Winter campaign idea",
      body: "Could you send timing and pricing?",
      externalId: "gmail-reply-draft-proof",
      threadId: "gmail-thread-proof",
      rfcMessageId: "<gmail-client-reply-proof@example.com>",
      senderConnectionAccountId: MAILBOX_ID,
    });
    const [conversation] = await listSalesConversations();
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });

    const first = await caller.leadgen.outreach.draftReply({
      conversationId: conversation!.id,
      body: "Yes — I can share a concise Inbox Proof Hospitality scope and discuss it on Tuesday.",
    });
    const second = await caller.leadgen.outreach.draftReply({
      conversationId: conversation!.id,
      body: "This must not create a second draft.",
    });

    expect(first.state).toBe("draft");
    expect(first.subject).toBe("Re: Winter campaign idea");
    expect(second.id).toBe(first.id);
    const all = await listOutreach();
    expect(all.filter((item) => item.state === "draft")).toHaveLength(1);
    expect(all.filter((item) => item.state === "approved")).toHaveLength(0);

    await recordEmailEvent({
      contactId: conversation!.contactId,
      kind: "replied",
      provider: "gmail",
      externalId: "gmail-competing-same-subject-reply",
      payload: {
        dealId: conversation!.dealId,
        from: conversation!.contactEmail,
        subject: conversation!.subject,
        threadId: "gmail-newer-competing-thread",
        rfcMessageId: "<gmail-newer-competing-reply@example.com>",
        senderConnectionAccountId: MAILBOX_ID,
      },
    });
    const refreshed = await listSalesConversations();
    const originalConversation = refreshed.find(
      (item) => item.threadId === "gmail-thread-proof",
    );
    const competingConversation = refreshed.find(
      (item) => item.threadId === "gmail-newer-competing-thread",
    );
    expect(originalConversation?.replyDraftId).toBe(first.id);
    expect(competingConversation?.replyDraftId).toBeNull();
    const competingDraft = await caller.leadgen.outreach.draftReply({
      conversationId: competingConversation!.id,
      body: "This reply belongs only to the later Gmail thread.",
    });
    expect(competingDraft.id).not.toBe(first.id);

    await caller.leadgen.outreach.approve({ id: first.id });
    const sendAfterApproval = vi.fn(
      async (): Promise<
        Awaited<ReturnType<ComposioSendAdapter["sendAfterApproval"]>>
      > => ({
        sent: true,
        mode: "live",
        externalId: "gmail-approved-reply-proof",
        threadId: "gmail-thread-proof",
        channel: "gmail",
        providerAccepted: true,
        readbackAt: "2026-09-04T10:00:00.000Z",
      }),
    );
    const composio = {
      ...createComposioStub(),
      sendAfterApproval,
    } satisfies ComposioSendAdapter;
    await sendOutreach({
      id: first.id,
      actor: {
        employeeId: user.employeeId,
        roles: user.roles,
        permissions: user.permissions,
      },
      composio,
      audit: async () => ({ auditId: "reply-send-audit" }),
      emit: async () => undefined,
    });
    expect(sendAfterApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "gmail-thread-proof",
        inReplyTo: "<gmail-client-reply-proof@example.com>",
      }),
    );
  });

  it("keeps conversation contents inside Sales roles", async () => {
    const user = resolveDevUser("finance");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });
    await expect(caller.leadgen.outreach.conversations()).rejects.toThrow(
      /only sales operators/i,
    );
  });

  it("keeps the same Gmail thread in separate mailbox conversations", async () => {
    const secondMailboxId = "70000000-0000-4000-8000-000000000002";
    await recordEmailEvent({
      kind: "replied",
      provider: "gmail",
      externalId: "gmail-shared-thread-mailbox-one",
      payload: {
        from: "one@example.test",
        body: "Reply in mailbox one",
        threadId: "gmail-shared-thread",
        rfcMessageId: "<one@example.test>",
        senderConnectionAccountId: MAILBOX_ID,
      },
    });
    await recordEmailEvent({
      kind: "replied",
      provider: "gmail",
      externalId: "gmail-shared-thread-mailbox-two",
      payload: {
        from: "two@example.test",
        body: "Reply in mailbox two",
        threadId: "gmail-shared-thread",
        rfcMessageId: "<two@example.test>",
        senderConnectionAccountId: secondMailboxId,
      },
    });

    const conversations = await listSalesConversations();
    expect(conversations).toHaveLength(2);
    expect(
      conversations.map(
        (conversation) => conversation.senderConnectionAccountId,
      ),
    ).toEqual(expect.arrayContaining([MAILBOX_ID, secondMailboxId]));
    expect(
      new Set(conversations.map((conversation) => conversation.id)).size,
    ).toBe(2);
  });

  it("leaves a known-thread sender mismatch unassociated and does not mutate the deal", async () => {
    const { deal } = await fixture();
    const beforeStage = deal.stage;
    const result = await ingestGmailReply({
      fromEmail: "different-person@inbox-proof.test",
      subject: "Re: Winter campaign idea",
      body: "Interested — please move this deal forward.",
      externalId: "gmail-known-thread-wrong-sender",
      threadId: "gmail-thread-proof",
      rfcMessageId: "<wrong-sender@example.com>",
      senderConnectionAccountId: MAILBOX_ID,
    });

    expect(result).toMatchObject({ applied: false });
    expect((await listSalesConversations())[0]).toMatchObject({
      dealId: null,
      contactId: null,
      outreachItemId: null,
      companyName: "Unmatched reply",
    });
    expect(
      (await listActivities({ dealId: deal.dealId })).some(
        (activity) =>
          activity.metadata.externalId === "gmail-known-thread-wrong-sender",
      ),
    ).toBe(false);
    const { getDeal } = await import("../crm/repository");
    expect((await getDeal(deal.dealId))?.stage).toBe(beforeStage);
  });

  it("refuses to turn a reply into a new Gmail thread when Message-ID is absent", async () => {
    await fixture();
    await ingestGmailReply({
      fromEmail: "sana@inbox-proof.test",
      subject: "Re: Winter campaign idea",
      body: "Thanks for the details.",
      externalId: "gmail-reply-without-rfc-id",
      threadId: "gmail-thread-proof",
      senderConnectionAccountId: MAILBOX_ID,
    });
    const [conversation] = await listSalesConversations();
    const user = resolveDevUser("partner");
    const caller = createCaller({
      user,
      employeeId: user.employeeId,
      roles: user.roles,
      canViewMargin: sessionCanViewMargin(user),
    });
    const sendAfterApproval = vi.fn();
    await expect(
      caller.leadgen.outreach.draftReply({
        conversationId: conversation!.id,
        body: "Inbox Proof Hospitality can review the agenda before Tuesday.",
      }),
    ).rejects.toThrow(
      /missing its provider thread, Message-ID, or receiving mailbox/i,
    );
    expect(sendAfterApproval).not.toHaveBeenCalled();
  });
});

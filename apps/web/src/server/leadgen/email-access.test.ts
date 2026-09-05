import { beforeEach, expect, it } from "vitest";
import { resolveDevUser } from "../auth/session";
import { runAgentTools } from "../ai/agent-tools";
import { resetCrmMemory } from "../crm/memory";
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  listActivities,
} from "../crm/repository";
import {
  recordIntegrationReceipt,
  resetIntegrationReceiptMemory,
} from "../integrations/inbox";
import { listAudit, writeAudit } from "../m1-persistence";
import { recordEmailEvent, resetSalesOsStore } from "../sales-os/store";
import { createCaller } from "../trpc/root";
import { insertOutreach, patchOutreach, resetLeadgenStore } from "./store";

const owner = resolveDevUser("partner");
const colleague = {
  ...owner,
  employeeId: "c0000000-0000-4000-8000-000000000099",
};
const caller = (user: typeof owner) =>
  createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: true,
  });

beforeEach(() => {
  resetCrmMemory();
  resetLeadgenStore();
  resetSalesOsStore();
  resetIntegrationReceiptMemory();
});

it("keeps sent mail, replies and reply drafts private across lists, IDs, AI and mutations, including another partner", async () => {
  const company = await createCompany({ name: "Mailbox Privacy Proof" });
  const contact = await createContact({
    companyId: company.companyId,
    firstName: "Client",
    email: "recipient@privacy.test",
  });
  const deal = await createDeal({
    companyId: company.companyId,
    companyName: company.name,
    primaryContactId: contact.contactId,
  });
  const source = await insertOutreach({
    dealId: deal.dealId,
    contactId: contact.contactId,
    channel: "gmail",
    recipient: contact.email!,
    subject: "PRIVATE-SUBJECT",
    body: "PRIVATE-OUTBOUND",
  });
  await patchOutreach(source.id, {
    state: "sent",
    sentAt: "2026-09-01T08:00:00.000Z",
  });
  for (const kind of ["sent", "replied"] as const) {
    await recordEmailEvent({
      outreachItemId: source.id,
      kind,
      provider: "gmail",
      externalId: `privacy-${kind}`,
      payload: {
        ownerEmployeeId: owner.employeeId,
        threadId: "private-thread",
        subject: "PRIVATE-SUBJECT",
        body: kind === "sent" ? "PRIVATE-OUTBOUND" : "PRIVATE-INBOUND",
      },
    });
  }
  const reply = await insertOutreach({
    dealId: deal.dealId,
    channel: "gmail",
    recipient: contact.email!,
    subject: "PRIVATE-REPLY",
    body: "PRIVATE-DRAFT",
  });
  await recordIntegrationReceipt({
    provider: "gmail",
    externalEventId: `outreach-reply-draft:${reply.id}`,
    operation: "messages.reply.draft",
    rawBody: reply.id,
    completed: true,
    ownerEmployeeId: owner.employeeId,
    payload: { outreachItemId: reply.id },
  });
  const legacy = await insertOutreach({
    dealId: deal.dealId,
    channel: "gmail",
    recipient: "unknown@privacy.test",
    subject: "LEGACY-PRIVATE",
    body: "LEGACY-BODY",
  });
  await patchOutreach(legacy.id, { state: "sent" });
  const followup = await insertOutreach({
    dealId: deal.dealId,
    channel: "gmail",
    recipient: contact.email!,
    subject: "PRIVATE-FOLLOWUP",
    body: "PRIVATE-OUTBOUND quoted in follow-up",
    cadenceTouch: 2,
  });
  const own = caller(owner);
  const other = caller(colleague);
  expect((await own.leadgen.outreach.list()).map((item) => item.id)).toEqual(
    expect.arrayContaining([source.id, reply.id, followup.id]),
  );
  expect((await own.leadgen.outreach.get({ id: source.id }))?.body).toBe(
    "PRIVATE-OUTBOUND",
  );
  const conversations = await own.leadgen.outreach.conversations();
  expect(conversations[0]?.latestInboundBody).toBe("PRIVATE-INBOUND");
  expect(await other.leadgen.outreach.conversations()).toEqual([]);
  expect(await other.leadgen.outreach.get({ id: source.id })).toBeNull();
  expect(await own.leadgen.outreach.get({ id: legacy.id })).toBeNull();
  expect(await other.leadgen.outreach.list()).toEqual([]);
  expect(await other.leadgen.outreach.followups()).toEqual([]);
  expect(JSON.stringify(await other.salesOs.digest())).not.toContain(
    "PRIVATE-",
  );
  expect(
    JSON.stringify(
      await runAgentTools({
        allowedTools: ["outreach.read"],
        prompt: "Read outreach",
        scope: { employeeId: colleague.employeeId },
      }),
    ),
  ).not.toContain("PRIVATE-");
  for (const action of [
    () =>
      other.leadgen.outreach.draftReply({
        conversationId: conversations[0]!.id,
      }),
    () => other.leadgen.outreach.draftFollowup({ id: source.id }),
    () => other.leadgen.outreach.approve({ id: reply.id }),
    () => other.leadgen.outreach.send({ id: reply.id }),
    () =>
      other.leadgen.outreach.sendTest({
        id: reply.id,
        idempotencyKey: "70000000-0000-4000-8000-000000000001",
      }),
    () => other.leadgen.outreach.discard({ id: reply.id }),
    () =>
      other.salesOs.outreach.rework({
        id: reply.id,
        feedback: "Read someone else's reply",
      }),
    () => other.salesOs.linkedin.markSkipped({ id: source.id }),
  ]) {
    await expect(action()).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
});

it("does not republish legacy email copies through shared activity or audit history", async () => {
  const activity = await createActivity({
    type: "email",
    subject: "PRIVATE-SUBJECT",
    body: "PRIVATE-BODY",
    metadata: {
      emailEventId: "event-proof",
      copiedMessage: "PRIVATE-METADATA",
    },
  });
  const activities = await listActivities();
  expect(
    activities.find((row) => row.activityId === activity.activityId)?.metadata
      .emailEventId,
  ).toBe("event-proof");
  expect(JSON.stringify(activities)).not.toContain("PRIVATE-");
  await writeAudit({
    actorEmployeeId: owner.employeeId,
    action: "outreach.sent",
    entityType: "outreach",
    entityId: "70000000-0000-4000-8000-000000000001",
    before: { state: "approved", body: "PRIVATE-BEFORE" },
    after: { state: "sent", data: { body: "PRIVATE-AFTER" } },
    reason: null,
  });
  const audit = (await listAudit(1))[0];
  expect(audit?.after).toEqual({ state: "sent" });
  expect(JSON.stringify(audit)).not.toContain("PRIVATE-");
});

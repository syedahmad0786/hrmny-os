import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { expect, it } from "vitest";
import { getDb } from "../db";
import {
  createContact,
  createDeal,
  createCrmTask,
  createNote,
  createQuoteVersion,
} from "./repository";
import { durableHandoverPack } from "./handover";

it("hands the accepted scope to Delivery without inventing campaigns, dates or prospecting", async () => {
  const db = getDb()!;
  const contact = await createContact({
    firstName: "CI",
    email: `handover-${randomUUID()}@example.test`,
  });
  const deal = await createDeal({
    companyName: `CI Handover ${randomUUID()}`,
    primaryContactId: contact.contactId,
  });
  // The commercial close is the input fixture; this proof exercises durable handover and replay.
  await db.execute(
    sql`update public.deal set stage = 'close', close_outcome = 'won' where deal_id = ${deal.dealId}::uuid`,
  );
  await createCrmTask({
    dealId: deal.dealId,
    title: "Confirm kickoff",
    dueDate: "2026-10-01",
  });
  for (const body of [
    "HANDOVER:BRAND_ASSETS — Approved CI fixture folder",
    "HANDOVER:BILLING_DETAILS — CI billing fixture confirmed",
  ]) {
    await createNote({ dealId: deal.dealId, body });
  }
  const quote = await createQuoteVersion({
    dealId: deal.dealId,
    lineItems: [
      {
        label: "Brand strategy workshop",
        qty: 1,
        unitSell: 10000,
        unitCost: 5000,
      },
    ],
    quoteValue: "10000",
    internalCost: "5000",
    marginPct: "50",
    status: "accepted",
  });
  const first = await durableHandoverPack({ dealId: deal.dealId });
  expect(first.ok, JSON.stringify(first)).toBe(true);
  if (!first.ok) return;
  expect(first.sourceQuoteId).toBe(quote.quoteId);
  expect(first.task).toMatchObject({
    taskType: "scope_delivery",
    status: "briefing",
    deadline: null,
  });
  expect(first.calendarId).toBeNull();
  expect(first.campaignItemId).toBeNull();
  expect(first.outreachId).toBeNull();
  expect(first.portalInvite).toBeNull();
  await db.execute(
    sql`update public.task set status = 'in_production' where task_id = ${first.task!.taskId}::uuid`,
  );
  const replay = await durableHandoverPack({ dealId: deal.dealId });
  expect(replay.ok, JSON.stringify(replay)).toBe(true);
  if (!replay.ok) return;
  expect(replay.task?.taskId).toBe(first.task?.taskId);
  expect(replay.task?.status).toBe("in_production");
  expect(replay.scopeId).toBe(first.scopeId);
  expect(replay.invoiceId).toBe(first.invoiceId);
});

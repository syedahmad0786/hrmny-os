process.env.DATABASE_URL = "";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isSyntheticDeal } from "../../lib/synthetic-records";
import { resetCrmMemory } from "../crm/memory";
import {
  createContact,
  createCrmTask,
  createDeal,
  updateContact,
  updateDeal,
} from "../crm/repository";
import {
  insertOutreach,
  patchOutreach,
  resetLeadgenStore,
} from "../leadgen/store";
import { outreachReadiness } from "../leadgen/readiness";
import { listMessages } from "../leadgen/google-workspace-monitor";
import {
  resetLeadgenDailyMemory,
  runLeadgenDailyCron,
} from "../leadgen/daily-cron";
import { resetSalesOsStore } from "./store";
import { buildSalesOsDigest } from "./digest";
import { buildComplianceFooter, buildUnsubscribeUrl } from "./compliance";

beforeEach(() => {
  const memory = resetCrmMemory();
  memory.deals.clear();
  memory.contacts.clear();
  memory.tasks.clear();
  resetLeadgenStore();
  resetSalesOsStore();
  resetLeadgenDailyMemory();
});

describe("operational sales repairs", () => {
  it("hides exact seed identities while allowing a genuine deal for the same brand", () => {
    expect(
      isSyntheticDeal({
        dealId: "e0000000-0000-4000-8000-000000000002",
        companyName: "Emaar Hospitality Group",
      }),
    ).toBe(true);
    expect(
      isSyntheticDeal({
        dealId: "real",
        companyName: "Emaar Hospitality Group",
      }),
    ).toBe(false);
    expect(
      isSyntheticDeal({
        companyName: "Cedar Studio",
        recordClass: "quarantined",
      }),
    ).toBe(true);
  });
  it("surfaces missing ownership and replaces setup with an assigned due task", async () => {
    const deal = await createDeal({ companyName: "Cedar Studio" });
    let digest = await buildSalesOsDigest();
    expect(digest.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dealId: deal.dealId, kind: "setup" }),
      ]),
    );
    const owner = "00000000-0000-4000-8000-000000000011";
    await updateDeal(deal.dealId, { ownerEmployeeId: owner });
    await createCrmTask({
      title: "Confirm discovery",
      dealId: deal.dealId,
      ownerEmployeeId: owner,
      dueDate: "2026-01-01",
    });
    digest = await buildSalesOsDigest(new Date("2026-09-05T12:00:00Z"));
    expect(digest.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "task",
          ownerEmployeeId: owner,
          dueDate: "2026-01-01",
        }),
      ]),
    );
    expect(digest.attention.some((item) => item.kind === "setup")).toBe(false);
  });
  it("blocks duplicate first touches and revokes approval when copy changes", async () => {
    const contact = await createContact({
      firstName: "Sara",
      email: "sara@cedar.co",
    });
    await updateContact(contact.contactId, { emailVerified: true });
    const deal = await createDeal({
      companyName: "Cedar Studio",
      primaryContactId: contact.contactId,
    });
    const body =
      "Hi Sara, I have an idea for Cedar Studio's next brand campaign. Would a short conversation next week be useful?" +
      buildComplianceFooter({
        unsubscribeUrl: buildUnsubscribeUrl(
          "/api/sales-os/unsubscribe",
          contact.email!,
        ),
      });
    const first = await insertOutreach({
      id: "a",
      dealId: deal.dealId,
      contactId: contact.contactId,
      channel: "email",
      recipient: contact.email!,
      subject: "A campaign idea",
      body,
    });
    const second = await insertOutreach({
      id: "z",
      dealId: deal.dealId,
      contactId: contact.contactId,
      channel: "email",
      recipient: contact.email!,
      subject: "Another idea",
      body,
    });
    expect(await outreachReadiness(first)).toMatchObject({ ready: true });
    expect(await outreachReadiness(second)).toMatchObject({
      ready: false,
      reason: expect.stringContaining("Another first email"),
    });
    await patchOutreach(first.id, {
      state: "approved",
      approvedBy: "reviewer",
    });
    expect(
      await patchOutreach(first.id, { body: body + " Edited." }),
    ).toMatchObject({ state: "draft", approvedBy: null });
  });
  it("reads reply candidates beyond the first page and detects a provider pagination loop", async () => {
    const fetcher = vi.fn(
      async (url: string | URL | Request) =>
        new Response(
          JSON.stringify(
            new URL(String(url)).searchParams.has("pageToken")
              ? { messages: [{ id: "late-reply" }] }
              : { messages: [{ id: "first" }], nextPageToken: "second" },
          ),
        ),
    );
    expect(
      await listMessages(
        "test-token",
        "newer_than:30d",
        fetcher as typeof fetch,
      ),
    ).toHaveLength(2);
    const repeated = vi.fn(
      async () => new Response(JSON.stringify({ nextPageToken: "same" })),
    );
    await expect(
      listMessages("test-token", "query", repeated as typeof fetch),
    ).rejects.toThrow("repeated a pagination token");
  });
  it("runs scheduled proposals once after authorization without promoting CRM records", async () => {
    const runProposals = vi.fn(async () => ({
      pending: false,
      proposed: 3,
      receiptId: "receipt",
    }));
    const recordSignal = vi.fn().mockResolvedValue(undefined);
    const readPolicy = async () => ({
      mode: "scheduled_research" as const,
      allowedScheduledAgents: ["research" as const],
      updatedBy: "00000000-0000-4000-8000-000000000011",
      updatedAt: "2026-09-05T00:00:00Z",
    });
    const deps = { runProposals, recordSignal, readPolicy };
    expect(
      await runLeadgenDailyCron(new Date("2026-09-05T03:00:00Z"), deps),
    ).toMatchObject({ ran: true, created: 3 });
    expect(
      await runLeadgenDailyCron(new Date("2026-09-05T04:00:00Z"), deps),
    ).toMatchObject({ ran: false, skipped: "already_ran" });
    expect(runProposals).toHaveBeenCalledTimes(1);
    expect(recordSignal).toHaveBeenCalledWith(
      "leadgen_daily",
      "info",
      expect.objectContaining({ canonicalCrmWrites: 0, outreachSends: 0 }),
    );
  });
});

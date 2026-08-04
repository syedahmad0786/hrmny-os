import { beforeEach, describe, expect, it } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { getDemoStore } from "../demo-store";
import { createCaller } from "../trpc/root";
import { toCsv } from "./csv";
import { resetCrmMemory } from "./memory";
import {
  createCompany,
  createContact,
  createDeal,
  createNote,
  createCrmTask,
  createActivity,
  dedupeCandidates,
  getCompany,
  getContact,
  getDeal,
  listCrmTasks,
  listNotes,
  listActivities,
  mergeCompanies,
  mergeContacts,
  normalizeDomain,
} from "./repository";

function callerFor(role: string) {
  const user = resolveDevUser(role);
  return createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: sessionCanViewMargin(user),
  });
}

function lastAuditAction(): string | undefined {
  return getDemoStore().audits[0]?.action;
}

describe("CRM core (A1): audit, quotes, merge/dedupe, search, csv", () => {
  beforeEach(() => {
    resetCrmMemory();
  });

  // ── W2 audit completeness ────────────────────────────────

  it("writes audit on companies/contacts/deals/activities/notes/tasks mutations", async () => {
    const caller = callerFor("partner");

    const co = await caller.crm.companies.create({ name: "Audit Co" });
    expect(lastAuditAction()).toBe("crm.companies.create");

    await caller.crm.companies.update({ id: co.companyId, sector: "Media" });
    expect(lastAuditAction()).toBe("crm.companies.update");

    const person = await caller.crm.contacts.create({
      firstName: "Audit",
      email: "audit@example.test",
    });
    expect(lastAuditAction()).toBe("crm.contacts.create");

    await caller.crm.contacts.update({ id: person.contactId, title: "CTO" });
    expect(lastAuditAction()).toBe("crm.contacts.update");

    const deal = await caller.crm.deals.create({ companyName: "Audit Co" });
    expect(lastAuditAction()).toBe("crm.deals.create");

    await caller.crm.deals.update({ id: deal.dealId, sector: "Media" });
    const updateAudit = getDemoStore().audits[0]!;
    expect(updateAudit.action).toBe("crm.deals.update");
    expect(updateAudit.before).toBeTruthy();
    expect(updateAudit.after).toBeTruthy();

    await caller.crm.activities.create({ type: "call", subject: "Audited" });
    expect(lastAuditAction()).toBe("crm.activities.create");

    await caller.crm.notes.create({ body: "Audited note" });
    expect(lastAuditAction()).toBe("crm.notes.create");

    const task = await caller.crm.tasks.create({ title: "Audited task" });
    expect(lastAuditAction()).toBe("crm.tasks.create");

    await caller.crm.tasks.update({ id: task.crmTaskId, status: "done" });
    expect(lastAuditAction()).toBe("crm.tasks.update");
  });

  // ── W3 quotes ────────────────────────────────────────────

  it("saves quote versions with increment + discount tier validation", async () => {
    const caller = callerFor("partner");
    const [deal] = await caller.crm.deals.list();
    const lines = [
      { label: "Film", unitSell: 1000, unitCost: 500, qty: 1 },
    ];

    const v1 = await caller.crm.quotes.save({
      dealId: deal!.dealId,
      lineItems: lines,
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;
    expect(v1.quote.version).toBe(1);
    expect(v1.approvalTier).toBeNull();
    expect(v1.marginBelowFloor).toBe(false);

    const v2 = await caller.crm.quotes.save({
      dealId: deal!.dealId,
      lineItems: lines,
      discountPct: 20,
    });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;
    expect(v2.quote.version).toBe(2);
    expect(v2.approvalTier).toBe("partner");
    expect(v2.escalatedTo).toBeUndefined(); // partner has authority
    expect(lastAuditAction()).toBe("crm.quotes.save");

    const listed = await caller.crm.quotes.listByDeal({ dealId: deal!.dealId });
    expect(listed.map((q) => q.version)).toEqual([2, 1]);
    const fetched = await caller.crm.quotes.get({ id: listed[0]!.quoteId });
    expect(fetched?.quoteId).toBe(listed[0]!.quoteId);
  });

  it("escalates discount beyond actor authority and flags margin floor", async () => {
    const caller = callerFor("am");
    const [deal] = await caller.crm.deals.list();
    const result = await caller.crm.quotes.save({
      dealId: deal!.dealId,
      // 10% margin — below the 25% floor
      lineItems: [{ label: "Low margin", unitSell: 1000, unitCost: 900 }],
      discountPct: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approvalTier).toBe("md");
    expect(result.escalatedTo).toBe("md");
    expect(result.marginBelowFloor).toBe(true);
    // Margin redacted for AM (no margin view)
    expect("internalCost" in result.quote).toBe(false);
    expect("marginPct" in result.quote).toBe(false);
    expect(
      result.quote.lineItems.every((l) => !("unitCost" in l)),
    ).toBe(true);
  });

  // ── W4 dedupe + merge ────────────────────────────────────

  it("finds dedupe candidates by contact email and company domain/name", async () => {
    const a = await createContact({
      firstName: "Dup",
      email: "Dup@Example.test",
    });
    const b = await createContact({
      firstName: "Dup2",
      email: "dup@example.test",
    });
    await createCompany({ name: "Domain Co", website: "https://www.dupco.com/about" });
    await createCompany({ name: "Domain Co Two", website: "http://dupco.com" });
    await createCompany({ name: "Name Match LLC" });
    await createCompany({ name: "name match llc" });

    const candidates = await dedupeCandidates();
    const contactGroup = candidates.contacts.find(
      (g) => g.key === "dup@example.test",
    );
    expect(contactGroup?.contactIds.sort()).toEqual(
      [a.contactId, b.contactId].sort(),
    );
    expect(candidates.companies.some((g) => g.key === "dupco.com")).toBe(true);
    expect(
      candidates.companies.some((g) => g.key === "name match llc"),
    ).toBe(true);
  });

  it("merge contacts re-points deal/activity/note/task FKs and deletes duplicate", async () => {
    const survivor = await createContact({
      firstName: "Keep",
      email: "keep@example.test",
    });
    const dup = await createContact({
      firstName: "Drop",
      email: "keep@example.test",
    });
    const deal = await createDeal({
      companyName: "Merge Co",
      primaryContactId: dup.contactId,
    });
    await createActivity({ type: "call", contactId: dup.contactId });
    await createNote({ body: "on dup", contactId: dup.contactId });
    await createCrmTask({ title: "on dup", contactId: dup.contactId });

    const caller = callerFor("partner");
    const result = await caller.crm.merge.contacts({
      survivorId: survivor.contactId,
      duplicateId: dup.contactId,
    });
    expect(result.ok).toBe(true);
    expect(lastAuditAction()).toBe("crm.merge.contacts");

    expect(await getContact(dup.contactId)).toBeNull();
    expect((await getDeal(deal.dealId))?.primaryContactId).toBe(
      survivor.contactId,
    );
    expect(
      (await listActivities({ contactId: survivor.contactId })).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await listNotes({ contactId: survivor.contactId })).length,
    ).toBe(1);
    expect(
      (await listCrmTasks()).some(
        (t) => t.contactId === survivor.contactId && t.title === "on dup",
      ),
    ).toBe(true);
  });

  it("merge companies re-points contact/deal FKs and deletes duplicate", async () => {
    const survivor = await createCompany({ name: "Keep Co" });
    const dup = await createCompany({ name: "Drop Co" });
    const person = await createContact({
      firstName: "Emp",
      companyId: dup.companyId,
    });
    const deal = await createDeal({
      companyName: "Drop Co",
      companyId: dup.companyId,
    });

    const merged = await mergeCompanies({
      survivorId: survivor.companyId,
      duplicateId: dup.companyId,
    });
    expect(merged.ok).toBe(true);
    expect(await getCompany(dup.companyId)).toBeNull();
    expect((await getContact(person.contactId))?.companyId).toBe(
      survivor.companyId,
    );
    expect((await getDeal(deal.dealId))?.companyId).toBe(survivor.companyId);
  });

  it("rejects merging a record into itself or missing records", async () => {
    const co = await createCompany({ name: "Solo Co" });
    const self = await mergeCompanies({
      survivorId: co.companyId,
      duplicateId: co.companyId,
    });
    expect(self.ok).toBe(false);
    const missing = await mergeContacts({
      survivorId: "00000000-0000-4000-8000-00000000dead",
      duplicateId: "00000000-0000-4000-8000-00000000beef",
    });
    expect(missing.ok).toBe(false);
  });

  // ── W5 omni search ───────────────────────────────────────

  it("omni search returns top matches across entities", async () => {
    const caller = callerFor("partner");
    const result = await caller.crm.search.omni({ q: "marriott" });
    expect(result.companies.some((c) => /Marriott/i.test(c.name))).toBe(true);
    expect(result.deals.some((d) => /Marriott/i.test(d.companyName))).toBe(
      true,
    );
    const contacts = await caller.crm.search.omni({ q: "layla" });
    expect(contacts.contacts.some((c) => c.firstName === "Layla")).toBe(true);
    expect(contacts.companies.length).toBeLessThanOrEqual(10);
  });

  it("omni search redacts deal margin for non-margin roles", async () => {
    const caller = callerFor("am");
    const result = await caller.crm.search.omni({ q: "marriott" });
    expect(result.deals.length).toBeGreaterThan(0);
    expect(result.deals.every((d) => !("marginPct" in d))).toBe(true);
  });

  // ── W6 CSV export / import ───────────────────────────────

  it("escapes commas and quotes in csv cells", () => {
    const csv = toCsv(["a", "b"], [{ a: 'say "hi", ok', b: null }]);
    expect(csv).toBe('a,b\r\n"say ""hi"", ok",');
  });

  it("exports companies/contacts/deals csv with margin redaction", async () => {
    const partner = callerFor("partner");
    const companiesCsv = await partner.crm.export.companies();
    expect(companiesCsv.split("\r\n")[0]).toContain("companyId,name");
    expect(companiesCsv).toContain("JW Marriott Marquis Dubai");

    const contactsCsv = await partner.crm.export.contacts();
    expect(contactsCsv).toContain("layla.hassan@example-jwmm.ae");

    const dealsPartner = await partner.crm.export.deals();
    expect(dealsPartner.split("\r\n")[0]).toContain("marginPct");

    const dealsAm = await callerFor("am").crm.export.deals();
    expect(dealsAm.split("\r\n")[0]).not.toContain("marginPct");
    expect(dealsAm).not.toContain("internalCost");
  });

  it("imports companies/contacts with dedupe and error reporting", async () => {
    const caller = callerFor("partner");
    const companies = await caller.crm.import.companies({
      rows: [
        { name: "Fresh Co", website: "https://freshco.example" },
        { name: "JW Marriott Marquis Dubai" }, // dup by name
        { name: "Marriott Global", website: "www.marriott.com/en" }, // dup by domain
        { sector: "no name" }, // invalid
      ],
    });
    expect(companies.created).toBe(1);
    expect(companies.skipped).toBe(2);
    expect(companies.errors).toHaveLength(1);
    expect(companies.errors[0]!.row).toBe(3);
    expect(lastAuditAction()).toBe("crm.import.companies");

    const contacts = await caller.crm.import.contacts({
      rows: [
        { firstName: "New", email: "new@example.test" },
        { firstName: "Dup", email: "LAYLA.HASSAN@example-jwmm.ae" }, // dup email
        { firstName: "Dup2", email: "new@example.test" }, // dup within batch
        { firstName: "NoEmail" },
        { firstName: "", email: "bad" }, // invalid
      ],
    });
    expect(contacts.created).toBe(2); // New + NoEmail
    expect(contacts.skipped).toBe(2);
    expect(contacts.errors).toHaveLength(1);
  });

  it("carries unitCost forward when a non-margin role re-saves a quote", async () => {
    const partner = callerFor("partner");
    const deal = await partner.crm.deals.create({ companyName: "Cost Co" });
    const v1 = await partner.crm.quotes.save({
      dealId: deal.dealId,
      lineItems: [{ label: "Design", qty: 1, unitSell: 1000, unitCost: 400 }],
    });
    expect(v1.ok).toBe(true);

    const am = callerFor("am");
    const v2 = await am.crm.quotes.save({
      dealId: deal.dealId,
      lineItems: [
        // client echoes redacted cost as 0 — server must restore 400
        { label: "Design", qty: 2, unitSell: 1000, unitCost: 0 },
      ],
    });
    expect(v2.ok).toBe(true);

    const [latest] = await partner.crm.quotes.listByDeal({
      dealId: deal.dealId,
    });
    expect(latest!.version).toBe(2);
    // partner caller → unredacted row
    expect(Number((latest as { internalCost: string }).internalCost)).toBe(
      800,
    ); // 2 × 400, not 0
  });

  it("normalizeDomain strips scheme/www/path", () => {
    expect(normalizeDomain("https://www.Foo.COM/bar?x=1")).toBe("foo.com");
    expect(normalizeDomain("foo.com")).toBe("foo.com");
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

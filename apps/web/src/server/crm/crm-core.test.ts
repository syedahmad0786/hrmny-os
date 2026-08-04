import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveDevUser, sessionCanViewMargin } from "../auth/session";
import { getDemoStore } from "../demo-store";
import {
  insertContactEdge,
  listContactEdges,
  resetLeadgenStore,
} from "../leadgen/store";
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
  createQuoteVersion,
  dedupeCandidates,
  getCompany,
  getContact,
  getDeal,
  listCrmTasks,
  listNotes,
  listActivities,
  listQuotesByDeal,
  mergeCompanies,
  mergeContacts,
  normalizeDomain,
} from "./repository";

// Wrap createCompany in a vi.fn so a single test can inject a one-shot insert
// failure (per-row import guard); all other calls fall through to the real impl.
vi.mock("./repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository")>();
  return { ...actual, createCompany: vi.fn(actual.createCompany) };
});

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
    resetLeadgenStore();
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
    // Partner (margin role) sees the margin oracle.
    const partner = callerFor("partner");
    const [pDeal] = await partner.crm.deals.list();
    const flagged = await partner.crm.quotes.save({
      dealId: pDeal!.dealId,
      // 10% margin — below the 25% floor
      lineItems: [{ label: "Low margin", unitSell: 1000, unitCost: 900 }],
    });
    expect(flagged.ok).toBe(true);
    if (!flagged.ok) return;
    expect(flagged.marginBelowFloor).toBe(true);
    expect(flagged.floorPct).toBeGreaterThan(0);
    expect(flagged.targetPct).toBeGreaterThan(0);

    const caller = callerFor("am");
    const [deal] = await caller.crm.deals.list();
    const result = await caller.crm.quotes.save({
      dealId: deal!.dealId,
      lineItems: [{ label: "Low margin", unitSell: 1000, unitCost: 900 }],
      discountPct: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Escalation fields stay for the AM UX...
    expect(result.approvalTier).toBe("md");
    expect(result.escalatedTo).toBe("md");
    // ...but the margin oracle is omitted for non-margin roles.
    expect("marginBelowFloor" in result).toBe(false);
    expect("floorPct" in result).toBe(false);
    expect("targetPct" in result).toBe(false);
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
    // Audit 'before' carries a full snapshot of the deleted duplicate.
    const audit = getDemoStore().audits[0]!;
    const before = audit.before as {
      duplicate?: { contactId?: string; email?: string | null };
    };
    expect(before.duplicate?.contactId).toBe(dup.contactId);
    expect(before.duplicate?.email).toBe("keep@example.test");

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

  it("merge contacts repoints contact_edges endpoints (no dangling edges)", async () => {
    const survivor = await createContact({ firstName: "Keep" });
    const dup = await createContact({ firstName: "Drop" });
    const other = await createContact({ firstName: "Other" });
    await insertContactEdge({
      fromContact: dup.contactId,
      toContact: other.contactId,
      relation: "knows",
    });
    await insertContactEdge({
      fromContact: other.contactId,
      toContact: dup.contactId,
      relation: "worked_with",
    });

    const result = await mergeContacts({
      survivorId: survivor.contactId,
      duplicateId: dup.contactId,
    });
    expect(result.ok).toBe(true);

    expect(await listContactEdges(dup.contactId)).toHaveLength(0);
    const edges = await listContactEdges(survivor.contactId);
    expect(edges).toHaveLength(2);
    expect(
      edges.every(
        (e) =>
          e.fromContact === survivor.contactId ||
          e.toContact === survivor.contactId,
      ),
    ).toBe(true);
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

  it("neutralizes formula-injection payloads in csv cells", () => {
    const csv = toCsv(
      ["a", "b"],
      [{ a: '=HYPERLINK("http://evil","click")', b: "+971501234567" }],
    );
    expect(csv.split("\r\n")[1]).toBe(
      "\"'=HYPERLINK(\"\"http://evil\"\",\"\"click\"\")\",'+971501234567",
    );
    expect(toCsv(["a"], [{ a: "@cmd" }])).toBe("a\r\n'@cmd");
    expect(toCsv(["a"], [{ a: "safe" }])).toBe("a\r\nsafe");
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

  it("keeps importing remaining rows when a single insert throws", async () => {
    const caller = callerFor("partner");
    vi.mocked(createCompany).mockRejectedValueOnce(new Error("db down"));
    const summary = await caller.crm.import.companies({
      rows: [{ name: "Boom Co" }, { name: "Fine Co" }],
    });
    expect(summary.errors).toEqual([{ row: 0, message: "db down" }]);
    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(await caller.crm.companies.list({ search: "Fine Co" })).toHaveLength(
      1,
    );
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

  it("does not bleed a removed line's cost into a renamed line (label match only)", async () => {
    const partner = callerFor("partner");
    const deal = await partner.crm.deals.create({ companyName: "Rename Co" });
    const v1 = await partner.crm.quotes.save({
      dealId: deal.dealId,
      lineItems: [
        { label: "Design", qty: 1, unitSell: 1000, unitCost: 400 },
        { label: "Build", qty: 1, unitSell: 2000, unitCost: 900 },
      ],
    });
    expect(v1.ok).toBe(true);

    const am = callerFor("am");
    // "Design" removed; new first line must NOT inherit Design's 400 by position.
    const v2 = await am.crm.quotes.save({
      dealId: deal.dealId,
      lineItems: [
        { label: "Voiceover", qty: 1, unitSell: 500, unitCost: 0 },
        { label: "Build", qty: 1, unitSell: 2000, unitCost: 0 },
      ],
    });
    expect(v2.ok).toBe(true);

    const [latest] = await partner.crm.quotes.listByDeal({
      dealId: deal.dealId,
    });
    const costs = Object.fromEntries(
      (latest!.lineItems as { label: string; unitCost: number }[]).map((l) => [
        l.label,
        l.unitCost,
      ]),
    );
    expect(costs["Voiceover"]).toBe(0); // unmatched → keeps client value
    expect(costs["Build"]).toBe(900); // label match → carried forward
  });

  it("allocates distinct quote versions for concurrent saves", async () => {
    const deal = await createDeal({ companyName: "Race Co" });
    const line = { label: "Film", unitSell: 100, unitCost: 50 };
    await Promise.all([
      createQuoteVersion({
        dealId: deal.dealId,
        lineItems: [line],
        quoteValue: "100.00",
        internalCost: "50.00",
        marginPct: "50.00",
      }),
      createQuoteVersion({
        dealId: deal.dealId,
        lineItems: [line],
        quoteValue: "100.00",
        internalCost: "50.00",
        marginPct: "50.00",
      }),
    ]);
    const versions = (await listQuotesByDeal(deal.dealId))
      .map((q) => q.version)
      .sort();
    expect(versions).toEqual([1, 2]);
  });

  it("normalizeDomain strips scheme/www/path", () => {
    expect(normalizeDomain("https://www.Foo.COM/bar?x=1")).toBe("foo.com");
    expect(normalizeDomain("foo.com")).toBe("foo.com");
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain(null)).toBeNull();
  });
});

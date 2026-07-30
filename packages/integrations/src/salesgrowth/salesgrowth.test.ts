import { describe, expect, it } from "vitest";
import { applyImport, reconcile } from "./apply";
import { parseSalesGrowthExport } from "./export";
import { planImport } from "./transform";
import type {
  CrmActivityWrite,
  CrmCompanyWrite,
  CrmContactWrite,
  CrmDealWrite,
  CrmWriter,
  ExistingCrm,
  ImportLineageRow,
  SalesGrowthExport,
} from "./types";

// ── Planted fixture: a small JSON export exercising every code path ──────────
// Cross-links mirror the real db: intel_companies.pipeline_company_id,
// intel_people.pipeline_contact_id are authoritative merges into pipeline rows.
const FIXTURE: SalesGrowthExport = parseSalesGrowthExport({
  companies: [
    { id: 1, company: "Acme LLC", sector: "Retail", why_this: "good fit", evidence: "site", lead_source: "Cold Outbound", stage: "Researched" },
    { id: 2, company: "Beta Foods", sector: "F&B", why_this: null, evidence: null, lead_source: "Inbound", stage: "Researched" },
  ],
  contacts: [
    { id: 10, company_id: 1, company: "Acme LLC", contact_name: "Jane Doe", title: "CMO", email: "jane@acme.com", linkedin_url: "https://lnkd.in/jane", person_id: null },
    { id: 11, company_id: 2, company: "Beta Foods", contact_name: "Bob", title: null, email: "bob@beta.com", linkedin_url: null, person_id: null },
  ],
  intel_companies: [
    { id: 100, canonical_name: "Acme", sector: "Retail", hq_country: "UAE", uae_presence: "office", website: "https://acme.com", linkedin_url: null, notes: "key account", pipeline_company_id: 1 },
    { id: 101, canonical_name: "Gamma Group", sector: "Tech", hq_country: "Saudi Arabia", uae_presence: "none", website: "https://gamma.io", linkedin_url: null, notes: null, pipeline_company_id: null },
  ],
  intel_people: [
    { id: 200, full_name: "Jane Doe", first_name: "Jane", last_name: "Doe", email: "jane@acme.com", linkedin_url: null, phone: "+9715000", notes: null, pipeline_contact_id: 10 },
    { id: 201, full_name: "Carol Ng", first_name: "Carol", last_name: "Ng", email: "carol@gamma.io", linkedin_url: null, phone: null, notes: null, pipeline_contact_id: null },
  ],
  intel_deals: [
    { id: 300, company_id: 100, deal_name: "Acme Retainer 2026", year: 2026, outcome: "won", value_aed: 120000, lead_source: "Existing Client", loss_reason: null, key_contact_id: 200 },
    { id: 301, company_id: 101, deal_name: "Gamma Pitch", year: 2026, outcome: "lost", value_aed: 50000, lead_source: "Cold Outbound", loss_reason: "budget", key_contact_id: null },
  ],
  outreach: [
    { id: 400, contact_id: 10, company: "Acme LLC", contact_name: "Jane Doe", channel: "email", subject: "Hi Jane", body: "Let's talk", stage: "Sent", date_sent: "2026-05-01", created_at: "2026-05-01" },
    { id: 401, contact_id: 11, company: "Beta Foods", contact_name: "Bob", channel: "li_connection", subject: null, body: "connect", stage: "Sent", date_sent: null, created_at: "2026-05-02" },
  ],
  intel_signals: [
    { id: 500, company_id: 100, person_id: 200, signal_type: "research", source: "daily-research", signal_date: "2026-04-01", summary: "Researched Acme", evidence_url: "http://x", created_at: "2026-04-01" },
  ],
});

// Existing CRM: Beta Foods (by name) and bob@beta.com (by email) already exist.
const EXISTING: ExistingCrm = {
  companies: [{ companyId: "exist-beta", name: "Beta Foods", website: null }],
  contacts: [{ contactId: "exist-bob", email: "bob@beta.com" }],
  imported: new Map(),
};

class MemoryWriter implements CrmWriter {
  companies: (CrmCompanyWrite & { id: string })[] = [];
  contacts: (CrmContactWrite & { id: string })[] = [];
  deals: (CrmDealWrite & { id: string })[] = [];
  activities: (CrmActivityWrite & { id: string })[] = [];
  lineage: ImportLineageRow[] = [];
  private n = 0;
  private id(p: string) {
    return `${p}-${++this.n}`;
  }
  async createCompany(i: CrmCompanyWrite) {
    const id = this.id("co");
    this.companies.push({ ...i, id });
    return id;
  }
  async createContact(i: CrmContactWrite) {
    const id = this.id("ct");
    this.contacts.push({ ...i, id });
    return id;
  }
  async createDeal(i: CrmDealWrite) {
    const id = this.id("dl");
    this.deals.push({ ...i, id });
    return id;
  }
  async createActivity(i: CrmActivityWrite) {
    const id = this.id("ac");
    this.activities.push({ ...i, id });
    return id;
  }
  async recordLineage(rows: ImportLineageRow[]) {
    this.lineage.push(...rows);
  }
}

describe("planImport — field mapping", () => {
  const plan = planImport(FIXTURE, EXISTING);

  it("splits contact_name into first/last", () => {
    const jane = plan.contacts.find((r) => r.sourceId === "10")!;
    expect(jane.input).toMatchObject({ firstName: "Jane", lastName: "Doe", title: "CMO" });
  });

  it("maps deal outcome → stage + closeOutcome and value → quoteValue", () => {
    const won = plan.deals.find((r) => r.sourceId === "300")!.input!;
    expect(won).toMatchObject({ stage: "close", closeOutcome: "won", quoteValue: "120000" });
    const lost = plan.deals.find((r) => r.sourceId === "301")!.input!;
    expect(lost).toMatchObject({ stage: "close", closeOutcome: "lost", lostReason: "budget" });
  });

  it("buckets free-text lead_source into a canonical lane", () => {
    expect(plan.deals.find((r) => r.sourceId === "300")!.input!.leadSourceLane).toBe("relationship_led");
    expect(plan.deals.find((r) => r.sourceId === "301")!.input!.leadSourceLane).toBe("apollo_intent");
  });

  it("maps outreach channel → activity type", () => {
    expect(plan.activities.find((r) => r.sourceId === "400")!.input!.type).toBe("email");
    expect(plan.activities.find((r) => r.sourceId === "401")!.input!.type).toBe("outreach");
    expect(plan.activities.find((r) => r.sourceId === "500")!.input!.type).toBe("note");
  });

  it("derives market from hq_country/uae_presence", () => {
    const gamma = plan.companies.find((r) => r.sourceId === "101")!.input!;
    expect(gamma.market).toBe("KSA");
  });
});

describe("planImport — dedupe & merge", () => {
  const plan = planImport(FIXTURE, EXISTING);

  it("merges intel_company into its pipeline company via pipeline_company_id", () => {
    const row = plan.companies.find((r) => r.sourceTable === "intel_companies" && r.sourceId === "100")!;
    expect(row.action).toBe("skip");
    expect(row.skipReason).toBe("merged_in_batch");
    expect(row.resolvesTo).toBe("companies#1");
  });

  it("matches an existing company by normalized name", () => {
    const row = plan.companies.find((r) => r.sourceId === "2")!;
    expect(row.action).toBe("skip");
    expect(row.skipReason).toBe("matched_existing");
    expect(row.resolvesTo).toBe("existing:exist-beta");
  });

  it("merges intel_person via pipeline_contact_id and matches existing contact by email", () => {
    const merged = plan.contacts.find((r) => r.sourceTable === "intel_people" && r.sourceId === "200")!;
    expect(merged.skipReason).toBe("merged_in_batch");
    expect(merged.resolvesTo).toBe("contacts#10");
    const existing = plan.contacts.find((r) => r.sourceId === "11")!;
    expect(existing.skipReason).toBe("matched_existing");
  });
});

describe("reconcile — counts", () => {
  it("computes source/imported/skipped per entity and totals", () => {
    const report = reconcile(planImport(FIXTURE, EXISTING));
    const totals = report.totals;
    // 4 company + 4 contact + 2 deal + 3 activity source rows = 13.
    expect(totals.source).toBe(13);
    expect(totals.imported).toBe(9);
    expect(totals.skipped).toBe(4);

    const companyIntel = report.entities.find(
      (e) => e.sourceTable === "intel_companies",
    )!;
    expect(companyIntel.skipReasons.merged_in_batch).toBe(1);
    expect(companyIntel.imported).toBe(1);
  });
});

describe("applyImport — writes, FK resolution, lineage", () => {
  it("creates rows with FKs resolved through merges", async () => {
    const w = new MemoryWriter();
    const { report, lineage } = await applyImport(planImport(FIXTURE, EXISTING), w);

    expect(w.companies).toHaveLength(2); // Acme (create), Gamma (create)
    expect(w.contacts).toHaveLength(2); // Jane, Carol
    expect(w.deals).toHaveLength(2);
    expect(w.activities).toHaveLength(3);

    const acme = w.companies.find((c) => c.name === "Acme LLC")!;
    const jane = w.contacts.find((c) => c.firstName === "Jane")!;
    expect(jane.companyId).toBe(acme.id);

    // deal#300's company FK pointed at intel_company#100, which merged into Acme.
    const retainer = w.deals.find((d) => d.companyName === "Acme")!;
    expect(retainer.companyId).toBe(acme.id);
    // primary contact FK pointed at intel_person#200, merged into Jane.
    expect(retainer.primaryContactId).toBe(jane.id);

    // outreach#401's contact FK resolves to the pre-existing Bob.
    const liConnect = w.activities.find((a) => a.type === "outreach")!;
    expect(liConnect.contactId).toBe("exist-bob");

    // Exactly one lineage row per source row (13).
    expect(lineage).toHaveLength(13);
    expect(report.totals.imported).toBe(9);
  });

  it("is idempotent on re-run (already_imported skips, no new writes)", async () => {
    const first = new MemoryWriter();
    const { lineage } = await applyImport(planImport(FIXTURE, EXISTING), first);

    // Feed prior lineage back as the imported map.
    const imported = new Map(lineage.map((l) => [`${l.sourceTable}#${l.sourceId}`, l.targetId]));
    const existing2: ExistingCrm = { ...EXISTING, imported };

    const second = new MemoryWriter();
    const { report } = await applyImport(
      planImport(FIXTURE, existing2),
      second,
      imported,
    );

    expect(second.companies).toHaveLength(0);
    expect(second.contacts).toHaveLength(0);
    expect(second.deals).toHaveLength(0);
    expect(second.activities).toHaveLength(0);
    expect(report.totals.imported).toBe(0);
    expect(report.totals.skipped).toBe(13);
  });
});

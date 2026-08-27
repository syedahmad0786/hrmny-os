import { createCompany, listCompanies } from "../crm/repository";
import { qualifyCompany } from "./qualify";
import { sectorForDate, type SalesOsSettings } from "./sops";
import {
  getSalesOsSettings,
  insertCompanyResearch,
  insertIntelSignal,
  listCompanyResearch,
} from "./store";
import type { CompanyResearchRow } from "./types";

type ResearchCandidate = {
  name: string;
  sector: string;
  website?: string;
  whyThis: string;
  evidence?: string;
  estimatedValueAed?: number;
  suggestedServices?: string;
  employeesGlobal?: number;
  employeesMena?: number;
};

/** Deterministic catalog so Hunt works without a scrape/search API. */
export const RESEARCH_CATALOG: Record<string, ResearchCandidate[]> = {
  retail: [
    {
      name: "On Running",
      sector: "Retail + Consumer Experience",
      website: "https://www.on.com",
      whyThis: "Opening a Dubai Mall flagship; hiring marketing support for UAE launch.",
      evidence: "https://example.com/on-running-dubai",
      estimatedValueAed: 420000,
      suggestedServices: "Campaigns + retail experience",
      employeesGlobal: 2000,
      employeesMena: 40,
    },
    {
      name: "Seddiqi Holding",
      sector: "Retail + Consumer Experience",
      website: "https://www.seddiqi.com",
      whyThis: "Ramadan campaign planning across jewellery houses.",
      evidence: "https://example.com/seddiqi-ramadan",
      estimatedValueAed: 380000,
      suggestedServices: "SMM + PR + campaigns",
      employeesGlobal: 800,
      employeesMena: 400,
    },
    {
      name: "Sephora MENA",
      sector: "Retail + Consumer Experience",
      website: "https://www.sephora.ae",
      whyThis: "New beauty hall openings and always-on content need.",
      estimatedValueAed: 300000,
      suggestedServices: "SMM + activations",
      employeesGlobal: 5000,
      employeesMena: 200,
    },
  ],
  sports: [
    {
      name: "Lululemon MENA",
      sector: "Sports / Wellness / Movements",
      website: "https://www.lululemon.com",
      whyThis: "Community run series and Dubai store growth.",
      estimatedValueAed: 280000,
      suggestedServices: "Movements + SMM",
      employeesGlobal: 30000,
      employeesMena: 80,
    },
    {
      name: "Equinox Dubai",
      sector: "Sports / Wellness / Movements",
      whyThis: "Club opening communications and member acquisition.",
      estimatedValueAed: 220000,
      suggestedServices: "PR + branding",
      employeesGlobal: 8000,
      employeesMena: 60,
    },
  ],
  automotive: [
    {
      name: "Lucid Motors",
      sector: "Automotive",
      website: "https://www.lucidmotors.com",
      whyThis: "Hiring Head of Marketing MENA; UAE launch creative support.",
      evidence: "https://example.com/lucid-mena-hire",
      estimatedValueAed: 650000,
      suggestedServices: "Brand + campaigns",
      employeesGlobal: 7000,
      employeesMena: 120,
    },
    {
      name: "Polestar",
      sector: "Automotive",
      whyThis: "EV brand expanding GCC retail and brand experience.",
      estimatedValueAed: 400000,
      suggestedServices: "Campaigns + activations",
      employeesGlobal: 2500,
      employeesMena: 30,
    },
  ],
  signals: [
    {
      name: "Mubadala Investment spill-brand",
      sector: "Signals",
      whyThis: "Portfolio brand seeking agency of record for 2026 calendar.",
      estimatedValueAed: 500000,
      suggestedServices: "AOR / bundled SMM+PR",
      employeesGlobal: 2000,
      employeesMena: 200,
    },
  ],
};

export function catalogForSector(sector: string): ResearchCandidate[] {
  if (sector === "review") return [];
  return RESEARCH_CATALOG[sector] ?? RESEARCH_CATALOG.signals ?? [];
}

export async function runDailyResearch(input?: {
  sector?: string;
  date?: Date;
  settings?: SalesOsSettings;
}): Promise<{
  sector: string;
  created: CompanyResearchRow[];
  skipped: { name: string; reason: string }[];
}> {
  const settings = input?.settings ?? (await getSalesOsSettings());
  const date = input?.date ?? new Date();
  const sector = input?.sector ?? sectorForDate(settings, date);
  const existingResearch = await listCompanyResearch();
  const existingCompanies = await listCompanies();
  const known = new Set(
    [
      ...existingResearch.map((r) => r.name.toLowerCase()),
      ...existingCompanies.map((c) => c.name.toLowerCase()),
    ],
  );
  const created: CompanyResearchRow[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const budget = settings.caps.companiesPerResearchRun;

  for (const cand of catalogForSector(sector)) {
    if (created.length >= budget) break;
    if (known.has(cand.name.toLowerCase())) {
      skipped.push({ name: cand.name, reason: "duplicate" });
      continue;
    }
    const verdict = qualifyCompany(
      {
        name: cand.name,
        sector: cand.sector,
        whyThis: cand.whyThis,
        employeesGlobal: cand.employeesGlobal,
        employeesMena: cand.employeesMena,
      },
      settings,
    );
    if (!verdict.ok) {
      skipped.push({ name: cand.name, reason: `${verdict.reason}:${verdict.detail}` });
      continue;
    }
    if (verdict.rejectCold) {
      skipped.push({ name: cand.name, reason: "cold" });
      continue;
    }
    const company = await createCompany({
      name: cand.name,
      sector: cand.sector,
      market: "UAE",
      website: cand.website ?? null,
      notes: cand.whyThis,
    });
    const row = await insertCompanyResearch({
      companyId: company.companyId,
      name: cand.name,
      sector: cand.sector,
      market: "UAE",
      website: cand.website ?? null,
      whyThis: cand.whyThis,
      evidence: cand.evidence ?? null,
      leadSourceLane: sector === "signals" ? "industry_scanning" : "industry_scanning",
      estimatedValueAed: cand.estimatedValueAed ?? null,
      suggestedServices: cand.suggestedServices ?? null,
      buafBudget: verdict.buaf.budget,
      buafUrgency: verdict.buaf.urgency,
      buafAccess: verdict.buaf.access,
      buafFit: verdict.buaf.fit,
      buafTotal: verdict.buaf.total,
      temperature: verdict.buaf.temperature,
      approvalState: "researched",
      reworkFeedback: null,
      decidedBy: null,
      decidedAt: null,
    });
    await insertIntelSignal({
      companyId: company.companyId,
      contactId: null,
      signalType: "research",
      source: `daily-research:${sector}`,
      signalDate: date.toISOString().slice(0, 10),
      summary: cand.whyThis,
      evidenceUrl: cand.evidence ?? null,
    });
    known.add(cand.name.toLowerCase());
    created.push(row);
  }

  return { sector, created, skipped };
}

export async function ingestManualResearch(input: {
  name: string;
  sector?: string;
  whyThis: string;
  website?: string;
  evidence?: string;
  estimatedValueAed?: number;
  suggestedServices?: string;
  employeesGlobal?: number;
  employeesMena?: number;
  leadSourceLane?: string;
}): Promise<CompanyResearchRow> {
  const settings = await getSalesOsSettings();
  const verdict = qualifyCompany(
    {
      name: input.name,
      sector: input.sector,
      whyThis: input.whyThis,
      employeesGlobal: input.employeesGlobal,
      employeesMena: input.employeesMena,
    },
    settings,
  );
  if (!verdict.ok) {
    throw new Error(`Research rejected: ${verdict.reason} — ${verdict.detail}`);
  }
  const company = await createCompany({
    name: input.name,
    sector: input.sector ?? null,
    market: "UAE",
    website: input.website ?? null,
    notes: input.whyThis,
  });
  return insertCompanyResearch({
    companyId: company.companyId,
    name: input.name,
    sector: input.sector ?? null,
    market: "UAE",
    website: input.website ?? null,
    whyThis: input.whyThis,
    evidence: input.evidence ?? null,
    leadSourceLane: input.leadSourceLane ?? "industry_scanning",
    estimatedValueAed: input.estimatedValueAed ?? null,
    suggestedServices: input.suggestedServices ?? null,
    buafBudget: verdict.buaf.budget,
    buafUrgency: verdict.buaf.urgency,
    buafAccess: verdict.buaf.access,
    buafFit: verdict.buaf.fit,
    buafTotal: verdict.buaf.total,
    temperature: verdict.buaf.temperature,
    approvalState: "researched",
    reworkFeedback: null,
    decidedBy: null,
    decidedAt: null,
  });
}

import { qualifyCompany } from "./qualify";
import { ingestManualResearch } from "./research";
import { getSalesOsSettings } from "./store";
import type { CompanyResearchRow } from "./types";

export type IntentCsvRow = {
  company: string;
  domain?: string;
  sector?: string;
  intent?: string;
  employees?: number;
};

export function parseIntentCsv(text: string): IntentCsvRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.toLowerCase());
  const idx = (aliases: string[]) =>
    header.findIndex((h) => aliases.some((a) => h.includes(a)));
  const companyIdx = idx(["company", "name", "account"]);
  const domainIdx = idx(["domain", "website"]);
  const sectorIdx = idx(["sector", "industry"]);
  const intentIdx = idx(["intent", "topic", "signal"]);
  const empIdx = idx(["employee", "headcount", "size"]);
  const start = companyIdx >= 0 ? 1 : 0;
  const rows: IntentCsvRow[] = [];
  for (const line of lines.slice(start)) {
    const cols = splitCsvLine(line);
    const company = (companyIdx >= 0 ? cols[companyIdx] : cols[0])?.trim();
    if (!company) continue;
    rows.push({
      company,
      domain: domainIdx >= 0 ? cols[domainIdx] : undefined,
      sector: sectorIdx >= 0 ? cols[sectorIdx] : undefined,
      intent: intentIdx >= 0 ? cols[intentIdx] : undefined,
      employees: empIdx >= 0 && cols[empIdx] ? Number(cols[empIdx]) : undefined,
    });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export async function processIntentLeads(csvText: string): Promise<{
  created: CompanyResearchRow[];
  skipped: { company: string; reason: string }[];
}> {
  const settings = await getSalesOsSettings();
  const created: CompanyResearchRow[] = [];
  const skipped: { company: string; reason: string }[] = [];
  for (const row of parseIntentCsv(csvText)) {
    const why = row.intent
      ? `Apollo intent signal: ${row.intent}`
      : "Apollo intent export — company showing marketing-services intent in UAE.";
    const verdict = qualifyCompany(
      {
        name: row.company,
        sector: row.sector,
        whyThis: why,
        employeesGlobal: row.employees ?? null,
      },
      settings,
    );
    if (!verdict.ok || verdict.rejectCold) {
      skipped.push({
        company: row.company,
        reason: !verdict.ok ? `${verdict.reason}:${verdict.detail}` : "cold",
      });
      continue;
    }
    try {
      created.push(
        await ingestManualResearch({
          name: row.company,
          sector: row.sector,
          whyThis: why,
          website: row.domain ? `https://${row.domain.replace(/^https?:\/\//, "")}` : undefined,
          employeesGlobal: row.employees,
          leadSourceLane: "apollo_intent",
        }),
      );
    } catch (err) {
      skipped.push({
        company: row.company,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, skipped };
}

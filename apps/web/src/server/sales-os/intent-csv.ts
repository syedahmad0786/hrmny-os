import { createHash } from "node:crypto";
import { qualifyCompany } from "./qualify";
import { ingestManualResearch } from "./research";
import { ResearchEvidenceError } from "./research-evidence";
import { getSalesOsSettings } from "./store";
import type { CompanyResearchRow } from "./types";

export type IntentCsvRow = {
  company: string;
  domain?: string;
  sector?: string;
  intent?: string;
  evidence?: string;
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
  const evidenceIdx = idx(["evidence", "source_url", "source url"]);
  const empIdx = idx(["employee", "headcount", "size"]);
  const start = companyIdx >= 0 ? 1 : 0;
  const rows: IntentCsvRow[] = [];
  for (const line of lines.slice(start)) {
    const cols = splitCsvLine(line);
    const company = (companyIdx >= 0 ? cols[companyIdx] : cols[0])?.trim();
    if (!company) continue;
    const employeesRaw =
      empIdx >= 0 && cols[empIdx] ? Number(cols[empIdx]) : undefined;
    rows.push({
      company,
      domain: domainIdx >= 0 ? cols[domainIdx] : undefined,
      sector: sectorIdx >= 0 ? cols[sectorIdx] : undefined,
      intent: intentIdx >= 0 ? cols[intentIdx] : undefined,
      evidence: evidenceIdx >= 0 ? cols[evidenceIdx] : undefined,
      employees:
        employeesRaw !== undefined && Number.isFinite(employeesRaw)
          ? employeesRaw
          : undefined,
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

export async function processIntentLeads(
  csvText: string,
  options: { actorEmployeeId?: string | null } = {},
): Promise<{
  created: CompanyResearchRow[];
  skipped: { company: string; reason: string }[];
}> {
  const settings = await getSalesOsSettings();
  const created: CompanyResearchRow[] = [];
  const skipped: { company: string; reason: string }[] = [];
  const batchId = createHash("sha256")
    .update(`${options.actorEmployeeId ?? "system"}\n${csvText.trim()}`)
    .digest("hex");
  const rows = parseIntentCsv(csvText);
  for (const [index, row] of rows.entries()) {
    if (!row.evidence?.trim()) {
      skipped.push({ company: row.company, reason: "missing_evidence" });
      continue;
    }
    const why = row.intent
      ? `Company-level intent reported in imported export: ${row.intent}. Verify topic and observation date; this does not establish an individual's intent.`
      : "Imported company without a specified intent topic. Buying intent is unverified.";
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
      const result = await ingestManualResearch({
        requestId: `${batchId}:${index}`,
        actorEmployeeId: options.actorEmployeeId,
        name: row.company,
        sector: row.sector,
        whyThis: why,
        website: row.domain
          ? `https://${row.domain.replace(/^https?:\/\//, "")}`
          : undefined,
        evidence: row.evidence,
        employeesGlobal: row.employees,
        leadSourceLane: "apollo_intent",
      });
      created.push(result.proposal);
    } catch (err) {
      if (!(err instanceof ResearchEvidenceError)) throw err;
      skipped.push({
        company: row.company,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { created, skipped };
}

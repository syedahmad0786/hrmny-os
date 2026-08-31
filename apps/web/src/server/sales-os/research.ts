import { createHash } from "node:crypto";
import { qualifyCompany } from "./qualify";
import { normalizeResearchEvidence } from "./research-evidence";
import {
  getSalesOsSettings,
  insertResearchProposalWithSignal,
  type ResearchProposalReceipt,
} from "./store";

export type ResearchProposalInput = {
  requestId: string;
  actorEmployeeId?: string | null;
  name: string;
  sector?: string;
  whyThis: string;
  website?: string;
  evidence: string;
  estimatedValueAed?: number;
  suggestedServices?: string;
  employeesGlobal?: number;
  employeesMena?: number;
  leadSourceLane?: string;
};

/**
 * Store an evidence-bearing research proposal and immutable signal reference.
 * This is intentionally proposal-only: no canonical CRM company, contact, or
 * deal is created until a person approves Gate 1 (and later Gate 2).
 * Replaying the same company/source pair returns the existing proposal.
 */
export async function ingestManualResearch(
  input: ResearchProposalInput,
): Promise<ResearchProposalReceipt> {
  const requestId = input.requestId.trim();
  if (requestId.length < 8 || requestId.length > 180) {
    throw new Error("Research proposal request ID must be 8-180 characters");
  }
  const evidence = normalizeResearchEvidence(input.evidence);
  const name = input.name.trim();
  const whyThis = input.whyThis.trim();
  const settings = await getSalesOsSettings();
  const verdict = qualifyCompany(
    {
      name,
      sector: input.sector,
      whyThis,
      employeesGlobal: input.employeesGlobal,
      employeesMena: input.employeesMena,
    },
    settings,
  );
  if (!verdict.ok) {
    throw new Error(`Research rejected: ${verdict.reason} — ${verdict.detail}`);
  }

  const leadSourceLane = input.leadSourceLane?.trim() || "industry_scanning";
  const sector = input.sector?.trim() || null;
  const website = input.website?.trim() || null;
  const suggestedServices = input.suggestedServices?.trim() || null;
  const canonicalPayload = JSON.stringify({
    actorEmployeeId: input.actorEmployeeId ?? null,
    name,
    sector,
    whyThis,
    website,
    evidence,
    estimatedValueAed: input.estimatedValueAed ?? null,
    suggestedServices,
    employeesGlobal: input.employeesGlobal ?? null,
    employeesMena: input.employeesMena ?? null,
    leadSourceLane,
  });

  return insertResearchProposalWithSignal({
    requestId,
    payloadHash: createHash("sha256").update(canonicalPayload).digest("hex"),
    actorEmployeeId: input.actorEmployeeId,
    proposal: {
      companyId: null,
      name,
      sector,
      market: "UAE",
      website,
      whyThis,
      evidence,
      leadSourceLane,
      estimatedValueAed: input.estimatedValueAed ?? null,
      suggestedServices,
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
    },
    signal: {
      companyId: null,
      contactId: null,
      signalType: "research_proposal",
      source: `research-proposal:${leadSourceLane}`,
      signalDate: new Date().toISOString().slice(0, 10),
      summary: `${name}: ${whyThis}`,
      evidenceUrl: evidence,
    },
  });
}

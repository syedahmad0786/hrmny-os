import {
  createLeadSourceLive,
  type LeadSourceAdapter,
} from "@hrmny/integrations";
import { listCompanies, listContacts } from "../crm/repository";
import { resolveIntegrationApiKey } from "../integrations/resolve-keys";
import { contactsForTemperature } from "./sops";
import { isSuppressed } from "./store";
import {
  getCompanyResearch,
  getSalesOsSettings,
  insertContactResearch,
  listContactResearch,
  patchCompanyResearch,
} from "./store";
import type { ContactResearchRow } from "./types";

export type EnrichDeps = {
  leadSource?: LeadSourceAdapter;
  allowSynthetic?: boolean;
  actorEmployeeId?: string | null;
  resolveApiKey?: typeof resolveIntegrationApiKey;
};

export function strongerDedupeKey(input: {
  email?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  fullName?: string | null;
}): string[] {
  const keys: string[] = [];
  if (input.email?.trim())
    keys.push(`email:${input.email.trim().toLowerCase()}`);
  if (input.linkedinUrl?.trim()) {
    keys.push(
      `li:${input.linkedinUrl
        .trim()
        .toLowerCase()
        .replace(/\/$/, "")
        .replace(/^https?:\/\/(www\.)?/, "")}`,
    );
  }
  if (input.companyName && input.fullName) {
    keys.push(
      `name:${input.companyName.trim().toLowerCase()}|${input.fullName.trim().toLowerCase()}`,
    );
  }
  return keys;
}

export async function existingDedupeKeys(): Promise<Set<string>> {
  const [contacts, companies, researched] = await Promise.all([
    listContacts(),
    listCompanies(),
    listContactResearch(),
  ]);
  const companyName = new Map(companies.map((c) => [c.companyId, c.name]));
  const keys = new Set<string>();
  for (const c of contacts) {
    for (const k of strongerDedupeKey({
      email: c.email,
      linkedinUrl: c.linkedinUrl,
      companyName: c.companyId ? companyName.get(c.companyId) : null,
      fullName: `${c.firstName} ${c.lastName ?? ""}`.trim(),
    })) {
      keys.add(k);
    }
  }
  for (const c of researched) {
    for (const k of strongerDedupeKey({
      email: c.email,
      linkedinUrl: c.linkedinUrl,
      fullName: c.fullName,
    })) {
      keys.add(k);
    }
  }
  return keys;
}

export async function enrichApprovedCompany(
  companyResearchId: string,
  deps: EnrichDeps = {},
): Promise<{
  created: ContactResearchRow[];
  skipped: string[];
  creditsUsed: number;
}> {
  const company = await getCompanyResearch(companyResearchId);
  if (!company) throw new Error("Company research not found");
  if (company.approvalState !== "approved") {
    throw new Error("Gate 1 must approve the company before enrichment");
  }
  const settings = await getSalesOsSettings();
  const maxContacts = contactsForTemperature(company.temperature);
  if (maxContacts === 0) {
    return {
      created: [],
      skipped: ["cool_or_cold_no_credits"],
      creditsUsed: 0,
    };
  }
  let leadSource = deps.leadSource;
  if (!leadSource) {
    const resolver = deps.resolveApiKey ?? resolveIntegrationApiKey;
    const { apiKey } = await resolver("apollo", deps.actorEmployeeId);
    if (!apiKey) throw new Error("APOLLO_FREE_SEARCH_CONNECTION_REQUIRED");
    leadSource = createLeadSourceLive({
      mode: "live",
      apiKey,
      allowPaidOperations: false,
    });
  }
  if (leadSource.mode !== "live" && deps.allowSynthetic !== true) {
    throw new Error("SYNTHETIC_CONTACT_DISCOVERY_FORBIDDEN");
  }
  const candidates = await leadSource.searchLeads({
    query: `${company.name} ${company.sector ?? ""} UAE`,
    titles: settings.stakeholderTitles,
    locations: ["United Arab Emirates"],
    perPage: maxContacts,
  });

  const known = await existingDedupeKeys();
  const created: ContactResearchRow[] = [];
  const skipped: string[] = [];
  for (const cand of candidates) {
    if (created.length >= maxContacts) break;
    const keys = strongerDedupeKey({
      email: cand.email,
      linkedinUrl: cand.linkedinUrl,
      companyName: company.name,
      fullName: cand.fullName,
    });
    if (keys.some((k) => known.has(k))) {
      skipped.push(`${cand.fullName ?? cand.externalId}:duplicate`);
      continue;
    }
    if (cand.email) {
      const suppressed = await isSuppressed({ email: cand.email });
      if (suppressed) {
        skipped.push(`${cand.email}:suppressed`);
        continue;
      }
    }
    const verified = new Set(["verified", "valid"]).has(
      cand.emailStatus?.trim().toLowerCase() ?? "",
    );
    const row = await insertContactResearch({
      companyResearchId: company.id,
      companyId: company.companyId,
      contactId: null,
      dealId: null,
      fullName: cand.fullName ?? "Unknown",
      title: cand.title ?? null,
      seniority: cand.title ?? null,
      email: cand.email ?? null,
      linkedinUrl: cand.linkedinUrl ?? null,
      emailVerified: verified,
      emailVerdict: cand.emailStatus ?? (cand.email ? "unknown" : null),
      enrichSource: cand.source,
      enrichExternalId: cand.externalId,
      enrichProvider: "apollo_search",
      approvalState: "found",
      reworkFeedback: null,
    });
    for (const k of keys) known.add(k);
    created.push(row);
  }

  await patchCompanyResearch(company.id, {});
  return { created, skipped, creditsUsed: 0 };
}

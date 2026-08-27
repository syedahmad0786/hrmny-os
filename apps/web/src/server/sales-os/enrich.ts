import type { EmailVerificationAdapter, LeadSourceAdapter } from "@hrmny/integrations";
import {
  createEmailVerificationAdapter,
  createLeadSourceAdapter,
} from "@hrmny/integrations";
import { listCompanies, listContacts } from "../crm/repository";
import { contactsForTemperature } from "./sops";
import { isSuppressed } from "./store";
import {
  addCredit,
  creditUsed,
  getCompanyResearch,
  getSalesOsSettings,
  insertContactResearch,
  listContactResearch,
  patchCompanyResearch,
} from "./store";
import type { ContactResearchRow } from "./types";

export type EnrichDeps = {
  leadSource?: LeadSourceAdapter;
  verifier?: EmailVerificationAdapter;
};

export function strongerDedupeKey(input: {
  email?: string | null;
  linkedinUrl?: string | null;
  companyName?: string | null;
  fullName?: string | null;
}): string[] {
  const keys: string[] = [];
  if (input.email?.trim()) keys.push(`email:${input.email.trim().toLowerCase()}`);
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
): Promise<{ created: ContactResearchRow[]; skipped: string[]; creditsUsed: number }> {
  const company = await getCompanyResearch(companyResearchId);
  if (!company) throw new Error("Company research not found");
  if (company.approvalState !== "approved") {
    throw new Error("Gate 1 must approve the company before enrichment");
  }
  const settings = await getSalesOsSettings();
  const maxContacts = contactsForTemperature(company.temperature);
  if (maxContacts === 0) {
    return { created: [], skipped: ["cool_or_cold_no_credits"], creditsUsed: 0 };
  }
  const used = await creditUsed("apollo_contact");
  const remaining = Math.max(0, settings.caps.apolloContactsPerMonth - used);
  if (remaining <= 0) {
    return { created: [], skipped: ["apollo_monthly_cap"], creditsUsed: 0 };
  }

  const leadSource = deps.leadSource ?? createLeadSourceAdapter();
  const verifier = deps.verifier ?? createEmailVerificationAdapter();
  const candidates = await leadSource.searchLeads({
    query: `${company.name} ${company.sector ?? ""} UAE`,
    titles: settings.stakeholderTitles,
    locations: ["United Arab Emirates"],
    perPage: Math.min(maxContacts, remaining),
  });

  const known = await existingDedupeKeys();
  const created: ContactResearchRow[] = [];
  const skipped: string[] = [];
  let credits = 0;

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
    const verification = cand.email ? await verifier.verify(cand.email) : null;
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
      emailVerified: verification?.emailVerified ?? false,
      emailVerdict: verification?.verdict ?? (cand.email ? "unknown" : null),
      enrichSource: cand.source,
      enrichExternalId: cand.externalId,
      enrichProvider: verification?.provider ?? "apollo",
      approvalState: "found",
      reworkFeedback: null,
    });
    for (const k of keys) known.add(k);
    created.push(row);
    credits += 1;
    await addCredit("apollo_contact", 1);
  }

  await patchCompanyResearch(company.id, {});
  return { created, skipped, creditsUsed: credits };
}

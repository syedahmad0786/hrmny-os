import type { LeadCandidate } from "@hrmny/integrations";
import {
  createCompany,
  createContact,
  createDeal,
  listCompanies,
  listContacts,
} from "../crm/repository";
import { isSuppressed } from "../sales-os/store";
import { strongerDedupeKey } from "../sales-os/enrich";

/**
 * Dedupe M8 lead candidates into the CRM. Idempotent: matching an existing
 * contact by `lower(email)` skips it, so re-running the same candidates creates
 * no duplicate contacts. New candidates get a company (deduped by domain within
 * the run) + contact + deal. externalId is carried as company-note provenance
 * and returned per record (contact/deal note fields aren't in the consumable
 * repository surface — see AGENT-WORKSTREAMS ruling).
 */

export type DedupeCreated = {
  externalId: string;
  email: string | null;
  companyId: string | null;
  contactId: string;
  dealId: string;
};

export type DedupeSkipped = {
  externalId: string;
  email: string;
  contactId: string;
};

export type DedupeResult = {
  created: DedupeCreated[];
  skipped: DedupeSkipped[];
};

function splitName(fullName?: string): { firstName: string; lastName: string | null } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", lastName: null };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: null };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

async function findContactByEmail(email: string): Promise<string | null> {
  const lower = email.toLowerCase();
  const matches = await listContacts({ search: lower });
  const hit = matches.find((c) => (c.email ?? "").toLowerCase() === lower);
  return hit?.contactId ?? null;
}

export async function dedupeIntoCrm(
  candidates: LeadCandidate[],
): Promise<DedupeResult> {
  const created: DedupeCreated[] = [];
  const skipped: DedupeSkipped[] = [];
  // Within-run company cache so two leads at one company reuse one company row.
  const companyByDomain = new Map<string, string>();

  const companies = await listCompanies();
  const companyByName = new Map(companies.map((c) => [c.name.toLowerCase(), c]));
  const knownKeys = new Set<string>();
  for (const existing of await listContacts()) {
    for (const k of strongerDedupeKey({
      email: existing.email,
      linkedinUrl: existing.linkedinUrl,
      fullName: `${existing.firstName} ${existing.lastName ?? ""}`.trim(),
    })) {
      knownKeys.add(k);
    }
  }

  for (const cand of candidates) {
    const email = cand.email?.trim() ?? null;

    if (email) {
      const suppressed = await isSuppressed({ email });
      if (suppressed) {
        skipped.push({
          externalId: cand.externalId,
          email,
          contactId: `suppressed:${suppressed.reason}`,
        });
        continue;
      }
      const existing = await findContactByEmail(email);
      if (existing) {
        skipped.push({ externalId: cand.externalId, email, contactId: existing });
        continue;
      }
    }
    const keys = strongerDedupeKey({
      email,
      linkedinUrl: cand.linkedinUrl,
      companyName: cand.companyName,
      fullName: cand.fullName,
    });
    if (keys.some((k) => knownKeys.has(k))) {
      skipped.push({
        externalId: cand.externalId,
        email: email ?? "",
        contactId: "deduped",
      });
      continue;
    }

    let companyId: string | null = null;
    if (cand.companyName || cand.companyDomain) {
      const domainKey = (cand.companyDomain ?? cand.companyName ?? "").toLowerCase();
      const cached = domainKey ? companyByDomain.get(domainKey) : undefined;
      const named = cand.companyName
        ? companyByName.get(cand.companyName.toLowerCase())
        : undefined;
      if (cached) {
        companyId = cached;
      } else if (named) {
        companyId = named.companyId;
        if (domainKey) companyByDomain.set(domainKey, companyId);
      } else {
        const company = await createCompany({
          name: cand.companyName ?? cand.companyDomain ?? "Unknown Co",
          website: cand.companyDomain ? `https://${cand.companyDomain}` : null,
          notes: `leadgen externalId:${cand.externalId} source:${cand.source}`,
        });
        companyId = company.companyId;
        if (domainKey) companyByDomain.set(domainKey, companyId);
        companyByName.set(company.name.toLowerCase(), company);
      }
    }

    const { firstName, lastName } = splitName(cand.fullName);
    const contact = await createContact({
      companyId,
      firstName,
      lastName,
      email,
      title: cand.title ?? null,
      linkedinUrl: cand.linkedinUrl ?? null,
    });

    const deal = await createDeal({
      companyName: cand.companyName ?? "Unknown Co",
      companyId,
      primaryContactId: contact.contactId,
      leadSourceLane: "apollo_intent",
    });

    for (const k of keys) knownKeys.add(k);
    created.push({
      externalId: cand.externalId,
      email,
      companyId,
      contactId: contact.contactId,
      dealId: deal.dealId,
    });
  }

  return { created, skipped };
}

import {
  createCompany,
  createContact,
  createDeal,
  createNote,
  getContact,
  getDeal,
  listCompanies,
  listContacts,
  listDeals,
  updateContact,
  updateDeal,
} from "./repository";
import type { DealRow } from "./types";
import type {
  EmailVerificationAdapter,
  LeadCandidate,
} from "@hrmny/integrations";
import { assertLegacySalesSyntheticRuntime } from "../sales-os/legacy-effect-policy";
import type { CrmMarket } from "@/lib/crm-markets";

export type ApolloCompanyHit = Record<string, unknown>;

export type DurableApolloImportResult = {
  mode: "mock" | "live";
  query: string;
  verifyMode: "mock" | "live" | "skipped";
  deals: Array<{
    dealId: string;
    companyId: string;
    contactId: string | null;
    companyName: string;
    stage: DealRow["stage"];
    leadSourceLane: DealRow["leadSourceLane"];
    sector: string | null;
    emailVerified: boolean;
    verifyVerdict: string | null;
  }>;
};

function pickString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function normalizeHost(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(
      value.startsWith("http") ? value : `https://${value}`,
    ).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] ?? null
    );
  }
}

function splitName(fullName: string | undefined): {
  firstName: string;
  lastName: string | null;
} {
  const parts = (fullName ?? "Apollo lead").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "Apollo",
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : null,
  };
}

function apolloEmailVerified(status: string | undefined): boolean {
  return new Set(["verified", "valid"]).has(status?.trim().toLowerCase() ?? "");
}

export type ApolloPersonImportResult = {
  companyId: string;
  contactId: string;
  dealId: string;
  companyName: string;
  fullName: string;
  email: string | null;
  emailVerified: boolean;
  reused: { company: boolean; contact: boolean; deal: boolean };
};

/**
 * Persist one explicitly reviewed Apollo person into the canonical CRM.
 * Company, contact, and open-deal dedupe are all performed before inserts.
 * No guessed email is created. When enrichment supplied an email, Apollo's
 * own verdict is the only verification evidence used by this path.
 */
export async function importApolloPersonToCrm(input: {
  person: LeadCandidate;
  receiptId: string;
  market?: CrmMarket;
  ownerEmployeeId?: string | null;
  existingContactId?: string | null;
  existingDealId?: string | null;
}): Promise<ApolloPersonImportResult> {
  const person = input.person;
  const companyName = person.companyName?.trim() || "Unknown company";
  const domain = normalizeHost(person.companyDomain);
  const companies = await listCompanies();
  let company = companies.find((row) => {
    const rowDomain = normalizeHost(row.website);
    return (
      (domain && rowDomain === domain) ||
      row.name.trim().toLowerCase() === companyName.toLowerCase()
    );
  });
  const reusedCompany = Boolean(company);
  if (!company) {
    company = await createCompany({
      name: companyName,
      market: input.market ?? "UAE",
      website: domain ? `https://${domain}` : null,
      notes: "Created from a reviewed Apollo person receipt.",
    });
  }

  const name = splitName(person.fullName);
  const email = person.email?.trim().toLowerCase() || null;
  const linkedin = person.linkedinUrl?.trim() || null;
  const contacts = await listContacts({ companyId: company.companyId });
  const receiptContact = input.existingContactId
    ? await getContact(input.existingContactId)
    : null;
  let contact =
    receiptContact?.companyId === company.companyId
      ? receiptContact
      : contacts.find((row) => {
          const sameEmail = email && row.email?.trim().toLowerCase() === email;
          const sameLinkedIn =
            linkedin &&
            row.linkedinUrl?.trim().toLowerCase().replace(/\/$/, "") ===
              linkedin.toLowerCase().replace(/\/$/, "");
          const sameName =
            `${row.firstName} ${row.lastName ?? ""}`.trim().toLowerCase() ===
            `${name.firstName} ${name.lastName ?? ""}`.trim().toLowerCase();
          return Boolean(sameEmail || sameLinkedIn || sameName);
        });
  const reusedContact = Boolean(contact);
  const verified = apolloEmailVerified(person.emailStatus);
  if (!contact) {
    contact = await createContact({
      companyId: company.companyId,
      firstName: name.firstName,
      lastName: name.lastName,
      email,
      title: person.title ?? null,
      linkedinUrl: linkedin,
      isPrimary: true,
    });
  }
  const updatedContact = await updateContact(contact.contactId, {
    companyId: company.companyId,
    ...(person.fullName?.trim()
      ? { firstName: name.firstName, lastName: name.lastName }
      : {}),
    email: email ?? contact.email,
    title: person.title ?? contact.title,
    linkedinUrl: linkedin ?? contact.linkedinUrl,
    emailVerified: contact.emailVerified || verified,
    isPrimary: true,
  });
  contact = updatedContact ?? contact;

  const deals = await listDeals({ companyId: company.companyId });
  const receiptDeal = input.existingDealId
    ? await getDeal(input.existingDealId)
    : null;
  let deal =
    receiptDeal?.companyId === company.companyId
      ? receiptDeal
      : deals.find((row) => row.closeOutcome === null);
  const reusedDeal = Boolean(deal);
  if (!deal) {
    deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
      primaryContactId: contact.contactId,
      sector: company.sector,
      leadSourceLane: "apollo_intent",
      ownerEmployeeId: input.ownerEmployeeId ?? null,
    });
  } else if (
    !deal.primaryContactId ||
    (deal.dealId === input.existingDealId &&
      deal.primaryContactId !== contact.contactId)
  ) {
    deal =
      (await updateDeal(deal.dealId, {
        primaryContactId: contact.contactId,
      })) ?? deal;
  }
  if (verified && !deal.emailVerified) {
    deal = (await updateDeal(deal.dealId, { emailVerified: true })) ?? deal;
  }

  const contactName = `${contact.firstName} ${contact.lastName ?? ""}`.trim();
  const contactTitle = contact.title ? ` (${contact.title})` : "";
  const emailSummary = email
    ? verified
      ? "Apollo verified the saved work email."
      : "A work email was saved but is not verified."
    : "No email was unlocked.";
  await createNote({
    dealId: deal.dealId,
    companyId: company.companyId,
    contactId: contact.contactId,
    authorEmployeeId: input.ownerEmployeeId ?? null,
    body: `Added ${contactName}${contactTitle} from Apollo to ${company.name}. ${emailSummary}${input.market && input.market !== "UAE" ? ` Target market: ${input.market}.` : ""} No phone, personal email, or waterfall lookup was used.`,
  });

  return {
    companyId: company.companyId,
    contactId: contact.contactId,
    dealId: deal.dealId,
    companyName: company.name,
    fullName: `${contact.firstName} ${contact.lastName ?? ""}`.trim(),
    email: contact.email,
    emailVerified: contact.emailVerified,
    reused: {
      company: reusedCompany,
      contact: reusedContact,
      deal: reusedDeal,
    },
  };
}

function normalizeCompany(hit: ApolloCompanyHit, fallbackQuery: string) {
  const name =
    pickString(hit.name) ||
    pickString(hit.organization_name) ||
    pickString(hit.company) ||
    fallbackQuery;
  const domain =
    pickString(hit.domain) ||
    pickString(hit.primary_domain) ||
    pickString(hit.website_url);
  const industry =
    pickString(hit.industry) || pickString(hit.primary_industry) || "Unknown";
  const website =
    domain && !domain.startsWith("http") ? `https://${domain}` : domain;
  return { name, website, industry };
}

/**
 * Apollo company search → durable CRM company + contact + discover deal.
 * Optional Hunter (or mock) email verification on the contact.
 */
export async function importApolloCompaniesToCrm(input: {
  query: string;
  companies: ApolloCompanyHit[];
  mode: "mock" | "live";
  ownerEmployeeId?: string | null;
  limit?: number;
  verifier?: EmailVerificationAdapter | null;
}): Promise<DurableApolloImportResult> {
  assertLegacySalesSyntheticRuntime("crm.importApolloCompaniesToCrm");
  const limit = input.limit ?? 5;
  const deals: DurableApolloImportResult["deals"] = [];
  let verifyMode: DurableApolloImportResult["verifyMode"] = "skipped";

  for (const hit of input.companies.slice(0, limit)) {
    const norm = normalizeCompany(hit, input.query);
    const company = await createCompany({
      name: norm.name,
      sector: norm.industry,
      market: "UAE",
      website: norm.website,
      notes: `Apollo ${input.mode} import: ${input.query}`,
    });

    const contactEmail =
      pickString(hit.email) ||
      pickString(hit.primary_email) ||
      (norm.website
        ? `hello@${norm.website.replace(/^https?:\/\//, "").split("/")[0]}`
        : null);
    const contact = await createContact({
      companyId: company.companyId,
      firstName:
        pickString(hit.first_name) || pickString(hit.firstName) || "Apollo",
      lastName: pickString(hit.last_name) || pickString(hit.lastName) || "Lead",
      email: contactEmail,
      title: pickString(hit.title) || "Marketing Lead",
      isPrimary: true,
    });

    let emailVerified = false;
    let verifyVerdict: string | null = null;
    if (contactEmail && input.verifier) {
      verifyMode = input.verifier.mode;
      try {
        const verified = await input.verifier.verify(contactEmail);
        emailVerified = verified.emailVerified;
        verifyVerdict = verified.verdict;
        if (emailVerified) {
          await updateContact(contact.contactId, { emailVerified: true });
        }
      } catch {
        verifyVerdict = "error";
      }
    }

    const deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
      primaryContactId: contact.contactId,
      sector: company.sector,
      leadSourceLane: "apollo_intent",
      ownerEmployeeId: input.ownerEmployeeId ?? null,
    });
    if (emailVerified) {
      await updateDeal(deal.dealId, { emailVerified: true });
    }

    await createNote({
      dealId: deal.dealId,
      companyId: company.companyId,
      authorEmployeeId: input.ownerEmployeeId ?? null,
      body: `Apollo ${input.mode} prospecting hit for "${input.query}": ${JSON.stringify(
        {
          name: norm.name,
          website: norm.website,
          industry: norm.industry,
          source: hit.source ?? input.mode,
          emailVerified,
          verifyVerdict,
          verifyMode,
        },
      )}`,
    });

    deals.push({
      dealId: deal.dealId,
      companyId: company.companyId,
      contactId: contact.contactId,
      companyName: deal.companyName,
      stage: deal.stage,
      leadSourceLane: deal.leadSourceLane,
      sector: deal.sector,
      emailVerified,
      verifyVerdict,
    });
  }

  return {
    mode: input.mode,
    query: input.query,
    verifyMode,
    deals,
  };
}

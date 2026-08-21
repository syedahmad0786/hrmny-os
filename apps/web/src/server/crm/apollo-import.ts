import {
  createCompany,
  createContact,
  createDeal,
  createNote,
  updateContact,
  updateDeal,
} from "./repository";
import type { DealRow } from "./types";
import type { EmailVerificationAdapter } from "@hrmny/integrations";

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
    pickString(hit.industry) ||
    pickString(hit.primary_industry) ||
    "Unknown";
  const website =
    domain && !domain.startsWith("http")
      ? `https://${domain}`
      : domain;
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
        pickString(hit.first_name) ||
        pickString(hit.firstName) ||
        "Apollo",
      lastName:
        pickString(hit.last_name) ||
        pickString(hit.lastName) ||
        "Lead",
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

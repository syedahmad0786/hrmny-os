import {
  createContact,
  createDeal,
  updateContact,
  updateDeal,
} from "../crm/repository";
import { getCompanyResearch, getContactResearch, patchCompanyResearch, patchContactResearch } from "./store";
import type { CompanyResearchRow, ContactResearchRow } from "./types";

export async function decideCompany(
  id: string,
  action: "approve" | "reject" | "rework",
  input: { actorId?: string | null; feedback?: string | null } = {},
): Promise<CompanyResearchRow> {
  const row = await getCompanyResearch(id);
  if (!row) throw new Error("Company research not found");
  if (row.approvalState === "rejected") throw new Error("Rejected companies stay rejected");
  const now = new Date().toISOString();
  const next =
    action === "approve" ? "approved" : action === "reject" ? "rejected" : "rework";
  const patched = await patchCompanyResearch(id, {
    approvalState: next,
    reworkFeedback: action === "rework" ? (input.feedback ?? "").trim() || "Rework requested" : null,
    decidedBy: input.actorId ?? null,
    decidedAt: now,
  });
  if (!patched) throw new Error("Failed to update company research");
  return patched;
}

export async function decideContact(
  id: string,
  action: "approve" | "reject" | "rework",
  input: { actorId?: string | null; feedback?: string | null } = {},
): Promise<ContactResearchRow> {
  const row = await getContactResearch(id);
  if (!row) throw new Error("Contact research not found");
  const company = await getCompanyResearch(row.companyResearchId);
  if (!company || company.approvalState !== "approved") {
    throw new Error("Gate 1 must approve the company first");
  }
  if (action === "rework") {
    const patched = await patchContactResearch(id, {
      approvalState: "rework",
      reworkFeedback: (input.feedback ?? "").trim() || "Find someone more senior",
    });
    if (!patched) throw new Error("Failed to update contact research");
    return patched;
  }
  if (action === "reject") {
    const patched = await patchContactResearch(id, { approvalState: "rejected" });
    if (!patched) throw new Error("Failed to update contact research");
    return patched;
  }

  const [firstName, ...rest] = row.fullName.trim().split(/\s+/);
  const contact = await createContact({
    companyId: row.companyId ?? company.companyId,
    firstName: firstName || row.fullName,
    lastName: rest.length ? rest.join(" ") : null,
    email: row.email,
    title: row.title,
    linkedinUrl: row.linkedinUrl,
    isPrimary: true,
  });
  if (row.emailVerified) {
    await updateContact(contact.contactId, { emailVerified: true });
  }
  const deal = await createDeal({
    companyName: company.name,
    companyId: row.companyId ?? company.companyId,
    primaryContactId: contact.contactId,
    sector: company.sector,
    leadSourceLane: company.leadSourceLane,
  });
  await updateDeal(deal.dealId, {
    buafTemperature: company.temperature,
    buafBudget: company.buafBudget >= 7,
    buafUrgency: company.buafUrgency >= 7,
    buafAccess: company.buafAccess >= 7,
    buafFit: company.buafFit >= 7,
    emailVerified: row.emailVerified,
    quoteValue: company.estimatedValueAed != null ? String(company.estimatedValueAed) : null,
  });
  const patched = await patchContactResearch(id, {
    approvalState: "approved",
    contactId: contact.contactId,
    dealId: deal.dealId,
    companyId: row.companyId ?? company.companyId,
  });
  if (!patched) throw new Error("Failed to approve contact");
  return patched;
}

import {
  and,
  auditEvent,
  company as companyTable,
  companyResearch as companyResearchTable,
  contact as contactTable,
  contactResearch as contactResearchTable,
  deal as dealTable,
  eq,
  integrationInbox,
  sql,
} from "@hrmny/db";
import type { CrmMarket } from "@/lib/crm-markets";
import {
  createCompany,
  createContact,
  createDeal,
  listCompanies,
  updateContact,
  updateDeal,
} from "../crm/repository";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import {
  normalizeResearchCompanyName,
  normalizeResearchEvidence,
  normalizeResearchWebsiteHost,
} from "./research-evidence";
import {
  getCompanyResearch,
  getContactResearch,
  getResearchReceiptSignalIds,
  linkResearchReceiptSignals,
  listIntelSignals,
  patchCompanyResearch,
  patchContactResearch,
} from "./store";
import type { CompanyResearchRow, ContactResearchRow } from "./types";

const companyApprovalLocks = new Map<string, Promise<void>>();

async function withCompanyApprovalLock<T>(
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = companyApprovalLocks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  companyApprovalLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (companyApprovalLocks.get(key) === tail)
      companyApprovalLocks.delete(key);
  }
}

function companyIdentityKeys(row: CompanyResearchRow): string[] {
  const keys = [`name:${normalizeResearchCompanyName(row.name)}`];
  const websiteHost = normalizeResearchWebsiteHost(row.website);
  if (websiteHost) keys.push(`domain:${websiteHost}`);
  return [...new Set(keys)].sort();
}

function withCompanyApprovalLocks<T>(
  keys: string[],
  fn: () => Promise<T>,
): Promise<T> {
  const ordered = [...new Set(keys)].sort();
  const acquire = (index: number): Promise<T> =>
    index >= ordered.length
      ? fn()
      : withCompanyApprovalLock(ordered[index]!, () => acquire(index + 1));
  return acquire(0);
}

type CanonicalCompanyCandidate = {
  companyId: string;
  name: string;
  website: string | null;
};

function resolveCanonicalCompanyCandidate(
  companies: CanonicalCompanyCandidate[],
  proposal: Pick<CompanyResearchRow, "name" | "website">,
): CanonicalCompanyCandidate | null {
  const normalizedName = normalizeResearchCompanyName(proposal.name);
  const websiteHost = normalizeResearchWebsiteHost(proposal.website);
  const sameName = companies.filter(
    (company) => normalizeResearchCompanyName(company.name) === normalizedName,
  );
  const sameDomain = websiteHost
    ? companies.filter(
        (company) =>
          normalizeResearchWebsiteHost(company.website) === websiteHost,
      )
    : [];

  const conflictingName = Boolean(
    websiteHost &&
    sameName.some((company) => {
      const existingHost = normalizeResearchWebsiteHost(company.website);
      return Boolean(existingHost && existingHost !== websiteHost);
    }),
  );
  const conflictingDomain = sameDomain.some(
    (company) => normalizeResearchCompanyName(company.name) !== normalizedName,
  );
  if (conflictingName || conflictingDomain) {
    throw new Error("COMPANY_IDENTITY_CONFLICT_REQUIRES_REVIEW");
  }

  const candidates = new Map<string, CanonicalCompanyCandidate>();
  for (const company of [...sameName, ...sameDomain]) {
    candidates.set(company.companyId, company);
  }
  if (candidates.size > 1) {
    throw new Error("COMPANY_IDENTITY_AMBIGUOUS_REQUIRES_REVIEW");
  }
  return [...candidates.values()][0] ?? null;
}

async function approveCompanyProposal(
  row: CompanyResearchRow,
  actorId: string | null,
): Promise<CompanyResearchRow> {
  normalizeResearchEvidence(row.evidence);
  const identityKeys = companyIdentityKeys(row);
  const db = getDb();

  if (db) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`research-decision:${row.id}`}, 0))`,
      );
      for (const identityKey of identityKeys) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${identityKey}, 0))`,
        );
      }
      const [fresh] = await tx
        .select()
        .from(companyResearchTable)
        .where(eq(companyResearchTable.companyResearchId, row.id))
        .limit(1);
      if (!fresh) throw new Error("Company research not found");
      if (fresh.approvalState === "rejected") {
        throw new Error("Rejected companies stay rejected");
      }
      if (fresh.approvalState === "approved" && fresh.companyId) return;
      normalizeResearchEvidence(fresh.evidence);

      const receipts = await tx
        .select({ result: integrationInbox.result })
        .from(integrationInbox)
        .where(
          and(
            eq(integrationInbox.provider, "hrmny"),
            eq(integrationInbox.operation, "sales.research.propose"),
            eq(integrationInbox.status, "completed"),
          ),
        );
      const signalIds = [
        ...new Set(
          receipts
            .filter((receipt) => receipt.result?.proposalId === row.id)
            .map((receipt) => receipt.result?.signalId)
            .filter(
              (signalId): signalId is string => typeof signalId === "string",
            ),
        ),
      ];
      if (signalIds.length === 0) {
        throw new Error("RESEARCH_PROPOSAL_RECEIPT_REQUIRED");
      }

      const companies = await tx
        .select({
          companyId: companyTable.companyId,
          name: companyTable.name,
          website: companyTable.website,
        })
        .from(companyTable);
      const existing = resolveCanonicalCompanyCandidate(companies, fresh);
      const companyId =
        existing?.companyId ??
        (
          await tx
            .insert(companyTable)
            .values({
              name: fresh.name,
              sector: fresh.sector,
              market: fresh.market as CrmMarket | null,
              website: fresh.website,
              notes: fresh.whyThis,
            })
            .returning({ companyId: companyTable.companyId })
        )[0]?.companyId;
      if (!companyId) throw new Error("Failed to promote approved company");

      await tx
        .update(companyResearchTable)
        .set({
          companyId,
          approvalState: "approved",
          reworkFeedback: null,
          decidedBy: actorId,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companyResearchTable.companyResearchId, row.id));

      const linkedSignals = await tx.execute<{ id: string }>(sql`
        update public.intel_signal
        set company_id = ${companyId}::uuid
        where intel_signal_id in (
          ${sql.join(
            signalIds.map((signalId) => sql`${signalId}::uuid`),
            sql`, `,
          )}
        )
          and company_id is null
        returning intel_signal_id as id
      `);
      if (linkedSignals.length !== signalIds.length) {
        throw new Error("RESEARCH_PROPOSAL_SIGNAL_RECONCILIATION_REQUIRED");
      }
      await tx.insert(auditEvent).values({
        actorEmployeeId: actorId,
        action: "sales.research.approved",
        entityType: "company_research",
        entityId: row.id,
        before: {
          approvalState: fresh.approvalState,
          companyId: fresh.companyId,
        },
        after: {
          approvalState: "approved",
          companyId,
          linkedSignalIds: signalIds,
        },
        reason: "Gate 1 approval promoted an evidence-bearing proposal",
      });
    });
    const approved = await getCompanyResearch(row.id);
    if (!approved) throw new Error("Failed to update company research");
    return approved;
  }

  return withCompanyApprovalLocks(identityKeys, async () => {
    const fresh = await getCompanyResearch(row.id);
    if (!fresh) throw new Error("Company research not found");
    if (fresh.approvalState === "rejected") {
      throw new Error("Rejected companies stay rejected");
    }
    if (fresh.approvalState === "approved" && fresh.companyId) return fresh;
    normalizeResearchEvidence(fresh.evidence);

    const signalIds = await getResearchReceiptSignalIds(row.id);
    const signals = await listIntelSignals();
    if (
      signalIds.length === 0 ||
      signalIds.some((signalId) => {
        const signal = signals.find((candidate) => candidate.id === signalId);
        return !signal || signal.companyId !== null;
      })
    ) {
      throw new Error("RESEARCH_PROPOSAL_RECEIPT_REQUIRED");
    }

    const existing = resolveCanonicalCompanyCandidate(
      await listCompanies(),
      fresh,
    );
    const companyId = existing
      ? existing.companyId
      : (
          await createCompany({
            name: fresh.name,
            sector: fresh.sector,
            market: fresh.market,
            website: fresh.website,
            notes: fresh.whyThis,
          })
        ).companyId;

    const approved = await patchCompanyResearch(row.id, {
      companyId,
      approvalState: "approved",
      reworkFeedback: null,
      decidedBy: actorId,
      decidedAt: new Date().toISOString(),
    });
    if (!approved) throw new Error("Failed to update company research");
    const linkedSignals = await linkResearchReceiptSignals(row.id, companyId);
    if (linkedSignals !== signalIds.length) {
      throw new Error("RESEARCH_PROPOSAL_SIGNAL_RECONCILIATION_REQUIRED");
    }
    getDemoStore().appendAudit({
      actorEmployeeId: actorId,
      action: "sales.research.approved",
      entityType: "company_research",
      entityId: row.id,
      before: {
        approvalState: fresh.approvalState,
        companyId: fresh.companyId,
      },
      after: { approvalState: "approved", companyId, linkedSignals },
      reason: "Gate 1 approval promoted an evidence-bearing proposal",
    });
    return approved;
  });
}

export async function decideCompany(
  id: string,
  action: "approve" | "reject" | "rework",
  input: { actorId?: string | null; feedback?: string | null } = {},
): Promise<CompanyResearchRow> {
  const row = await getCompanyResearch(id);
  if (!row) throw new Error("Company research not found");
  if (row.approvalState === "rejected")
    throw new Error("Rejected companies stay rejected");
  if (action === "approve") {
    return getDb()
      ? approveCompanyProposal(row, input.actorId ?? null)
      : withCompanyApprovalLock(`research-decision:${id}`, () =>
          approveCompanyProposal(row, input.actorId ?? null),
        );
  }
  const next = action === "reject" ? "rejected" : "rework";
  const feedback =
    action === "rework"
      ? (input.feedback ?? "").trim() || "Rework requested"
      : null;
  const db = getDb();
  if (db) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`research-decision:${id}`}, 0))`,
      );
      const [fresh] = await tx
        .select()
        .from(companyResearchTable)
        .where(eq(companyResearchTable.companyResearchId, id))
        .limit(1);
      if (!fresh) throw new Error("Company research not found");
      if (fresh.approvalState === "approved") {
        throw new Error("Approved research requires a governed correction");
      }
      if (fresh.approvalState === "rejected") {
        throw new Error("Rejected companies stay rejected");
      }
      await tx
        .update(companyResearchTable)
        .set({
          approvalState: next,
          reworkFeedback: feedback,
          decidedBy: input.actorId ?? null,
          decidedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companyResearchTable.companyResearchId, id));
      await tx.insert(auditEvent).values({
        actorEmployeeId: input.actorId ?? null,
        action: `sales.research.${next}`,
        entityType: "company_research",
        entityId: id,
        before: { approvalState: fresh.approvalState },
        after: { approvalState: next, feedback },
        reason: feedback ?? "Gate 1 decision",
      });
    });
    const decided = await getCompanyResearch(id);
    if (!decided) throw new Error("Failed to update company research");
    return decided;
  }

  return withCompanyApprovalLock(`research-decision:${id}`, async () => {
    const fresh = await getCompanyResearch(id);
    if (!fresh) throw new Error("Company research not found");
    if (fresh.approvalState === "approved") {
      throw new Error("Approved research requires a governed correction");
    }
    if (fresh.approvalState === "rejected") {
      throw new Error("Rejected companies stay rejected");
    }
    const decided = await patchCompanyResearch(id, {
      companyId: fresh.companyId,
      approvalState: next,
      reworkFeedback: feedback,
      decidedBy: input.actorId ?? null,
      decidedAt: new Date().toISOString(),
    });
    if (!decided) throw new Error("Failed to update company research");
    getDemoStore().appendAudit({
      actorEmployeeId: input.actorId ?? null,
      action: `sales.research.${next}`,
      entityType: "company_research",
      entityId: id,
      before: { approvalState: fresh.approvalState },
      after: { approvalState: next, feedback },
      reason: feedback ?? "Gate 1 decision",
    });
    return decided;
  });
}

function isContactDecisionReplay(
  row: {
    approvalState: string;
    contactId: string | null;
    dealId: string | null;
  },
  action: "approve" | "reject" | "rework",
): boolean {
  const target =
    action === "approve"
      ? "approved"
      : action === "reject"
        ? "rejected"
        : "rework";
  if (row.approvalState === target) {
    if (action === "approve" && (!row.contactId || !row.dealId)) {
      throw new Error("CONTACT_APPROVAL_RECONCILIATION_REQUIRED");
    }
    return true;
  }
  if (
    row.approvalState === "rework" &&
    action !== "rework" &&
    !row.contactId &&
    !row.dealId
  ) {
    return false;
  }
  if (row.approvalState !== "found" || row.contactId || row.dealId) {
    throw new Error("CONTACT_DECISION_ALREADY_FINAL");
  }
  return false;
}

export async function decideContact(
  id: string,
  action: "approve" | "reject" | "rework",
  input: { actorId?: string | null; feedback?: string | null } = {},
): Promise<ContactResearchRow> {
  const db = getDb();
  if (db) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`contact-decision:${id}`}, 0))`,
      );
      const [fresh] = await tx
        .select()
        .from(contactResearchTable)
        .where(eq(contactResearchTable.contactResearchId, id))
        .limit(1);
      if (!fresh) throw new Error("Contact research not found");
      if (isContactDecisionReplay(fresh, action)) return;

      const [freshCompany] = await tx
        .select()
        .from(companyResearchTable)
        .where(
          eq(companyResearchTable.companyResearchId, fresh.companyResearchId),
        )
        .limit(1);
      if (
        !freshCompany ||
        freshCompany.approvalState !== "approved" ||
        !freshCompany.companyId
      ) {
        throw new Error("Gate 1 must approve the company first");
      }

      if (action !== "approve") {
        const feedback =
          action === "rework"
            ? (input.feedback ?? "").trim() || "Find someone more senior"
            : null;
        const [decided] = await tx
          .update(contactResearchTable)
          .set({
            approvalState: action === "reject" ? "rejected" : "rework",
            reworkFeedback: feedback,
            updatedAt: new Date(),
          })
          .where(eq(contactResearchTable.contactResearchId, id))
          .returning({ id: contactResearchTable.contactResearchId });
        if (!decided) throw new Error("Failed to update contact research");
        await tx.insert(auditEvent).values({
          actorEmployeeId: input.actorId ?? null,
          action: `sales.contact.${action === "reject" ? "rejected" : "rework"}`,
          entityType: "contact_research",
          entityId: id,
          before: { approvalState: fresh.approvalState },
          after: {
            approvalState: action === "reject" ? "rejected" : "rework",
            feedback,
          },
          reason: feedback ?? "Gate 2 decision",
        });
        return;
      }

      const [firstName, ...rest] = fresh.fullName.trim().split(/\s+/);
      const [contact] = await tx
        .insert(contactTable)
        .values({
          companyId: freshCompany.companyId,
          firstName: firstName || fresh.fullName,
          lastName: rest.length ? rest.join(" ") : null,
          email: fresh.email,
          title: fresh.title,
          linkedinUrl: fresh.linkedinUrl,
          emailVerified: fresh.emailVerified,
          isPrimary: true,
        })
        .returning({ contactId: contactTable.contactId });
      if (!contact) throw new Error("Failed to promote approved contact");

      const [deal] = await tx
        .insert(dealTable)
        .values({
          companyId: freshCompany.companyId,
          primaryContactId: contact.contactId,
          companyName: freshCompany.name,
          sector: freshCompany.sector,
          stage: "discover",
          leadSourceLane:
            freshCompany.leadSourceLane as typeof dealTable.$inferInsert.leadSourceLane,
          buafTemperature:
            freshCompany.temperature as typeof dealTable.$inferInsert.buafTemperature,
          buafBudget: freshCompany.buafBudget >= 7,
          buafUrgency: freshCompany.buafUrgency >= 7,
          buafAccess: freshCompany.buafAccess >= 7,
          buafFit: freshCompany.buafFit >= 7,
          emailVerified: fresh.emailVerified,
          quoteValue: freshCompany.estimatedValueAed ?? "0.00",
          internalCost: "0.00",
          marginPct: "0.00",
          vendorHandlingFeePct: "20.00",
        })
        .returning({ dealId: dealTable.dealId });
      if (!deal) throw new Error("Failed to create deal for approved contact");

      const [approved] = await tx
        .update(contactResearchTable)
        .set({
          approvalState: "approved",
          contactId: contact.contactId,
          dealId: deal.dealId,
          companyId: freshCompany.companyId,
          reworkFeedback: null,
          updatedAt: new Date(),
        })
        .where(eq(contactResearchTable.contactResearchId, id))
        .returning({ id: contactResearchTable.contactResearchId });
      if (!approved) throw new Error("Failed to approve contact");

      await tx.insert(auditEvent).values({
        actorEmployeeId: input.actorId ?? null,
        action: "sales.contact.approved",
        entityType: "contact_research",
        entityId: id,
        before: { approvalState: fresh.approvalState },
        after: {
          approvalState: "approved",
          companyId: freshCompany.companyId,
          contactId: contact.contactId,
          dealId: deal.dealId,
        },
        reason: "Gate 2 approval promoted the contact and opened its deal",
      });
    });
    const approved = await getContactResearch(id);
    if (!approved) throw new Error("Failed to approve contact");
    return approved;
  }

  return withCompanyApprovalLock(`contact-decision:${id}`, async () => {
    const fresh = await getContactResearch(id);
    if (!fresh) throw new Error("Contact research not found");
    if (isContactDecisionReplay(fresh, action)) return fresh;
    const company = await getCompanyResearch(fresh.companyResearchId);
    if (!company || company.approvalState !== "approved") {
      throw new Error("Gate 1 must approve the company first");
    }

    if (action !== "approve") {
      const feedback =
        action === "rework"
          ? (input.feedback ?? "").trim() || "Find someone more senior"
          : null;
      const patched = await patchContactResearch(id, {
        approvalState: action === "reject" ? "rejected" : "rework",
        reworkFeedback: feedback,
      });
      if (!patched) throw new Error("Failed to update contact research");
      getDemoStore().appendAudit({
        actorEmployeeId: input.actorId ?? null,
        action: `sales.contact.${action === "reject" ? "rejected" : "rework"}`,
        entityType: "contact_research",
        entityId: id,
        before: { approvalState: fresh.approvalState },
        after: { approvalState: patched.approvalState, feedback },
        reason: feedback ?? "Gate 2 decision",
      });
      return patched;
    }
    if (!company.companyId) {
      throw new Error("Gate 1 approval must promote a canonical company first");
    }

    const [firstName, ...rest] = fresh.fullName.trim().split(/\s+/);
    const contact = await createContact({
      companyId: company.companyId,
      firstName: firstName || fresh.fullName,
      lastName: rest.length ? rest.join(" ") : null,
      email: fresh.email,
      title: fresh.title,
      linkedinUrl: fresh.linkedinUrl,
      isPrimary: true,
    });
    if (fresh.emailVerified) {
      await updateContact(contact.contactId, { emailVerified: true });
    }
    const deal = await createDeal({
      companyName: company.name,
      companyId: company.companyId,
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
      emailVerified: fresh.emailVerified,
      quoteValue:
        company.estimatedValueAed != null
          ? String(company.estimatedValueAed)
          : null,
    });
    const patched = await patchContactResearch(id, {
      approvalState: "approved",
      contactId: contact.contactId,
      dealId: deal.dealId,
      companyId: company.companyId,
      reworkFeedback: null,
    });
    if (!patched) throw new Error("Failed to approve contact");
    return patched;
  });
}

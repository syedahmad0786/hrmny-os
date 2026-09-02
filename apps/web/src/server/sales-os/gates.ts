import {
  and,
  auditEvent,
  company as companyTable,
  companyResearch as companyResearchTable,
  eq,
  integrationInbox,
  sql,
} from "@hrmny/db";
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
              market: fresh.market as "UAE" | "KSA" | "Both" | null,
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
      reworkFeedback:
        (input.feedback ?? "").trim() || "Find someone more senior",
    });
    if (!patched) throw new Error("Failed to update contact research");
    return patched;
  }
  if (action === "reject") {
    const patched = await patchContactResearch(id, {
      approvalState: "rejected",
    });
    if (!patched) throw new Error("Failed to update contact research");
    return patched;
  }
  if (!company.companyId) {
    throw new Error("Gate 1 approval must promote a canonical company first");
  }

  const [firstName, ...rest] = row.fullName.trim().split(/\s+/);
  const contact = await createContact({
    companyId: company.companyId,
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
    emailVerified: row.emailVerified,
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
  });
  if (!patched) throw new Error("Failed to approve contact");
  return patched;
}

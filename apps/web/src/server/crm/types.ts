import type {
  CrmPipelineStage,
} from "@hrmny/db";

export type CompanyRow = {
  companyId: string;
  name: string;
  sector: string | null;
  market: "UAE" | "KSA" | "Both" | null;
  website: string | null;
  linkedinUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactRow = {
  contactId: string;
  companyId: string | null;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  linkedinUrl: string | null;
  emailVerified: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DealRow = {
  dealId: string;
  companyId: string | null;
  primaryContactId: string | null;
  companyName: string;
  sector: string | null;
  stage: CrmPipelineStage | string;
  closeOutcome: "won" | "lost" | "postponed_on_hold" | null;
  lostReason: string | null;
  leadSourceLane: string;
  buafBudget: boolean | null;
  buafUrgency: boolean | null;
  buafAccess: boolean | null;
  buafFit: boolean | null;
  buafTemperature: "hot" | "warm" | "cool" | "cold" | null;
  emailVerified: boolean;
  quoteValue: string | null;
  internalCost: string | null;
  marginPct: string | null;
  discountPct: string | null;
  discountApprovalTier: string | null;
  vendorHandlingFeePct: string;
  ownerEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ActivityRow = {
  activityId: string;
  type: string;
  subject: string | null;
  body: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  actorEmployeeId: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CrmNoteRow = {
  crmNoteId: string;
  body: string;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  authorEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmTaskRow = {
  crmTaskId: string;
  title: string;
  status: "open" | "in_progress" | "done" | "cancelled";
  dueDate: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  ownerEmployeeId: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Strip margin/cost fields for AM / non-margin roles. */
export function redactDealMargin<T extends DealRow>(
  deal: T,
  canViewMargin: boolean,
): T | Omit<T, "internalCost" | "marginPct"> {
  if (canViewMargin) return deal;
  const { internalCost: _c, marginPct: _m, ...rest } = deal;
  return rest;
}

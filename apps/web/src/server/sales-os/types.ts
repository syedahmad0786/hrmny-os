export type ResearchApprovalState =
  | "researched"
  | "approved"
  | "rejected"
  | "rework";

export type ContactResearchState =
  | "found"
  | "approved"
  | "rejected"
  | "rework";

export type SuppressionReason =
  | "unsubscribe"
  | "bounce"
  | "complaint"
  | "dnc"
  | "no_go";

export type EmailEventKind =
  | "sent"
  | "delivered"
  | "bounced"
  | "complained"
  | "replied"
  | "unsubscribed";

export type CompanyResearchRow = {
  id: string;
  companyId: string | null;
  name: string;
  sector: string | null;
  market: "UAE" | "KSA" | "Both" | null;
  website: string | null;
  whyThis: string;
  evidence: string | null;
  leadSourceLane: string;
  estimatedValueAed: number | null;
  suggestedServices: string | null;
  buafBudget: number;
  buafUrgency: number;
  buafAccess: number;
  buafFit: number;
  buafTotal: number;
  temperature: "hot" | "warm" | "cool" | "cold";
  approvalState: ResearchApprovalState;
  reworkFeedback: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContactResearchRow = {
  id: string;
  companyResearchId: string;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  fullName: string;
  title: string | null;
  seniority: string | null;
  email: string | null;
  linkedinUrl: string | null;
  emailVerified: boolean;
  emailVerdict: string | null;
  enrichSource: string;
  enrichExternalId: string | null;
  enrichProvider: string | null;
  approvalState: ContactResearchState;
  reworkFeedback: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SuppressionRow = {
  id: string;
  email: string | null;
  domain: string | null;
  reason: SuppressionReason;
  source: string | null;
  createdAt: string;
};

export type EmailEventRow = {
  id: string;
  outreachItemId: string | null;
  contactId: string | null;
  kind: EmailEventKind;
  provider: string;
  externalId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
};

export type IntelSignalRow = {
  id: string;
  companyId: string | null;
  contactId: string | null;
  signalType: string;
  source: string | null;
  signalDate: string | null;
  summary: string;
  evidenceUrl: string | null;
  createdAt: string;
};

export type EvolveProposalRow = {
  id: string;
  focus: string;
  summary: string;
  proposed: Record<string, unknown>;
  state: "proposed" | "applied" | "rejected";
  createdAt: string;
  decidedAt: string | null;
};

export type CreditLedgerRow = {
  id: string;
  month: string;
  kind: "apollo_contact" | "email_send" | "linkedin_assist";
  count: number;
  createdAt: string;
};

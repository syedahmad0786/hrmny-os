/**
 * Deep links for staff after won deal → OS handover.
 * Pure helper so unit tests can lock URL shapes without Postgres.
 */

export function buildHandoverNextLinks(input: {
  clientId: string;
  taskId?: string | null;
  calendarId?: string | null;
  invoiceId?: string | null;
  outreachId?: string | null;
  campaignItemId?: string | null;
}): {
  client: string;
  account: string;
  creative: string;
  finance: string;
  approvals: string;
  portal: string;
  onboarding: string;
  outreach: string;
  campaigns: string;
} {
  const {
    clientId,
    taskId,
    calendarId,
    invoiceId,
    outreachId,
    campaignItemId: _campaignItemId,
  } = input;
  void _campaignItemId;
  const creativeQs = new URLSearchParams({
    clientId,
  });
  if (taskId?.trim()) {
    creativeQs.set("taskId", taskId.trim());
  }
  const accountQs = new URLSearchParams({ clientId });
  if (calendarId?.trim()) {
    accountQs.set("calendarId", calendarId.trim());
  }
  // Always scope Finance/Outreach/Approvals with clientId (Continue OS parity).
  // Pages resolve clientId → first invoice/outreach when id is missing.
  const financeQs = new URLSearchParams({ clientId });
  if (invoiceId?.trim()) {
    financeQs.set("invoiceId", invoiceId.trim());
  }
  const outreachQs = new URLSearchParams({ clientId });
  if (outreachId?.trim()) {
    outreachQs.set("id", outreachId.trim());
  }
  const approvalsQs = new URLSearchParams({ clientId });
  if (outreachId?.trim()) {
    approvalsQs.set("id", outreachId.trim());
  }
  return {
    client: `/clients/${clientId}`,
    account: `/account?${accountQs.toString()}`,
    creative: `/creative?${creativeQs.toString()}`,
    finance: `/finance?${financeQs.toString()}`,
    approvals: `/approvals?${approvalsQs.toString()}`,
    portal: `/client-preview?client=${encodeURIComponent(clientId)}#approvals`,
    onboarding: `/clients/${encodeURIComponent(clientId)}#onboarding`,
    outreach: `/crm/outreach?${outreachQs.toString()}`,
    // Do not pin draft campaignItemIds into Approvals — that inbox only lists
    // approved campaigns (+ outreach drafts). Keep Hunt Approvals on outreach.
    campaigns: `/creative?clientId=${encodeURIComponent(clientId)}`,
  };
}

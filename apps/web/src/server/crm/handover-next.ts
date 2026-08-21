/**
 * Deep links for staff after won deal → OS handover.
 * Pure helper so unit tests can lock URL shapes without Postgres.
 */
export function buildHandoverNextLinks(input: {
  clientId: string;
  invoiceId?: string | null;
  outreachId?: string | null;
}): {
  client: string;
  account: string;
  creative: string;
  finance: string;
  approvals: string;
  portal: string;
  onboarding: string;
  outreach: string;
} {
  const { clientId, invoiceId, outreachId } = input;
  return {
    client: `/clients/${clientId}`,
    account: `/account?clientId=${encodeURIComponent(clientId)}`,
    creative: `/creative?clientId=${encodeURIComponent(clientId)}`,
    finance: invoiceId
      ? `/finance?invoiceId=${encodeURIComponent(invoiceId)}`
      : "/finance",
    approvals: outreachId
      ? `/approvals?id=${encodeURIComponent(outreachId)}`
      : "/approvals",
    portal: "/portal/approvals",
    onboarding: "/portal/onboarding",
    outreach: outreachId
      ? `/crm/outreach?id=${encodeURIComponent(outreachId)}`
      : "/crm/outreach",
  };
}

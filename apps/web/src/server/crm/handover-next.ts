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
  /**
   * Magic-link verify path that lands on portal approvals (own single-use token).
   * Preferred over bare /portal/*.
   */
  portalPath?: string | null;
  /**
   * Magic-link verify path that lands on portal onboarding (own single-use token).
   * Must not share a token with portalPath — tokens are single-use.
   */
  onboardingPath?: string | null;
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
    campaignItemId,
    portalPath,
    onboardingPath,
  } = input;
  const portalMagic = portalPath?.trim() || null;
  const onboardingMagic = onboardingPath?.trim() || null;
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
  return {
    client: `/clients/${clientId}`,
    account: `/account?${accountQs.toString()}`,
    creative: `/creative?${creativeQs.toString()}`,
    finance: invoiceId
      ? `/finance?invoiceId=${encodeURIComponent(invoiceId)}`
      : "/finance",
    approvals: outreachId
      ? `/approvals?id=${encodeURIComponent(outreachId)}`
      : "/approvals",
    // Prefer minted invites so Hunt CTAs land in the won client's session
    // (bare /portal/* uses the wrong/dev portal actor or hits login).
    portal: portalMagic ?? "/portal/login",
    onboarding: onboardingMagic ?? "/portal/onboarding",
    outreach: outreachId
      ? `/crm/outreach?id=${encodeURIComponent(outreachId)}`
      : "/crm/outreach",
    campaigns: campaignItemId
      ? `/approvals?id=${encodeURIComponent(campaignItemId)}`
      : "/approvals",
  };
}

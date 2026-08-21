/**
 * Deep links for staff after won deal → OS handover.
 * Pure helper so unit tests can lock URL shapes without Postgres.
 */
import { withPortalNext } from "../../lib/portal-next";

export function buildHandoverNextLinks(input: {
  clientId: string;
  invoiceId?: string | null;
  outreachId?: string | null;
  /** Magic-link verify path from portal invite (preferred over bare /portal/*). */
  portalPath?: string | null;
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
  const { clientId, invoiceId, outreachId, portalPath } = input;
  const magic = portalPath?.trim() || null;
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
    // Prefer the mint invite so Hunt "Portal" lands in the won client's session
    // (bare /portal/approvals uses the wrong/dev portal actor or hits login).
    // Distinct `next` so Portal → approvals and Onboarding → checklist.
    portal: magic
      ? withPortalNext(magic, "/portal/approvals")
      : "/portal/login",
    onboarding: magic
      ? withPortalNext(magic, "/portal/onboarding")
      : "/portal/onboarding",
    outreach: outreachId
      ? `/crm/outreach?id=${encodeURIComponent(outreachId)}`
      : "/crm/outreach",
  };
}

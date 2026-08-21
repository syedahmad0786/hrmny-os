// Display types for the HITL approval inbox. The queue is assembled live from
// the leadgen (outreach) and campaigns routers — see page.tsx. No mock data.

export type ApprovalKind =
  | "outreach_send"
  | "campaign_publish"
  | "portal_item";

export const KIND_LABELS: Record<ApprovalKind, string> = {
  outreach_send: "Outreach send",
  campaign_publish: "Campaign publish",
  portal_item: "Portal item",
};

/** One row in the inbox, normalised from whichever router produced it. */
export type ApprovalItem = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  /** Human-facing target: recipient, channel, or client the action lands on. */
  target: string;
  agent: string;
  /** Secondary label — channel for campaigns/portal, channel for outreach. */
  meta: string;
  proposedAt: string;
  /** The content the agent wants to send/publish. */
  draft: string;
  /** Present for portal_item rows (pending vs client-rejected). */
  portalState?: "pending_client" | "rejected";
  /**
   * For edits, the prior copy the draft was derived from — rendered as a line
   * diff against `draft`. Omitted for net-new items (draft-only preview).
   */
  baseline?: string;
};

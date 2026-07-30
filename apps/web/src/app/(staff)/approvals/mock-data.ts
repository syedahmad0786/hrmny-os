// mock data — replace with tRPC hook when the `approvals` router lands (M8 HITL).
// Feed = agent_runs whose gate transition is pending human approval
// (outreach send, campaign publish, portal item). approve/reject each become a
// gate transition with an audit row; never an autonomous external send.

export type ApprovalKind =
  | "outreach_send"
  | "campaign_publish"
  | "portal_item";

export type ApprovalProposal = {
  id: string;
  kind: ApprovalKind;
  title: string;
  summary: string;
  /** Human-facing target: recipient, channel, or client the action lands on. */
  target: string;
  agent: string;
  model: string;
  costAed: number;
  proposedAt: string;
  /** The content the agent wants to send/publish. */
  draft: string;
  /**
   * For edits, the template/prior copy the draft was derived from — rendered as
   * a line diff against `draft`. Omitted for net-new items (draft-only preview).
   */
  baseline?: string;
};

export const KIND_LABELS: Record<ApprovalKind, string> = {
  outreach_send: "Outreach send",
  campaign_publish: "Campaign publish",
  portal_item: "Portal item",
};

const now = Date.now();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

const MOCK_QUEUE: readonly ApprovalProposal[] = [
  {
    id: "apr_01",
    kind: "outreach_send",
    title: "Intro email — Rana Khoury, Tejari Foods",
    summary:
      "BUAF 4/4. outreach-draft personalised the cold-intro template with the client's Q3 retail expansion.",
    target: "rana.khoury@tejarifoods.ae",
    agent: "outreach-draft",
    model: "anthropic/claude-sonnet-5",
    costAed: 0.42,
    proposedAt: minsAgo(8),
    baseline:
      "Hi {{first_name}},\n\nWe help UAE brands turn creative into measurable pipeline.\n\nWorth a quick call next week?\n\nBest,\nhrmny",
    draft:
      "Hi Rana,\n\nWe help UAE retail brands turn creative into measurable pipeline — congratulations on the Q3 expansion into Abu Dhabi.\n\nWorth a quick 15-minute call next Tuesday to walk through what a launch campaign could look like?\n\nBest,\nhrmny",
  },
  {
    id: "apr_02",
    kind: "campaign_publish",
    title: "LinkedIn post — Ramadan retail creative",
    summary:
      "creative agent drafted the launch post for the Tejari campaign. Publishes via Composio once approved.",
    target: "LinkedIn · Creative Harmony page",
    agent: "creative",
    model: "anthropic/claude-sonnet-5",
    costAed: 0.31,
    proposedAt: minsAgo(41),
    draft:
      "Ramadan is a season of connection — and of standout retail moments.\n\nThis year we partnered with Tejari Foods to bring their in-store experience to life across the UAE. Swipe to see the launch creative. ✨\n\n#RetailUAE #CreativeAgency #Ramadan2026",
  },
  {
    id: "apr_03",
    kind: "portal_item",
    title: "Portal approval request — March content calendar",
    summary:
      "Publish the March content calendar to the Tejari client portal for sign-off. Portal stays finance-free.",
    target: "Portal · Tejari Foods",
    agent: "creative",
    model: "anthropic/claude-haiku-4-5",
    costAed: 0.06,
    proposedAt: minsAgo(126),
    draft:
      "12 posts across LinkedIn + Instagram, 3 short-form videos, 1 launch email. First draft ready for client review; nothing goes live before portal approval.",
  },
];

export function useApprovalQueue(): readonly ApprovalProposal[] {
  return MOCK_QUEUE;
}

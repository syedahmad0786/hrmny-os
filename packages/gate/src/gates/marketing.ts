import type { GateFn } from "../types";

/**
 * Marketing / content gate sets (M8 outreach, M9 campaigns + portal approvals).
 * Same propose → approve → act shape as invoice.ts: a legal-transition gate
 * enforces the state machine, and an approve-before-act gate makes the external
 * side effect (send / publish) impossible without a prior human approve.
 * AI proposes; the gate disposes — no autonomous send or publish through M12.
 */

/** ── M8: outreach send ─────────────────────────────────────────────── */

export const OUTREACH_TRANSITIONS: Record<string, string[]> = {
  draft: ["approved", "discarded"],
  approved: ["sent", "draft", "discarded"],
  sent: [],
  discarded: [],
};

export const outreachLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = OUTREACH_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "outreach.legal_transition",
      reason: `Illegal outreach transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};

/** Send requires prior human approve — never auto-send (MASTER: HITL through M12). */
export const outreachApproveBeforeSendGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "sent") return null;
  if (entity.state !== "approved") {
    return {
      gate: "outreach.approve_before_send",
      reason: "Outreach must be human-approved before send",
    };
  }
  return null;
};

/** ── M9: campaign publish ──────────────────────────────────────────── */

export const CAMPAIGN_TRANSITIONS: Record<string, string[]> = {
  draft: ["approved", "archived"],
  approved: ["published", "draft", "archived"],
  published: ["archived"],
  archived: [],
};

export const campaignLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = CAMPAIGN_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "campaign.legal_transition",
      reason: `Illegal campaign transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};

/** Publish requires prior approve (staff draft-approve; client approve is portal_item). */
export const campaignApproveBeforePublishGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "published") return null;
  if (entity.state !== "approved") {
    return {
      gate: "campaign.approve_before_publish",
      reason: "Campaign item must be approved before publish",
    };
  }
  return null;
};

/** ── M9: portal item client approval ───────────────────────────────── */

export const PORTAL_ITEM_TRANSITIONS: Record<string, string[]> = {
  pending_client: ["approved", "rejected"],
  approved: [],
  rejected: ["pending_client"],
};

export const portalItemLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = PORTAL_ITEM_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "portal_item.legal_transition",
      reason: `Illegal portal item transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};

/** Approve/reject is the client's decision — a staff actor cannot self-approve. */
export const portalItemClientApproverGate: GateFn = async ({ actor, request }) => {
  if (request.to !== "approved" && request.to !== "rejected") return null;
  if (!actor.roles.includes("portal")) {
    return {
      gate: "portal_item.client_approver",
      reason: "Only the client (portal actor) may approve or reject portal items",
    };
  }
  return null;
};

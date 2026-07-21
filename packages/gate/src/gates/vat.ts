import type { GateFn } from "../types";

/**
 * VAT month-close: unread finance docs block close (MASTER §6.10).
 * Entity type: vat_period — state open | closed.
 */
export const VAT_TRANSITIONS: Record<string, string[]> = {
  open: ["closed"],
  closed: [],
};

export const vatLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = VAT_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "vat.legal_transition",
      reason: `Illegal VAT transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};

export const vatUnreadDocsGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "closed") return null;
  const unread = (entity.data.unreadDocIds as string[] | undefined) ?? [];
  if (unread.length > 0) {
    return {
      gate: "vat.unread_docs",
      reason: `VAT close blocked — ${unread.length} unread finance doc(s)`,
    };
  }
  return null;
};

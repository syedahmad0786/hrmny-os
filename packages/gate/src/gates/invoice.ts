import type { GateFn } from "../types";

/** Invoice status edges for propose → approve → issue (post to Xero). */
export const INVOICE_TRANSITIONS: Record<string, string[]> = {
  /** draft→approved: human-created retainer/progress invoices (M5). */
  draft: ["proposed", "approved", "void"],
  proposed: ["approved", "draft", "void"],
  approved: ["issued", "void"],
  issued: ["paid", "void"],
  paid: [],
  void: [],
};

export const invoiceLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = INVOICE_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "invoice.legal_transition",
      reason: `Illegal invoice transition ${entity.state} → ${request.to}`,
    };
  }
  return null;
};

/** Unknown TRN must stay held — never invent a TRN on approve/issue. */
export const invoiceTrnHoldGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "approved" && request.to !== "issued") return null;
  const trnStatus = entity.data.trnStatus ?? request.payload?.trnStatus;
  const trn = entity.data.trn ?? request.payload?.trn;
  if (trnStatus === "unknown_held" || trn === null) {
    const override = request.payload?.forceUnknownTrnIssue === true;
    if (request.to === "issued" && !override) {
      return {
        gate: "invoice.trn_hold",
        reason: "Unknown TRN held — cannot issue/post until TRN known (never guessed)",
      };
    }
  }
  return null;
};

/** Issue requires prior human approve (status approved). */
export const invoiceApproveBeforeIssueGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "issued") return null;
  if (entity.state !== "approved") {
    return {
      gate: "invoice.approve_before_post",
      reason: "Propose-approve-post: invoice must be approved before Xero post",
    };
  }
  return null;
};

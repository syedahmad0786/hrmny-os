/**
 * Shared OS invoice approve / issue (propose → approve → issue).
 * Used by staff tRPC (`invoices.approve` / `invoices.issue`) and agent tools
 * (`finance.os_approve` / `finance.os_issue`). OS-only issue when Xero write
 * is disabled — never invents a live Xero post.
 */
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
  type EntitySnapshot,
} from "@hrmny/gate";
import { isXeroWriteEnabled } from "@hrmny/integrations";
import { getDemoStore, type DemoInvoice } from "../demo-store";
import { getDb } from "../db";
import { resolveTaxRegistration } from "./tax-registration";

bootstrapGateRegistry();

export type OsInvoiceActor = {
  employeeId: string;
  roles?: string[];
  permissions?: string[];
};

export type OsInvoiceActionResult = {
  ok: boolean;
  reason?: string;
  invoice: DemoInvoice | null;
  xeroWrite?: boolean;
};

function actorFrom(input: OsInvoiceActor): ActorContext {
  return {
    employeeId: input.employeeId,
    roles: input.roles?.length
      ? input.roles
      : ["partner", "finance", "director"],
    permissions: input.permissions ?? [],
  };
}

async function loadInvoice(invoiceId: string): Promise<DemoInvoice | null> {
  const store = getDemoStore();
  let inv = store.invoices.get(invoiceId) ?? null;
  if (inv) return inv;
  if (!getDb()) return null;
  const { getOsInvoice } = await import("./os-invoices");
  const row = await getOsInvoice(invoiceId);
  if (!row) return null;
  const taxRegistration = resolveTaxRegistration();
  inv = {
    invoiceId: row.invoiceId,
    status: row.status,
    contactName: row.contactName,
    amount: row.amount,
    vatAmount: row.vatAmount ?? "0",
    currency: row.currency,
    invoiceType: row.invoiceType,
    billingKind: (row.billingKind as DemoInvoice["billingKind"]) ?? "retainer",
    clientId: row.clientId,
    period: row.period,
    trn: row.trn ?? taxRegistration.trn,
    trnStatus:
      (row.trnStatus as DemoInvoice["trnStatus"]) ??
      taxRegistration.trnStatus,
    ruleCited: row.ruleCited,
    sourceAttached: row.sourceAttached,
    xeroInvoiceId: row.xeroInvoiceId,
    proposedByEmployeeId: row.proposedByEmployeeId,
    approvedByEmployeeId: row.approvedByEmployeeId,
    createdAt: row.createdAt,
  };
  store.invoices.set(invoiceId, inv);
  return inv;
}

async function runInvoiceTransition(
  inv: DemoInvoice,
  to: string,
  actor: OsInvoiceActor,
  apply: (to: string) => void,
) {
  const store = getDemoStore();
  const entity: EntitySnapshot = {
    entityType: "invoice",
    entityId: inv.invoiceId,
    state: inv.status,
    data: { ...inv },
  };
  return transition(actorFrom(actor), entity, { to, from: inv.status }, {
    authorize: async (a) =>
      a.roles.some((r) =>
        ["partner", "finance", "hr", "director", "am"].includes(r),
      ),
    apply: async ({ request }) => {
      apply(request.to);
      return {
        ...entity,
        state: request.to,
        data: { ...inv },
      };
    },
    audit: async (event) => {
      const row = store.appendAudit({
        actorEmployeeId: event.actorEmployeeId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        before: event.before,
        after: event.after,
        reason: event.reason ?? null,
      });
      return { auditId: row.auditEventId };
    },
    emit: async (event) => {
      store.pushHealth("invoice_transition", "info", event.payload);
    },
  });
}

/** proposed|draft → approved */
export async function approveOsInvoice(input: {
  invoiceId: string;
  actor: OsInvoiceActor;
}): Promise<OsInvoiceActionResult> {
  const inv = await loadInvoice(input.invoiceId);
  if (!inv) return { ok: false, reason: "NOT_FOUND", invoice: null };

  const result = await runInvoiceTransition(
    inv,
    "approved",
    input.actor,
    (to) => {
      inv.status = to;
      inv.approvedByEmployeeId = input.actor.employeeId;
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      reason: result.blockedBy?.[0]?.reason ?? "GATE_BLOCKED",
      invoice: inv,
    };
  }
  if (getDb()) {
    const { updateOsInvoice } = await import("./os-invoices");
    await updateOsInvoice({
      invoiceId: inv.invoiceId,
      status: "approved",
      approvedByEmployeeId: input.actor.employeeId,
    });
  }
  return { ok: true, invoice: inv };
}

/** approved → issued (OS-only when Xero write disabled) */
export async function issueOsInvoice(input: {
  invoiceId: string;
  actor: OsInvoiceActor;
}): Promise<OsInvoiceActionResult> {
  const inv = await loadInvoice(input.invoiceId);
  if (!inv) return { ok: false, reason: "NOT_FOUND", invoice: null };

  const result = await runInvoiceTransition(inv, "issued", input.actor, () => {
    /* applied after Xero / OS-only path */
  });
  if (!result.ok) {
    return {
      ok: false,
      reason: result.blockedBy?.[0]?.reason ?? "GATE_BLOCKED",
      invoice: inv,
    };
  }

  const store = getDemoStore();

  if (!isXeroWriteEnabled()) {
    inv.status = "issued";
    inv.xeroInvoiceId = null;
    if (getDb()) {
      const { updateOsInvoice } = await import("./os-invoices");
      const { writeAudit } = await import("../m1-persistence");
      await updateOsInvoice({
        invoiceId: inv.invoiceId,
        status: "issued",
        clearXeroInvoiceId: true,
      });
      await writeAudit({
        actorEmployeeId: input.actor.employeeId,
        action: "invoices.issue.os_only",
        entityType: "invoice",
        entityId: inv.invoiceId,
        before: { status: "approved" },
        after: { status: "issued", xeroInvoiceId: null, xeroWrite: false },
        reason:
          "Marked issued in OS only — Xero is read/mirror source of truth",
      });
    } else {
      store.appendAudit({
        actorEmployeeId: input.actor.employeeId,
        action: "invoices.issue.os_only",
        entityType: "invoice",
        entityId: inv.invoiceId,
        before: { status: "approved" },
        after: { status: "issued", xeroInvoiceId: null, xeroWrite: false },
        reason:
          "Marked issued in OS only — Xero is read/mirror source of truth",
      });
    }
    return { ok: true, invoice: inv, xeroWrite: false };
  }

  const posted = await store.xero.createInvoice({
    invoiceId: inv.invoiceId,
    contactName: inv.contactName,
    amount: inv.amount,
    vatAmount: inv.vatAmount,
    currency: inv.currency,
    sourceAttached: inv.sourceAttached ?? undefined,
    trn: inv.trn,
  });
  inv.status = "issued";
  inv.xeroInvoiceId = posted.xeroInvoiceId;
  if (getDb()) {
    const { updateOsInvoice } = await import("./os-invoices");
    const { writeAudit } = await import("../m1-persistence");
    await updateOsInvoice({
      invoiceId: inv.invoiceId,
      status: "issued",
      xeroInvoiceId: posted.xeroInvoiceId,
    });
    await writeAudit({
      actorEmployeeId: input.actor.employeeId,
      action: "invoices.issue.xero_post",
      entityType: "invoice",
      entityId: inv.invoiceId,
      before: { status: "approved" },
      after: { status: "issued", xeroInvoiceId: posted.xeroInvoiceId },
      reason: "Posted to Xero with source attached (never disburse)",
    });
  } else {
    store.appendAudit({
      actorEmployeeId: input.actor.employeeId,
      action: "invoices.issue.xero_post",
      entityType: "invoice",
      entityId: inv.invoiceId,
      before: { status: "approved" },
      after: { status: "issued", xeroInvoiceId: posted.xeroInvoiceId },
      reason: "Posted to Xero with source attached (never disburse)",
    });
  }
  return { ok: true, invoice: inv, xeroWrite: true };
}

/** Parse a UUID from agent/chat prompts (`invoiceId: …` or bare UUID). */
export function parseInvoiceIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /invoice(?:Id)?\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  const bare = prompt.match(
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  );
  return bare?.[1]?.toLowerCase() ?? null;
}

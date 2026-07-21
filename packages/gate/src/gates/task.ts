import type { GateFn } from "../types";

/**
 * Unified 11-state creative/delivery machine (task_status_enum).
 * QC sits at index 5 (`qc`) — blocks client-facing until internal approve.
 */
export const TASK_STATUSES = [
  "backlog",
  "briefing",
  "brief_ready",
  "in_production",
  "internal_review",
  "qc",
  "client_review",
  "revisions",
  "approved",
  "delivered",
  "archived",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_TRANSITIONS: Record<string, string[]> = {
  backlog: ["briefing"],
  briefing: ["brief_ready", "backlog"],
  brief_ready: ["in_production", "briefing"],
  in_production: ["internal_review", "brief_ready"],
  internal_review: ["qc", "in_production"],
  qc: ["client_review", "internal_review", "revisions"],
  client_review: ["revisions", "approved"],
  revisions: ["internal_review", "qc"],
  approved: ["delivered"],
  delivered: ["archived"],
  archived: [],
};

/** Client-facing states — require QC pass to enter. */
export const CLIENT_FACING_STATES = new Set([
  "client_review",
  "approved",
  "delivered",
]);

export const taskLegalTransitionGate: GateFn = async ({ entity, request }) => {
  const allowed = TASK_TRANSITIONS[entity.state] ?? [];
  if (!allowed.includes(request.to)) {
    return {
      gate: "task.legal_transition",
      reason: `Illegal task transition ${entity.state} → ${request.to}. Allowed: [${allowed.join(", ") || "none"}]`,
    };
  }
  return null;
};

/**
 * Creative QC@state5: leaving `qc` toward client-facing requires
 * `qcPassed` (or director waive) on entity data / payload.
 */
export const taskQcGate: GateFn = async ({ entity, request }) => {
  const enteringClient =
    CLIENT_FACING_STATES.has(request.to) &&
    (entity.state === "qc" || entity.state === "internal_review");
  if (!enteringClient) return null;

  const dataPassed = entity.data.qcPassed === true || entity.data.qc_passed === true;
  const payloadPassed =
    request.payload?.qcPassed === true || request.payload?.qc_passed === true;
  const waived =
    request.payload?.qcWaived === true || entity.data.qcWaived === true;

  if (!dataPassed && !payloadPassed && !waived) {
    return {
      gate: "task.creative_qc",
      reason:
        "Creative QC@state5 — client-facing blocked until internal QC approve (or waive)",
    };
  }
  return null;
};

/**
 * DoR start gate: cannot leave briefing→brief_ready / enter production
 * when brief has >2 required items missing.
 */
export const taskDorStartGate: GateFn = async ({ entity, request }) => {
  const starting =
    (entity.state === "briefing" && request.to === "brief_ready") ||
    (entity.state === "brief_ready" && request.to === "in_production") ||
    request.to === "in_production";
  if (!starting) return null;

  const missing = Number(
    entity.data.missingRequiredCount ??
      entity.data.missing_required_count ??
      request.payload?.missingRequiredCount ??
      0,
  );
  if (Number.isFinite(missing) && missing > 2) {
    return {
      gate: "task.dor",
      reason: `DoR incomplete — ${missing} required items missing (max 2 allowed to start)`,
    };
  }
  return null;
};

/** 4th client revision flags Design Lead — soft block unless acknowledged. */
export const taskRevisionBoundaryGate: GateFn = async ({ entity, request }) => {
  if (request.to !== "revisions" && entity.state !== "revisions") return null;
  const clientRevCount = Number(
    entity.data.clientRevisionCount ?? entity.data.client_revision_count ?? 0,
  );
  const ack =
    request.payload?.revisionBoundaryAck === true ||
    entity.data.revisionBoundaryAck === true;
  if (clientRevCount >= 3 && !ack) {
    return {
      gate: "task.revision_boundary",
      reason:
        "4th client revision — Design Lead acknowledgment required (revisionBoundaryAck)",
    };
  }
  return null;
};

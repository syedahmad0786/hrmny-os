import { randomUUID } from "node:crypto";
import { getDemoStore, type DemoTask } from "./demo-store";

/** Cross-system seam event names (Inngest-style stub). */
export type SeamName =
  | "deal.won"
  | "brief.lock"
  | "creative.approved"
  | "hire.packet_complete";

export type SeamEvent = {
  eventId: string;
  name: SeamName;
  /** Idempotency key — re-drive with same key is a no-op. */
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: string;
  applied: boolean;
  result: Record<string, unknown> | null;
};

export type SeamDriveResult = {
  ok: true;
  duplicate: boolean;
  event: SeamEvent;
};

function ensureTaskTitle(briefId: string, taskId: string): string {
  return `Creative from brief ${briefId.slice(0, 8)} → ${taskId.slice(0, 8)}`;
}

/**
 * Apply seam side-effects into the demo store.
 * Idempotent: same `idempotencyKey` returns the prior event without re-applying.
 */
export function driveSeam(
  name: SeamName,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): SeamDriveResult {
  const store = getDemoStore();
  const existing = store.seamOutbox.find(
    (e) => e.idempotencyKey === idempotencyKey,
  );
  if (existing) {
    return {
      ok: true,
      duplicate: true,
      event: existing as SeamEvent,
    };
  }

  const event: SeamEvent = {
    eventId: randomUUID(),
    name,
    idempotencyKey,
    payload,
    createdAt: new Date().toISOString(),
    applied: false,
    result: null,
  };

  let result: Record<string, unknown> = {};

  if (name === "brief.lock") {
    result = applyBriefLock(payload);
  } else if (name === "creative.approved") {
    result = applyCreativeApproved(payload);
  } else if (name === "deal.won") {
    result = { noted: true, clientId: payload.clientId ?? null };
  } else if (name === "hire.packet_complete") {
    result = { noted: true, employeeId: payload.employeeId ?? null };
  }

  event.applied = true;
  event.result = result;
  store.seamOutbox.unshift(event);
  store.appendAudit({
    actorEmployeeId:
      (payload.actorEmployeeId as string) ??
      "00000000-0000-4000-8000-000000000000",
    action: `seams.${name}`,
    entityType: "seam_event",
    entityId: event.eventId,
    before: null,
    after: { idempotencyKey, result, duplicate: false },
    reason: null,
  });
  store.pushHealth(`seam.${name}`, "info", { idempotencyKey, result });

  return { ok: true, duplicate: false, event };
}

function applyBriefLock(payload: Record<string, unknown>): Record<string, unknown> {
  const store = getDemoStore();
  const briefId = String(payload.briefId ?? "");
  const taskId = String(payload.taskId ?? "");
  const clientId = String(payload.clientId ?? "");
  const brief = store.briefs.get(briefId);
  const sourceTask = store.tasks.get(taskId);

  if (!brief || !sourceTask) {
    return { spawned: false, reason: "brief_or_task_missing" };
  }

  // Prefer updating the linked DoR task; spawn a sibling creative task once.
  const spawnKey = `spawn:${briefId}`;
  const already = [...store.tasks.values()].find(
    (t) => t.briefId === briefId && t.taskType === "creative_spawn",
  );
  if (already) {
    already.status = "brief_ready";
    store.clientDeliveryStatus.set(clientId, {
      clientId,
      status: "brief_locked",
      updatedAt: new Date().toISOString(),
      lastSeam: "brief.lock",
    });
    return {
      spawned: false,
      taskId: already.taskId,
      status: already.status,
      reuse: true,
    };
  }

  const spawned: DemoTask = {
    taskId: randomUUID(),
    clientId: clientId || sourceTask.clientId,
    calendarId: sourceTask.calendarId,
    month: sourceTask.month,
    taskType: "creative_spawn",
    title: ensureTaskTitle(briefId, taskId),
    status: "brief_ready",
    situationalState: null,
    ownerEmployeeId: null,
    deadline: sourceTask.deadline,
    priority: sourceTask.priority,
    qcPassed: false,
    qcNotes: null,
    clientRevisionCount: 0,
    revisionBoundaryAck: false,
    briefId,
  };
  store.tasks.set(spawned.taskId, spawned);
  sourceTask.status = "brief_ready";
  store.clientDeliveryStatus.set(spawned.clientId, {
    clientId: spawned.clientId,
    status: "brief_locked",
    updatedAt: new Date().toISOString(),
    lastSeam: "brief.lock",
    spawnKey,
  });
  return {
    spawned: true,
    taskId: spawned.taskId,
    status: spawned.status,
  };
}

function applyCreativeApproved(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const store = getDemoStore();
  const taskId = String(payload.taskId ?? "");
  const assetId = payload.assetId ? String(payload.assetId) : null;
  const task = store.tasks.get(taskId);
  if (!task) {
    return { deliveryStatus: null, reason: "task_missing" };
  }

  // Do not force task.state here — gate transition remains source of truth.
  // Seam updates portal-visible delivery status (+ optional asset label).
  if (assetId) {
    const asset = store.assets.get(assetId);
    if (asset && asset.qcPassed) asset.status = "client_review";
  }

  const delivery = {
    clientId: task.clientId,
    status: "in_delivery" as const,
    updatedAt: new Date().toISOString(),
    lastSeam: "creative.approved" as const,
    taskId: task.taskId,
    assetId,
  };
  store.clientDeliveryStatus.set(task.clientId, delivery);
  return {
    deliveryStatus: delivery.status,
    taskId: task.taskId,
    taskStatus: task.status,
    assetId,
  };
}

export function listSeams(limit = 25): SeamEvent[] {
  return getDemoStore().seamOutbox.slice(0, limit) as SeamEvent[];
}

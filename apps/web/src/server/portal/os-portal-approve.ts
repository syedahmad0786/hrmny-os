/**
 * Shared portal approve/reject for agent `portal.os_approve`.
 * Completes client_review → approved (or reject → revisions) without
 * magic-link / Resend — staff/demo actor path for closed-loop demos.
 */
import { actOnPortalApproval } from "../portal-data";
import { getDemoStore } from "../demo-store";
import { getDb } from "../db";

export type OsPortalApproveResult = {
  ok: boolean;
  reason?: string;
  approvalId?: string;
  clientId?: string;
  status?: string;
  action?: "approve" | "reject";
};

export function parseApprovalIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /(?:approval(?:Id)?|task(?:Id)?|portal)\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  const bare = prompt.match(
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  );
  return bare?.[1]?.toLowerCase() ?? null;
}

function parseAction(prompt: string): "approve" | "reject" {
  if (/\breject\b|\bdeny\b|\brevisions?\b/i.test(prompt)) return "reject";
  return "approve";
}

async function resolveClientId(
  approvalId: string,
): Promise<string | null> {
  const store = getDemoStore();
  const pending = store.portalApprovals.get(approvalId);
  if (pending) return pending.clientId;
  const task = store.tasks.get(approvalId);
  if (task) return task.clientId;

  if (!getDb()) return null;
  const { getDeliveryTask } = await import("../tasks/delivery-tasks");
  const durable = await getDeliveryTask(approvalId);
  return durable?.clientId ?? null;
}

/**
 * Ensure memory-mode portalApprovals has a pending row for a client_review
 * task (keyed by taskId) so actOnPortalApproval can find it.
 */
export function ensureMemoryPortalApproval(input: {
  taskId: string;
  clientId: string;
  title: string;
}): string {
  const store = getDemoStore();
  const existing = [...store.portalApprovals.values()].find(
    (a) =>
      a.clientId === input.clientId &&
      a.status === "pending" &&
      (a.approvalId === input.taskId ||
        store.assets.get(a.entityId)?.taskId === input.taskId),
  );
  if (existing) return existing.approvalId;

  let asset = [...store.assets.values()].find((a) => a.taskId === input.taskId);
  if (!asset) {
    asset = store.createAsset(input.title, input.clientId, input.taskId);
  }
  asset.status = "client_review";
  store.portalApprovals.set(input.taskId, {
    approvalId: input.taskId,
    clientId: input.clientId,
    title: input.title,
    kind: "asset",
    status: "pending",
    entityId: asset.assetId,
    slaHours: 48,
    createdAt: new Date().toISOString(),
  });
  return input.taskId;
}

export async function runOsPortalApprove(input: {
  approvalId: string;
  prompt: string;
  actorEmployeeId: string;
}): Promise<OsPortalApproveResult> {
  const action = parseAction(input.prompt);
  const clientId = await resolveClientId(input.approvalId);
  if (!clientId) {
    return { ok: false, reason: "NOT_FOUND" };
  }

  if (!getDb()) {
    ensureMemoryPortalApproval({
      taskId: input.approvalId,
      clientId,
      title:
        getDemoStore().tasks.get(input.approvalId)?.title ??
        "Portal creative approval",
    });
  }

  try {
    const result = await actOnPortalApproval({
      clientId,
      approvalId: input.approvalId,
      action,
      feedback: input.prompt.trim().slice(0, 400) || undefined,
      actorEmployeeId: input.actorEmployeeId,
    });
    return {
      ok: true,
      approvalId: input.approvalId,
      clientId,
      status: result.status,
      action,
    };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "portal_approve_failed",
      approvalId: input.approvalId,
      clientId,
      action,
    };
  }
}

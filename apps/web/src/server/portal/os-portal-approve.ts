/**
 * Synthetic pending-request fixture plus a fail-closed compatibility shim.
 * Employees and agents can prepare work for client review, but cannot record
 * the client's approve/reject decision.
 */
import { getDemoStore } from "../demo-store";
import {
  CLIENT_PORTAL_ACTOR_REQUIRED,
  portalApprovalSyntheticRuntimeEnabled,
} from "./approval-boundary";

export type OsPortalApproveResult = {
  ok: false;
  reason: string;
  approvalId: string;
};

/**
 * Create a pending synthetic review request after QC. This helper is not
 * routable and is available only in the exact dev + memory + sandbox runtime.
 */
export function ensureSyntheticPortalApprovalRequest(input: {
  taskId: string;
  clientId: string;
  title: string;
}): string {
  if (!portalApprovalSyntheticRuntimeEnabled()) {
    throw new Error("PORTAL_SYNTHETIC_FIXTURE_DISABLED");
  }

  const store = getDemoStore();
  const existing = [...store.portalApprovals.values()].find(
    (approval) =>
      approval.clientId === input.clientId &&
      approval.status === "pending" &&
      (approval.approvalId === input.taskId ||
        store.assets.get(approval.entityId)?.taskId === input.taskId),
  );
  if (existing) return existing.approvalId;

  let asset = [...store.assets.values()].find(
    (candidate) => candidate.taskId === input.taskId,
  );
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

/**
 * Compatibility shim for stale direct imports. It deliberately performs no
 * lookup, fixture creation, mutation, notification, seam, or provider call.
 */
export async function runOsPortalApprove(input: {
  approvalId: string;
  prompt: string;
  actorEmployeeId: string;
}): Promise<OsPortalApproveResult> {
  void input.prompt;
  void input.actorEmployeeId;
  return {
    ok: false,
    reason: CLIENT_PORTAL_ACTOR_REQUIRED,
    approvalId: input.approvalId,
  };
}

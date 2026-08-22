/**
 * Shared brief lock + creative_spawn for agent `briefs.os_lock`.
 * Mirrors Traffic UI `briefs.lock` (DoR gate → lock → seam spawn).
 * No Canva / LinkedIn secrets required.
 */
import { dorLockBlockedReason, validateDor } from "@hrmny/gate";
import { getDemoStore } from "../demo-store";
import { getDb } from "../db";
import { driveSeam, driveSeamAsync } from "../seams";
import {
  getDeliveryBrief,
  getDeliveryBriefByTask,
  getDeliveryTask,
  lockDeliveryBrief,
} from "./delivery-tasks";

export type OsBriefLockResult = {
  ok: boolean;
  reason?: string;
  code?: "GATE_BLOCKED" | "NOT_FOUND" | "BRIEF_ID_REQUIRED" | "CLIENT_MISMATCH";
  briefId?: string;
  taskId?: string;
  clientId?: string;
  taskStatus?: string;
  spawnedTaskId?: string | null;
  reuse?: boolean;
  seamEventId?: string | null;
};

export function parseBriefIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /(?:brief(?:Id)?)\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1]!.toLowerCase();
  return null;
}

async function resolveBriefId(input: {
  prompt: string;
  briefId?: string | null;
  taskId?: string | null;
}): Promise<string | null> {
  if (input.briefId) return input.briefId;
  const fromPrompt = parseBriefIdFromPrompt(input.prompt);
  if (fromPrompt) return fromPrompt;
  if (input.taskId) {
    const durable = await getDeliveryBriefByTask(input.taskId);
    if (durable) return durable.briefId;
    const store = getDemoStore();
    const mem = [...store.briefs.values()].find(
      (b) => b.taskId === input.taskId,
    );
    if (mem) return mem.briefId;
  }
  const bare = input.prompt.match(
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  );
  return bare?.[1]?.toLowerCase() ?? null;
}

export async function runOsBriefLock(input: {
  prompt: string;
  actorEmployeeId: string;
  briefId?: string | null;
  taskId?: string | null;
  /** When set, brief's source task must belong to this client sandbox. */
  clientId?: string | null;
}): Promise<OsBriefLockResult> {
  const briefId = await resolveBriefId(input);
  if (!briefId) {
    return {
      ok: false,
      code: "BRIEF_ID_REQUIRED",
      reason: "briefId_required",
    };
  }

  const getBrief = getDeliveryBrief;
  const getTask = getDeliveryTask;
  const lockBrief = lockDeliveryBrief;
  const seamSync = driveSeam;
  const seamAsync = driveSeamAsync;

  if (getDb()) {
    const durable = await getBrief(briefId);
    if (!durable) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: "brief_not_found",
        briefId,
      };
    }
    const sourceTask = await getTask(durable.taskId);
    if (!sourceTask) {
      return {
        ok: false,
        code: "NOT_FOUND",
        reason: "task_not_found",
        briefId,
      };
    }
    if (input.clientId && sourceTask.clientId !== input.clientId) {
      return {
        ok: false,
        code: "CLIENT_MISMATCH",
        reason: "brief_outside_client_sandbox",
        briefId,
        clientId: sourceTask.clientId,
      };
    }
    const dor = validateDor(durable.body);
    const blocked = dorLockBlockedReason(dor);
    if (blocked) {
      return {
        ok: false,
        code: "GATE_BLOCKED",
        reason: blocked,
        briefId,
        taskId: durable.taskId,
        clientId: sourceTask.clientId,
      };
    }
    const locked = await lockBrief({
      briefId,
      dorComplete: dor.dorComplete,
      missingRequiredCount: dor.missingRequiredCount,
    });
    if (!locked) {
      return { ok: false, code: "NOT_FOUND", reason: "lock_failed", briefId };
    }
    const seam = await seamAsync(
      "brief.lock",
      `brief.lock:${locked.brief.briefId}`,
      {
        briefId: locked.brief.briefId,
        taskId: locked.brief.taskId,
        clientId: sourceTask.clientId,
        actorEmployeeId: input.actorEmployeeId,
        durableSpawnTaskId: locked.spawnedTaskId,
        durableReuse: locked.reuse,
      },
    );
    return {
      ok: true,
      briefId: locked.brief.briefId,
      taskId: locked.brief.taskId,
      clientId: sourceTask.clientId,
      taskStatus: "brief_ready",
      spawnedTaskId: locked.spawnedTaskId,
      reuse: locked.reuse,
      seamEventId: seam.event.eventId,
    };
  }

  const store = getDemoStore();
  const brief = store.briefs.get(briefId);
  if (!brief) {
    return {
      ok: false,
      code: "NOT_FOUND",
      reason: "brief_not_found",
      briefId,
    };
  }
  const task = store.tasks.get(brief.taskId);
  if (!task) {
    return {
      ok: false,
      code: "NOT_FOUND",
      reason: "task_not_found",
      briefId,
    };
  }
  if (input.clientId && task.clientId !== input.clientId) {
    return {
      ok: false,
      code: "CLIENT_MISMATCH",
      reason: "brief_outside_client_sandbox",
      briefId,
      clientId: task.clientId,
    };
  }
  const dor = validateDor(brief.body);
  brief.missingRequiredCount = dor.missingRequiredCount;
  brief.missing = [...dor.missing];
  brief.dorComplete = dor.dorComplete;
  const blocked = dorLockBlockedReason(dor);
  if (blocked) {
    return {
      ok: false,
      code: "GATE_BLOCKED",
      reason: blocked,
      briefId,
      taskId: brief.taskId,
      clientId: task.clientId,
    };
  }
  brief.lockedAt = new Date().toISOString();
  task.status = "brief_ready";
  store.pushHealth("brief.dor_complete", "info", {
    briefId: brief.briefId,
    taskId: task.taskId,
  });
  const seam = seamSync("brief.lock", `brief.lock:${brief.briefId}`, {
    briefId: brief.briefId,
    taskId: brief.taskId,
    clientId: task.clientId,
    actorEmployeeId: input.actorEmployeeId,
  });
  store.appendAudit({
    actorEmployeeId: input.actorEmployeeId,
    action: "briefs.os_lock",
    entityType: "brief",
    entityId: brief.briefId,
    before: null,
    after: {
      lockedAt: brief.lockedAt,
      taskStatus: "brief_ready",
      seamEventId: seam.event.eventId,
      seamDuplicate: seam.duplicate,
    },
    reason: null,
  });
  const spawnedTaskId =
    typeof seam.event.result?.taskId === "string"
      ? seam.event.result.taskId
      : null;
  return {
    ok: true,
    briefId: brief.briefId,
    taskId: brief.taskId,
    clientId: task.clientId,
    taskStatus: "brief_ready",
    spawnedTaskId,
    reuse: seam.event.result?.reuse === true,
    seamEventId: seam.event.eventId,
  };
}

/**
 * Shared creative QC pass/fail/waive for agent `creative.os_qc`.
 * Mirrors staff Creative UI `passThenAdvance`: QC then qc → client_review
 * so portal approvals can list the task. No live Canva required.
 */
import {
  bootstrapGateRegistry,
  transition,
  type ActorContext,
  type EntitySnapshot,
} from "@hrmny/gate";
import { getDemoStore, type DemoTask } from "../demo-store";
import { getDb } from "../db";

bootstrapGateRegistry();

export type OsCreativeQcResult = {
  ok: boolean;
  reason?: string;
  task: {
    taskId: string;
    clientId: string;
    status: string;
    qcPassed: boolean;
    qcNotes: string | null;
    title: string;
  } | null;
  seamEventId?: string | null;
  advanced?: boolean;
};

export function parseTaskIdFromPrompt(prompt: string): string | null {
  const labeled = prompt.match(
    /(?:task(?:Id)?|creative)\s*[:=]\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  if (labeled?.[1]) return labeled[1].toLowerCase();
  const bare = prompt.match(
    /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/i,
  );
  return bare?.[1]?.toLowerCase() ?? null;
}

function parseDecision(prompt: string): "pass" | "fail" | "waive" {
  if (/\bwaive\b/i.test(prompt)) return "waive";
  if (/\bfail\b|\breject\b/i.test(prompt)) return "fail";
  return "pass";
}

function actorFor(employeeId: string): ActorContext {
  return {
    employeeId,
    roles: ["partner", "creative_director", "cd"],
    permissions: [],
  };
}

function taskSnapshot(task: DemoTask): EntitySnapshot {
  const waived = Boolean(
    (task as DemoTask & { qcWaived?: boolean }).qcWaived,
  );
  return {
    entityType: "task",
    entityId: task.taskId,
    state: task.status,
    data: {
      qcPassed: task.qcPassed,
      qcWaived: waived,
      clientRevisionCount: task.clientRevisionCount,
      revisionBoundaryAck: task.revisionBoundaryAck,
      missingRequiredCount: 0,
    },
  };
}

/** Mirror Creative UI: after QC pass/waive, advance qc → client_review. */
async function advanceToClientReview(input: {
  task: DemoTask;
  actorEmployeeId: string;
  durable: boolean;
}): Promise<{ ok: boolean; reason?: string; task: DemoTask }> {
  const { task, actorEmployeeId, durable } = input;
  if (task.status !== "qc") {
    return { ok: true, task };
  }
  const store = getDemoStore();
  const result = await transition(
    actorFor(actorEmployeeId),
    taskSnapshot(task),
    {
      to: "client_review",
      from: "qc",
      payload: { qcPassed: true },
    },
    {
      authorize: async () => true,
      apply: async ({ request }) => {
        if (durable) {
          const { updateDeliveryTaskStatus } = await import("./delivery-tasks");
          const updated = await updateDeliveryTaskStatus({
            taskId: task.taskId,
            status: request.to,
            qcPassed: true,
          });
          if (updated) {
            task.status = updated.status as DemoTask["status"];
            task.qcPassed = updated.qcPassed;
          } else {
            task.status = request.to as DemoTask["status"];
            task.qcPassed = true;
          }
        } else {
          task.status = request.to as DemoTask["status"];
          task.qcPassed = true;
          store.tasks.set(task.taskId, task);
        }
        return taskSnapshot(task);
      },
      audit: async (event) => {
        const row = store.appendAudit({
          actorEmployeeId: event.actorEmployeeId,
          action: event.action,
          entityType: event.entityType,
          entityId: event.entityId ?? task.taskId,
          before: event.before,
          after: event.after,
          reason: event.reason ?? null,
        });
        return { auditId: row.auditEventId };
      },
    },
  );
  if (!result.ok) {
    return {
      ok: false,
      reason: result.blockedBy?.[0]?.reason ?? "GATE_BLOCKED",
      task,
    };
  }
  // Gate apply mutates task.status; re-read as string so TS doesn't keep "qc".
  const advancedStatus = String(task.status);
  if (advancedStatus === "client_review" && !durable) {
    const { ensureSyntheticPortalApprovalRequest } = await import(
      "../portal/os-portal-approve"
    );
    ensureSyntheticPortalApprovalRequest({
      taskId: task.taskId,
      clientId: task.clientId,
      title: task.title,
    });
  }
  return { ok: true, task };
}

function resultFromTask(
  task: DemoTask,
  seamEventId: string | null,
  advanced: boolean,
): OsCreativeQcResult {
  return {
    ok: true,
    task: {
      taskId: task.taskId,
      clientId: task.clientId,
      status: task.status,
      qcPassed: task.qcPassed,
      qcNotes: task.qcNotes,
      title: task.title,
    },
    seamEventId,
    advanced,
  };
}

export async function runOsCreativeQc(input: {
  taskId: string;
  prompt: string;
  actorEmployeeId: string;
}): Promise<OsCreativeQcResult> {
  const decision = parseDecision(input.prompt);
  const notes =
    input.prompt.trim().slice(0, 500) ||
    (decision === "pass"
      ? "Agent QC pass"
      : decision === "waive"
        ? "Agent QC waive"
        : "Agent QC fail");

  if (getDb()) {
    const { getDeliveryTask, setDeliveryTaskQc } = await import(
      "./delivery-tasks"
    );
    const existing = await getDeliveryTask(input.taskId);
    if (!existing) {
      return { ok: false, reason: "NOT_FOUND", task: null };
    }
    const updated = await setDeliveryTaskQc({
      taskId: input.taskId,
      decision,
      notes,
    });
    if (!updated) return { ok: false, reason: "NOT_FOUND", task: null };

    const task: DemoTask = {
      taskId: updated.taskId,
      clientId: updated.clientId,
      calendarId: updated.calendarId,
      month: updated.month,
      taskType: updated.taskType,
      title: updated.title,
      status: updated.status as DemoTask["status"],
      situationalState: updated.situationalState,
      ownerEmployeeId: updated.ownerEmployeeId,
      deadline: updated.deadline,
      priority: updated.priority,
      qcPassed: updated.qcPassed,
      qcNotes: updated.qcNotes,
      clientRevisionCount: updated.clientRevisionCount,
      revisionBoundaryAck: updated.revisionBoundaryAck,
      briefId: updated.briefId,
    };
    if (decision === "waive") {
      (task as DemoTask & { qcWaived?: boolean }).qcWaived = true;
    }

    let seamEventId: string | null = null;
    if (task.qcPassed) {
      try {
        const { driveSeamAsync } = await import("../seams");
        const seam = await driveSeamAsync(
          "creative.qc_passed",
          `creative.qc_passed:${task.taskId}`,
          {
            taskId: task.taskId,
            assetId: null,
            clientId: task.clientId,
            actorEmployeeId: input.actorEmployeeId,
          },
        );
        seamEventId = seam?.event.eventId ?? null;
      } catch {
        /* seam best-effort */
      }
    }

    getDemoStore().appendAudit({
      actorEmployeeId: input.actorEmployeeId,
      action: "tasks.qc",
      entityType: "task",
      entityId: task.taskId,
      before: null,
      after: {
        decision,
        qcPassed: task.qcPassed,
        seamEventId,
        via: "creative.os_qc",
      },
      reason: notes,
    });

    let advanced = false;
    if (task.qcPassed) {
      const adv = await advanceToClientReview({
        task,
        actorEmployeeId: input.actorEmployeeId,
        durable: true,
      });
      if (!adv.ok) {
        return {
          ok: false,
          reason: adv.reason,
          task: {
            taskId: task.taskId,
            clientId: task.clientId,
            status: task.status,
            qcPassed: task.qcPassed,
            qcNotes: task.qcNotes,
            title: task.title,
          },
          seamEventId,
          advanced: false,
        };
      }
      advanced = task.status === "client_review";
    }

    return resultFromTask(task, seamEventId, advanced);
  }

  const store = getDemoStore();
  const task = store.tasks.get(input.taskId) as DemoTask | undefined;
  if (!task) return { ok: false, reason: "NOT_FOUND", task: null };

  task.qcPassed = decision === "pass" || decision === "waive";
  task.qcNotes = notes;
  if (decision === "waive") {
    (task as DemoTask & { qcWaived?: boolean }).qcWaived = true;
  }

  let seamEventId: string | null = null;
  if (task.qcPassed) {
    try {
      const { driveSeam } = await import("../seams");
      const asset = [...store.assets.values()].find(
        (a) => a.taskId === task.taskId,
      );
      const seam = driveSeam(
        "creative.qc_passed",
        `creative.qc_passed:${task.taskId}`,
        {
          taskId: task.taskId,
          assetId: asset?.assetId ?? null,
          clientId: task.clientId,
          actorEmployeeId: input.actorEmployeeId,
        },
      );
      seamEventId = seam?.event.eventId ?? null;
    } catch {
      /* seam best-effort */
    }
  }

  store.appendAudit({
    actorEmployeeId: input.actorEmployeeId,
    action: "tasks.qc",
    entityType: "task",
    entityId: task.taskId,
    before: null,
    after: {
      decision,
      qcPassed: task.qcPassed,
      seamEventId,
      via: "creative.os_qc",
    },
    reason: notes,
  });

  let advanced = false;
  if (task.qcPassed) {
    const adv = await advanceToClientReview({
      task,
      actorEmployeeId: input.actorEmployeeId,
      durable: false,
    });
    if (!adv.ok) {
      return {
        ok: false,
        reason: adv.reason,
        task: {
          taskId: task.taskId,
          clientId: task.clientId,
          status: task.status,
          qcPassed: task.qcPassed,
          qcNotes: task.qcNotes,
          title: task.title,
        },
        seamEventId,
        advanced: false,
      };
    }
    advanced = task.status === "client_review";
  }

  return resultFromTask(task, seamEventId, advanced);
}

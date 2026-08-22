/**
 * Shared creative QC pass/fail/waive for agent `creative.os_qc`.
 * Mirrors staff `tasks.qc` (memory + durable) without requiring live Canva.
 */
import { getDemoStore, type DemoTask } from "../demo-store";
import { getDb } from "../db";

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
    const task = await setDeliveryTaskQc({
      taskId: input.taskId,
      decision,
      notes,
    });
    if (!task) return { ok: false, reason: "NOT_FOUND", task: null };

    let seamEventId: string | null = null;
    if (task.qcPassed) {
      try {
        const { driveSeamAsync } = await import("../seams");
        const seam = await driveSeamAsync(
          "creative.approved",
          `creative.approved:${task.taskId}`,
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
    };
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
        "creative.approved",
        `creative.approved:${task.taskId}`,
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
  };
}

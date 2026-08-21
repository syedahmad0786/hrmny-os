import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { getDemoStore, type DemoTask } from "./demo-store";
import { getDb } from "./db";

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

let seamTableReady: Promise<void> | null = null;

async function ensureSeamOutboxTable(): Promise<void> {
  const db = getDb();
  if (!db) return;
  if (!seamTableReady) {
    seamTableReady = db
      .execute(sql`
        create table if not exists public.seam_outbox (
          event_id uuid primary key default gen_random_uuid(),
          name text not null,
          idempotency_key text not null unique,
          payload jsonb not null default '{}'::jsonb,
          result jsonb,
          applied boolean not null default false,
          created_at timestamptz not null default now()
        )
      `)
      .then(() => undefined)
      .catch(() => {
        seamTableReady = null;
      });
  }
  await seamTableReady;
}

type SeamRow = {
  event_id: string;
  name: string;
  idempotency_key: string;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  applied: boolean;
  created_at: Date | string;
};

function mapSeamRow(row: SeamRow): SeamEvent {
  return {
    eventId: row.event_id,
    name: row.name as SeamName,
    idempotencyKey: row.idempotency_key,
    payload: row.payload ?? {},
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
    applied: Boolean(row.applied),
    result: row.result,
  };
}

async function applyCreativeApprovedDurable(
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = getDb();
  if (!db) return { deliveryStatus: null, reason: "no_db" };
  const taskId = String(payload.taskId ?? "");
  const assetId = payload.assetId ? String(payload.assetId) : null;
  const clientId = payload.clientId ? String(payload.clientId) : null;

  if (assetId) {
    await db.execute(sql`
      update public.asset
      set status = 'client_review', updated_at = now()
      where asset_id = ${assetId}::uuid
        and status in ('draft', 'qc_passed', 'internal_review', 'client_review')
    `);
  }

  const tasks = taskId
    ? await db.execute<{ status: string; client_id: string }>(sql`
        select status, client_id from public.task
        where task_id = ${taskId}::uuid
        limit 1
      `)
    : [];
  const task = tasks[0];
  if (!task && !assetId) {
    return { deliveryStatus: null, reason: "task_missing" };
  }

  return {
    deliveryStatus: "in_delivery",
    taskId: taskId || null,
    taskStatus: task?.status ?? null,
    clientId: clientId || task?.client_id || null,
    assetId,
    durable: true,
  };
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

/**
 * Durable seam drive: Postgres outbox when DATABASE_URL is set; else demo-store.
 * Prefer this from async routers (briefs.lock, tasks.qc, seams.drive).
 */
export async function driveSeamAsync(
  name: SeamName,
  idempotencyKey: string,
  payload: Record<string, unknown>,
): Promise<SeamDriveResult> {
  const db = getDb();
  if (!db) return driveSeam(name, idempotencyKey, payload);

  await ensureSeamOutboxTable();

  const existing = await db.execute<SeamRow>(sql`
    select
      event_id, name, idempotency_key, payload, result, applied, created_at
    from public.seam_outbox
    where idempotency_key = ${idempotencyKey}
    limit 1
  `);
  if (existing[0]) {
    return {
      ok: true,
      duplicate: true,
      event: mapSeamRow(existing[0]),
    };
  }

  let result: Record<string, unknown> = {};
  if (name === "brief.lock") {
    // Durable lock already spawned via lockDeliveryBrief; record outcome.
    if (payload.durableSpawnTaskId) {
      result = {
        spawned: !payload.durableReuse,
        reuse: Boolean(payload.durableReuse),
        taskId: payload.durableSpawnTaskId,
        status: "brief_ready",
        durable: true,
      };
    } else {
      const demo = applyBriefLock(payload);
      result = { ...demo, durable: false };
    }
  } else if (name === "creative.approved") {
    result = await applyCreativeApprovedDurable(payload);
  } else if (name === "deal.won") {
    result = { noted: true, clientId: payload.clientId ?? null, durable: true };
  } else if (name === "hire.packet_complete") {
    result = {
      noted: true,
      employeeId: payload.employeeId ?? null,
      durable: true,
    };
  }

  const eventId = randomUUID();
  const createdAt = new Date().toISOString();
  await db.execute(sql`
    insert into public.seam_outbox (
      event_id, name, idempotency_key, payload, result, applied, created_at
    ) values (
      ${eventId}::uuid,
      ${name},
      ${idempotencyKey},
      ${JSON.stringify(payload)}::jsonb,
      ${JSON.stringify(result)}::jsonb,
      true,
      ${createdAt}::timestamptz
    )
    on conflict (idempotency_key) do nothing
  `);

  const event: SeamEvent = {
    eventId,
    name,
    idempotencyKey,
    payload,
    createdAt,
    applied: true,
    result,
  };

  // Mirror into process outbox for local listSeams without a second DB round-trip.
  const store = getDemoStore();
  store.seamOutbox.unshift(event);
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
    spawnKey: `spawn:${briefId}`,
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

export async function listSeams(limit = 25): Promise<SeamEvent[]> {
  const db = getDb();
  if (db) {
    await ensureSeamOutboxTable();
    try {
      const rows = await db.execute<SeamRow>(sql`
        select
          event_id, name, idempotency_key, payload, result, applied, created_at
        from public.seam_outbox
        order by created_at desc
        limit ${limit}
      `);
      if (rows.length) return rows.map(mapSeamRow);
    } catch {
      /* table may not exist yet on older deploys */
    }
  }
  return getDemoStore().seamOutbox.slice(0, limit) as SeamEvent[];
}

/** Resolve portal/DAM asset paths that are already absolute or data URIs. */
export function resolveDirectAssetUrl(
  storagePath: string,
  ttlSeconds: number,
): { url: string; expiresAt: string } | null {
  const path = storagePath.trim();
  if (
    path.startsWith("http://") ||
    path.startsWith("https://") ||
    path.startsWith("data:") ||
    path.startsWith("creative://") ||
    path.startsWith("memory://")
  ) {
    return {
      url: path,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }
  return null;
}

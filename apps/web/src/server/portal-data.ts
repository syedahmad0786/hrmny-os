import { sql } from "@hrmny/db";
import { DEMO_CLIENT_ID, getDemoStore } from "./demo-store";
import { getDb } from "./db";

const FINANCE_KEYS = new Set([
  "contractvalue",
  "deliverycost",
  "fee",
  "grossamount",
  "internalcost",
  "margin",
  "marginpct",
  "payroll",
  "revenuetodate",
  "xeroinvoiceid",
]);

export function assertPortalSafe(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertPortalSafe);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FINANCE_KEYS.has(key.toLowerCase().replace(/[_\-.]/g, ""))) {
      throw new Error(`PORTAL_FINANCE_LEAK: ${key}`);
    }
    assertPortalSafe(child);
  }
}

type PortalTask = {
  taskId: string;
  title: string;
  status: string;
  taskType: string;
  deadline: string | null;
  priority: string | null;
};

type PortalBrief = {
  briefId: string;
  taskId: string;
  title: string;
  lockedAt: Date | string | null;
  dorComplete: boolean;
  missingRequiredCount: number;
};

type PortalAsset = {
  assetId: string;
  title: string;
  status: string;
  versionCount: number;
};

type PortalApproval = {
  approvalId: string;
  title: string;
  kind: string;
  status: string;
  slaHours: number;
  entityId: string;
  createdAt: Date | string;
};

export type PortalWorkspace = {
  clientId: string;
  clientName: string;
  briefs: PortalBrief[];
  tasks: PortalTask[];
  assets: PortalAsset[];
  approvals: PortalApproval[];
  delivery: {
    clientId: string;
    deliveryStatus: string;
    lastSeam: string | null;
    updatedAt: Date | string | null;
    deliverables: Array<{
      taskId: string;
      title: string;
      status: string;
      kind: "task" | "asset";
    }>;
  };
};

type ClientRow = { client_id: string; name: string };
type TaskRow = {
  task_id: string;
  title: string;
  status: string;
  task_type: string;
  deadline: string | null;
  priority: string | null;
  updated_at: Date;
};
type BriefRow = {
  brief_id: string;
  task_id: string;
  title: string;
  locked_at: Date | null;
  dor_complete: boolean;
  missing_required_count: number | string;
};
type AssetRow = {
  asset_id: string;
  title: string;
  status: string;
  version_count: number;
};

function deliveryStatus(tasks: PortalTask[]) {
  if (tasks.some((task) => task.status === "client_review")) {
    return "awaiting approval";
  }
  if (
    tasks.length > 0 &&
    tasks.every((task) => ["approved", "delivered", "archived"].includes(task.status))
  ) {
    return "approved";
  }
  return tasks.length > 0 ? "in progress" : "not started";
}

function memoryWorkspace(clientId: string): PortalWorkspace {
  const store = getDemoStore();
  const client = store.clients.get(clientId);
  if (!client) throw new Error("NOT_FOUND");
  const tasks = [...store.tasks.values()]
    .filter((task) => task.clientId === clientId)
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      status: task.status,
      taskType: task.taskType,
      deadline: task.deadline,
      priority: task.priority,
    }));
  const taskIds = new Set(tasks.map((task) => task.taskId));
  const status = store.clientDeliveryStatus.get(clientId);
  const result: PortalWorkspace = {
    clientId,
    clientName: client.name,
    tasks,
    briefs: [...store.briefs.values()]
      .filter((brief) => taskIds.has(brief.taskId))
      .map((brief) => ({
        briefId: brief.briefId,
        taskId: brief.taskId,
        title: tasks.find((task) => task.taskId === brief.taskId)?.title ?? "Brief",
        lockedAt: brief.lockedAt,
        dorComplete: brief.dorComplete,
        missingRequiredCount: brief.missingRequiredCount,
      })),
    assets: [...store.assets.values()]
      .filter((asset) => asset.clientId === clientId)
      .map((asset) => ({
        assetId: asset.assetId,
        title: asset.title,
        status: asset.status,
        versionCount: asset.versions.length,
      })),
    approvals: [...store.portalApprovals.values()]
      .filter((approval) => approval.clientId === clientId)
      .map((approval) => ({ ...approval })),
    delivery: {
      clientId,
      deliveryStatus: status?.status ?? deliveryStatus(tasks),
      lastSeam: status?.lastSeam ?? null,
      updatedAt: status?.updatedAt ?? null,
      deliverables: [
        ...tasks.map(({ taskId, title, status: taskStatus }) => ({
          taskId,
          title,
          status: taskStatus,
          kind: "task" as const,
        })),
        ...[...store.assets.values()]
          .filter((asset) => asset.clientId === clientId)
          .map((asset) => ({
            taskId: asset.assetId,
            title: asset.title,
            status: asset.status,
            kind: "asset" as const,
          })),
      ],
    },
  };
  assertPortalSafe(result);
  return result;
}

export async function readPortalWorkspace(clientId: string): Promise<PortalWorkspace> {
  const db = getDb();
  if (!db) return memoryWorkspace(clientId);

  const [rawClients, rawTasks, rawBriefs, rawAssets] = await Promise.all([
    db.execute(sql<ClientRow>`
      select client_id, name from public.client
      where client_id = ${clientId}::uuid limit 1
    `),
    db.execute(sql<TaskRow>`
      select
        t.task_id,
        coalesce(nullif(b.body->>'title', ''), initcap(replace(t.task_type, '_', ' '))) as title,
        t.status,
        t.task_type,
        t.deadline,
        t.priority,
        t.updated_at
      from public.task t
      left join public.brief b on b.task_id = t.task_id
      where t.client_id = ${clientId}::uuid
      order by t.deadline nulls last, t.created_at
    `),
    db.execute(sql<BriefRow>`
      select
        b.brief_id,
        b.task_id,
        coalesce(nullif(b.body->>'title', ''), initcap(replace(t.task_type, '_', ' '))) as title,
        b.locked_at,
        b.dor_complete,
        b.missing_required_count
      from public.brief b
      join public.task t on t.task_id = b.task_id
      where t.client_id = ${clientId}::uuid
      order by b.created_at
    `),
    db.execute(sql<AssetRow>`
      select
        a.asset_id,
        a.title,
        a.status,
        count(v.asset_version_id)::int as version_count
      from public.asset a
      left join public.asset_version v on v.asset_id = a.asset_id
      where a.client_id = ${clientId}::uuid
      group by a.asset_id
      order by a.created_at
    `),
  ]);
  const clients = rawClients as unknown as ClientRow[];
  const taskRows = rawTasks as unknown as TaskRow[];
  const briefRows = rawBriefs as unknown as BriefRow[];
  const assetRows = rawAssets as unknown as AssetRow[];
  const client = clients[0];
  if (!client) throw new Error("NOT_FOUND");
  const tasks: PortalTask[] = taskRows.map((row) => ({
    taskId: row.task_id,
    title: row.title,
    status: row.status,
    taskType: row.task_type,
    deadline: row.deadline,
    priority: row.priority,
  }));
  const approvals: PortalApproval[] = taskRows
    .filter((row) => row.status === "client_review")
    .map((row) => ({
      approvalId: row.task_id,
      title: row.title,
      kind: "deliverable",
      status: "pending",
      slaHours: 48,
      entityId: row.task_id,
      createdAt: row.updated_at,
    }));
  const result: PortalWorkspace = {
    clientId,
    clientName: client.name,
    tasks,
    briefs: briefRows.map((row) => ({
      briefId: row.brief_id,
      taskId: row.task_id,
      title: row.title,
      lockedAt: row.locked_at,
      dorComplete: row.dor_complete,
      missingRequiredCount: Number(row.missing_required_count),
    })),
    assets: assetRows.map((row) => ({
      assetId: row.asset_id,
      title: row.title,
      status: row.status,
      versionCount: Number(row.version_count),
    })),
    approvals,
    delivery: {
      clientId,
      deliveryStatus: deliveryStatus(tasks),
      lastSeam: null,
      updatedAt: taskRows[0]?.updated_at ?? null,
      deliverables: [
        ...tasks.map(({ taskId, title, status }) => ({
          taskId,
          title,
          status,
          kind: "task" as const,
        })),
        ...assetRows.map((row) => ({
          taskId: row.asset_id,
          title: row.title,
          status: row.status,
          kind: "asset" as const,
        })),
      ],
    },
  };
  assertPortalSafe(result);
  return result;
}

export async function demoPortalClientId(): Promise<string> {
  const db = getDb();
  if (!db) return DEMO_CLIENT_ID;
  const rawRows = await db.execute(sql<ClientRow>`
    select client_id, name
    from public.client
    where lower(name) like 'demo co%'
    order by case when lower(name) = 'demo co' then 0 else 1 end, created_at
    limit 1
  `);
  const rows = rawRows as unknown as ClientRow[];
  if (!rows[0]) throw new Error("Demo Co has not been seeded");
  return rows[0].client_id;
}

export async function portalClientName(clientId: string): Promise<string> {
  const db = getDb();
  if (!db) return getDemoStore().clients.get(clientId)?.name ?? "Client";
  const rawRows = await db.execute(sql<ClientRow>`
    select client_id, name from public.client
    where client_id = ${clientId}::uuid limit 1
  `);
  return (rawRows as unknown as ClientRow[])[0]?.name ?? "Client";
}

export async function portalAssetStoragePath(
  clientId: string,
  assetId: string,
  versionId?: string,
): Promise<string | null> {
  const db = getDb();
  if (!db) {
    const asset = getDemoStore().assets.get(assetId);
    if (!asset || asset.clientId !== clientId) return null;
    return (
      asset.versions.find((version) => version.assetVersionId === versionId) ??
      asset.versions[asset.versions.length - 1]
    )?.storagePath ?? null;
  }
  const rows = await db.execute<{ storage_path: string }>(sql`
    select v.storage_path
    from public.asset a
    join public.asset_version v on v.asset_id = a.asset_id
    where a.client_id = ${clientId}::uuid
      and a.asset_id = ${assetId}::uuid
      and a.status in ('client_review', 'approved', 'qc_passed', 'delivered')
      ${versionId ? sql`and v.asset_version_id = ${versionId}::uuid` : sql``}
    order by v.version_number desc
    limit 1
  `);
  return rows[0]?.storage_path ?? null;
}

export async function actOnPortalApproval(input: {
  clientId: string;
  approvalId: string;
  action: "approve" | "reject";
  feedback?: string;
  actorEmployeeId?: string | null;
  actorPortalUserId?: string | null;
}) {
  const db = getDb();
  if (!db) {
    const store = getDemoStore();
    const item = store.portalApprovals.get(input.approvalId);
    if (!item || item.clientId !== input.clientId) throw new Error("NOT_FOUND");
    const before = item.status;
    item.status = input.action === "approve" ? "approved" : "rejected";
    const asset = store.assets.get(item.entityId);
    if (asset) asset.status = input.action === "approve" ? "approved" : "internal_review";
    store.appendAudit({
      actorEmployeeId:
        input.actorEmployeeId ?? input.actorPortalUserId ??
        "00000000-0000-4000-8000-000000000000",
      action: "portal.approvals.act",
      entityType: item.kind,
      entityId: item.entityId,
      before: { status: before },
      after: { status: item.status },
      reason: input.feedback ?? null,
    });
    return { ok: true as const, status: item.status };
  }

  const nextStatus = input.action === "approve" ? "approved" : "revisions";
  return db.transaction(async (tx) => {
    const existing = await tx.execute<{ status: string }>(sql`
      select status from public.task
      where task_id = ${input.approvalId}::uuid
        and client_id = ${input.clientId}::uuid
      for update
    `);
    if (!existing[0]) throw new Error("NOT_FOUND");
    if (existing[0].status !== "client_review") {
      if (existing[0].status === nextStatus) {
        return { ok: true as const, status: nextStatus };
      }
      throw new Error("CONFLICT: approval is no longer pending");
    }
    await tx.execute(sql`
      update public.task
      set status = ${nextStatus}::task_status_enum, updated_at = now()
      where task_id = ${input.approvalId}::uuid
    `);

    let portalActorId: string | null = null;
    if (input.actorPortalUserId) {
      const portalUser = await tx.execute<{ ok: number }>(sql`
        select 1 as ok from public.client_portal_user
        where client_portal_user_id = ${input.actorPortalUserId}::uuid
        limit 1
      `);
      if (portalUser[0]) portalActorId = input.actorPortalUserId;
    }

    let employeeActorId = input.actorEmployeeId ?? null;
    if (employeeActorId) {
      const emp = await tx.execute<{ ok: number }>(sql`
        select 1 as ok from public.employee
        where employee_id = ${employeeActorId}::uuid
        limit 1
      `);
      if (!emp[0]) employeeActorId = null;
    }

    await tx.execute(sql`
      insert into public.audit_event (
        actor_employee_id, actor_portal_user_id, action, entity_type,
        entity_id, before, after, reason
      ) values (
        ${employeeActorId}::uuid,
        ${portalActorId}::uuid,
        'portal.approvals.act', 'task', ${input.approvalId}::uuid,
        ${JSON.stringify({ status: existing[0].status })}::jsonb,
        ${JSON.stringify({ status: nextStatus })}::jsonb,
        ${input.feedback ?? null}
      )
    `);
    return { ok: true as const, status: nextStatus };
  });
}

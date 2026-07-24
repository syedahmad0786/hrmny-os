import { sql, type Db } from "@hrmny/db";
import type { AsanaAdapter, AsanaEvent } from "@hrmny/integrations";
import { importAsanaWorkspace, type AsanaImportSummary } from "./asana-import";
import { scanAsanaWorkspace } from "./asana-migration";

export type AsanaEventEffects = {
  archivedTaskGids: string[];
  archivedProjectGids: string[];
  deletedSectionGids: string[];
  deletedStoryGids: string[];
  deletedAttachmentGids: string[];
  removedProjectTasks: { projectGid: string; taskGid: string }[];
};

export function asanaEventEffects(
  events: readonly AsanaEvent[],
): AsanaEventEffects {
  const effects: AsanaEventEffects = {
    archivedTaskGids: [],
    archivedProjectGids: [],
    deletedSectionGids: [],
    deletedStoryGids: [],
    deletedAttachmentGids: [],
    removedProjectTasks: [],
  };
  for (const event of events) {
    const type = event.resource.resource_type ?? event.type;
    if (event.action === "deleted") {
      if (type === "task") effects.archivedTaskGids.push(event.resource.gid);
      if (type === "project")
        effects.archivedProjectGids.push(event.resource.gid);
      if (type === "section")
        effects.deletedSectionGids.push(event.resource.gid);
      if (type === "story") effects.deletedStoryGids.push(event.resource.gid);
      if (type === "attachment")
        effects.deletedAttachmentGids.push(event.resource.gid);
    }
    if (
      event.action === "removed" &&
      type === "task" &&
      event.parent?.resource_type === "project"
    ) {
      effects.removedProjectTasks.push({
        projectGid: event.parent.gid,
        taskGid: event.resource.gid,
      });
    }
  }
  return effects;
}

async function applyEffects(
  db: Db,
  effects: AsanaEventEffects,
  occurredAt: string,
) {
  await db.transaction(async (tx) => {
    for (const gid of new Set(effects.archivedTaskGids))
      await tx.execute(sql`
        update public.work_item set archived_at = ${occurredAt}::timestamptz,
          updated_at = now()
        where source_platform = 'asana' and external_id = ${gid}
      `);
    for (const gid of new Set(effects.archivedProjectGids))
      await tx.execute(sql`
        update public.work_project set archived_at = ${occurredAt}::timestamptz,
          updated_at = now()
        where source_platform = 'asana' and external_id = ${gid}
      `);
    for (const gid of new Set(effects.deletedSectionGids))
      await tx.execute(sql`
        delete from public.work_section
        where source_platform = 'asana' and external_id = ${gid}
      `);
    for (const gid of new Set(effects.deletedStoryGids))
      await tx.execute(sql`
        update public.work_comment set deleted_at = ${occurredAt}::timestamptz,
          updated_at = now()
        where source_platform = 'asana' and external_id = ${gid}
      `);
    for (const gid of new Set(effects.deletedAttachmentGids))
      await tx.execute(sql`
        delete from public.work_attachment
        where source_platform = 'asana' and external_id = ${gid}
      `);
    for (const membership of effects.removedProjectTasks)
      await tx.execute(sql`
        delete from public.work_project_item membership
        using public.work_project project, public.work_item item
        where membership.work_project_id = project.work_project_id
          and membership.work_item_id = item.work_item_id
          and project.source_platform = 'asana'
          and project.external_id = ${membership.projectGid}
          and item.source_platform = 'asana'
          and item.external_id = ${membership.taskGid}
      `);
  });
}

export type AsanaSyncResult = {
  workspaceGid: string;
  eventCount: number;
  reset: boolean;
  reconciled: boolean;
  runId: string | null;
  summary: AsanaImportSummary | null;
  syncedAt: string;
};

export async function syncAsanaWorkspace(input: {
  db: Db;
  adapter: AsanaAdapter;
  workspaceGid: string;
  workspaceName: string;
  connectedAccountId: string;
  actorEmployeeId: string;
}): Promise<AsanaSyncResult> {
  const { db } = input;
  await db.execute(sql`
    insert into public.asana_sync_state (
      workspace_external_id, workspace_name, connected_account_id,
      requested_by_employee_id
    ) values (
      ${input.workspaceGid}, ${input.workspaceName}, ${input.connectedAccountId},
      ${input.actorEmployeeId}::uuid
    ) on conflict (workspace_external_id) do update set
      workspace_name = excluded.workspace_name,
      connected_account_id = excluded.connected_account_id,
      requested_by_employee_id = excluded.requested_by_employee_id
  `);
  const claimed = await db.execute<{ syncToken: string | null }>(sql`
    update public.asana_sync_state set status = 'running', last_error = null,
      updated_at = now()
    where workspace_external_id = ${input.workspaceGid}
      and (status <> 'running' or updated_at < now() - interval '15 minutes')
    returning sync_token as "syncToken"
  `);
  if (!claimed[0]) throw new Error("An Asana sync is already running");

  try {
    let token = claimed[0].syncToken ?? undefined;
    const events: AsanaEvent[] = [];
    let reset = false;
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await input.adapter.workspaceEvents(
        input.workspaceGid,
        token,
      );
      token = page.sync;
      reset ||= page.reset;
      events.push(...page.events);
      if (!page.hasMore) break;
      if (pageNumber === 99)
        throw new Error("Asana event backlog exceeds 100 pages");
    }

    let imported: { runId: string; summary: AsanaImportSummary } | null = null;
    if (reset || events.length) {
      // ponytail: full reconciliation is the reliable fallback Asana recommends;
      // replace with per-resource reads only if workspace scan cost becomes material.
      const scan = await scanAsanaWorkspace(
        input.adapter,
        input.workspaceGid,
        "full",
      );
      imported = await importAsanaWorkspace({
        db,
        scan,
        workspaceGid: input.workspaceGid,
        workspaceName: input.workspaceName,
        connectedAccountId: input.connectedAccountId,
        actorEmployeeId: input.actorEmployeeId,
        mode: "sync",
      });
      const occurredAt =
        events
          .map((event) => event.created_at)
          .filter((value): value is string => Boolean(value))
          .sort()
          .at(-1) ?? new Date().toISOString();
      await applyEffects(db, asanaEventEffects(events), occurredAt);
    }

    const syncedAt = new Date().toISOString();
    const lastEventAt = events
      .map((event) => event.created_at)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);
    await db.execute(sql`
      update public.asana_sync_state set status = 'idle', sync_token = ${token},
        last_event_count = ${events.length},
        total_event_count = total_event_count + ${events.length},
        last_event_at = coalesce(${lastEventAt ?? null}::timestamptz, last_event_at),
        last_synced_at = ${syncedAt}::timestamptz,
        last_reconciled_at = case when ${Boolean(imported)} then ${syncedAt}::timestamptz
          else last_reconciled_at end,
        last_error = null, updated_at = now()
      where workspace_external_id = ${input.workspaceGid}
    `);
    return {
      workspaceGid: input.workspaceGid,
      eventCount: events.length,
      reset,
      reconciled: Boolean(imported),
      runId: imported?.runId ?? null,
      summary: imported?.summary ?? null,
      syncedAt,
    };
  } catch (error) {
    await db.execute(sql`
      update public.asana_sync_state set status = 'error',
        last_error = ${error instanceof Error ? error.message.slice(0, 2_000) : "Sync failed"},
        updated_at = now()
      where workspace_external_id = ${input.workspaceGid}
    `);
    throw error;
  }
}

import { sql } from "@hrmny/db";
import { getBuildStatus } from "../build-status";
import { getDb } from "../db";
import { listTasks } from "../delivery/store";
import { getDemoStore } from "../demo-store";
import { publicProcedure, router, staffProcedure } from "./trpc";

type CountRow = {
  active_people: number;
  open_deals: number;
  active_clients: number;
  open_tasks: number;
  connected_tools: number;
  recent_audits: number;
};

export const opsRouter = router({
  buildStatus: publicProcedure.query(() => getBuildStatus()),
  overview: staffProcedure.query(async () => {
    const db = getDb();
    if (!db) {
      const store = getDemoStore();
      const openTasks = (await listTasks()).filter(
        (task) => !["delivered", "archived"].includes(task.status),
      ).length;
      return {
        activePeople: store.employees.size,
        openDeals: store.deals.size,
        activeClients: store.clients.size,
        openTasks,
        connectedTools: store.connections.filter(
          (connection) => connection.status === "connected",
        ).length,
        recentAudits: store.audits.length,
        latestAudit: store.audits[0]
          ? {
              action: store.audits[0].action,
              createdAt: store.audits[0].createdAt,
            }
          : null,
        updatedAt: new Date().toISOString(),
      };
    }

    const [counts, latest] = await Promise.all([
      db.execute(sql<CountRow>`
        select
          (select count(*)::int from public.employee where is_active = true) as active_people,
          (select count(*)::int from public.deal where close_outcome is null) as open_deals,
          (select count(*)::int from public.client where lifecycle_status in ('onboarding', 'active', 'renewing')) as active_clients,
          (select count(*)::int from public.task where status not in ('delivered', 'archived')) as open_tasks,
          (select count(*)::int from public.connection_account where status = 'connected') as connected_tools,
          (select count(*)::int from public.audit_event where created_at >= now() - interval '7 days') as recent_audits
      `),
      db.execute<{ action: string; created_at: Date }>(sql`
        select action, created_at
        from public.audit_event
        order by created_at desc
        limit 1
      `),
    ]);
    const row = counts[0]!;
    return {
      activePeople: Number(row.active_people),
      openDeals: Number(row.open_deals),
      activeClients: Number(row.active_clients),
      openTasks: Number(row.open_tasks),
      connectedTools: Number(row.connected_tools),
      recentAudits: Number(row.recent_audits),
      latestAudit: latest[0]
        ? { action: latest[0].action, createdAt: latest[0].created_at }
        : null,
      updatedAt: new Date().toISOString(),
    };
  }),
});

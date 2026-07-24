import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { DEV_USERS } from "../auth/session";
import { importAsanaWorkspace } from "../asana-import";
import { scanAsanaWorkspace } from "../asana-migration";
import { syncAsanaWorkspace } from "../asana-sync";
import {
  disableAsanaWebhooks,
  enableAsanaWebhooks,
  getAsanaWebhookStatus,
  refreshAsanaWebhooksIfEnabled,
} from "../asana-webhooks";
import { getDb } from "../db";
import { writeAudit } from "../m1-persistence";
import { getVerifiedAsanaConnection } from "./connections-router";
import { requirePermission, router, staffProcedure } from "./trpc";

const asanaAdminProcedure = staffProcedure.use(
  requirePermission("admin", "features"),
);

async function requireAsana(employeeId: string) {
  const verified = await getVerifiedAsanaConnection(employeeId);
  if (!verified) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Connect the Composio project that contains Asana first",
    });
  }
  return verified;
}

async function localEmployeeEmails(): Promise<Set<string>> {
  const db = getDb();
  if (!db) {
    return new Set(
      Object.values(DEV_USERS).map((user) => user.email.toLowerCase()),
    );
  }
  const rows = await db.execute(sql<{ email: string }>`
    select lower(email) as email
    from public.employee
    where is_active = true
  `);
  return new Set<string>(rows.map((row) => String(row.email)));
}

export const asanaMigrationRouter = router({
  status: asanaAdminProcedure.query(async ({ ctx }) => {
    const verified = await requireAsana(ctx.employeeId!);
    const [user, workspaces] = await Promise.all([
      verified.adapter.me(),
      verified.adapter.listWorkspaces(),
    ]);
    return {
      provider: verified.provider,
      connectedAccountId: verified.account.id,
      providerUserId: verified.account.user_id ?? null,
      user,
      workspaces,
    };
  }),

  dryRun: asanaAdminProcedure
    .input(
      z.object({
        workspaceGid: z.string().trim().min(1).max(120),
        depth: z.enum(["structure", "full"]).default("full"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const verified = await requireAsana(ctx.employeeId!);
      const scan = await scanAsanaWorkspace(
        verified.adapter,
        input.workspaceGid,
        input.depth,
      );
      const localEmails = await localEmployeeEmails();
      const users = scan.users.map((user) => ({
        gid: user.gid,
        name: user.name,
        email: user.email ?? null,
        matched:
          Boolean(user.email) && localEmails.has(user.email!.toLowerCase()),
      }));
      const result = {
        scannedAt: new Date().toISOString(),
        depth: scan.depth,
        counts: scan.counts,
        matchedUsers: users.filter((user) => user.matched).length,
        unmappedUsers: users.filter((user) => !user.matched),
        projects: scan.projects.map((project) => ({
          gid: project.gid,
          name: project.name,
          owner: project.owner?.name ?? null,
          team: project.team?.name ?? null,
          privacy: project.privacy_setting ?? null,
        })),
      };
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "asanaMigration.dryRun",
        entityType: "asana_workspace",
        entityId: null,
        before: null,
        after: {
          workspaceGid: input.workspaceGid,
          depth: input.depth,
          counts: result.counts,
          matchedUsers: result.matchedUsers,
          unmappedUsers: result.unmappedUsers.length,
        },
        reason: "Read-only Asana migration discovery",
      });
      return result;
    }),

  import: asanaAdminProcedure
    .input(
      z.object({
        workspaceGid: z.string().trim().min(1).max(120),
        confirmation: z.literal("IMPORT"),
        allowUnmappedUsers: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (!db) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A database connection is required for import",
        });
      }
      const verified = await requireAsana(ctx.employeeId!);
      const workspaces = await verified.adapter.listWorkspaces();
      const workspace = workspaces.find(
        (candidate) => candidate.gid === input.workspaceGid,
      );
      if (!workspace) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Asana workspace not found on this connection",
        });
      }
      const scan = await scanAsanaWorkspace(
        verified.adapter,
        input.workspaceGid,
        "full",
      );
      const localEmails = await localEmployeeEmails();
      const unmappedUsers = scan.users.filter(
        (user) => !user.email || !localEmails.has(user.email.toLowerCase()),
      );
      if (unmappedUsers.length && !input.allowUnmappedUsers) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `${unmappedUsers.length} Asana users still need mapping`,
        });
      }

      const result = await importAsanaWorkspace({
        db,
        scan,
        workspaceGid: workspace.gid,
        workspaceName: workspace.name,
        connectedAccountId: verified.account.id,
        actorEmployeeId: ctx.employeeId!,
      });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "asanaMigration.import",
        entityType: "work_migration_run",
        entityId: result.runId,
        before: null,
        after: {
          workspaceGid: workspace.gid,
          workspaceName: workspace.name,
          summary: result.summary,
          unmappedUsers: unmappedUsers.length,
        },
        reason: "Confirmed idempotent Asana import",
      });
      return result;
    }),

  syncStatus: asanaAdminProcedure
    .input(z.object({ workspaceGid: z.string().trim().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      await requireAsana(ctx.employeeId!);
      const db = getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A database connection is required for sync",
        });
      const rows = await db.execute<{
        workspaceGid: string;
        workspaceName: string;
        status: "idle" | "running" | "error";
        lastEventCount: number;
        totalEventCount: string | number;
        lastEventAt: Date | string | null;
        lastSyncedAt: Date | string | null;
        lastReconciledAt: Date | string | null;
        lastError: string | null;
      }>(sql`
        select workspace_external_id as "workspaceGid",
          workspace_name as "workspaceName", status,
          last_event_count as "lastEventCount",
          total_event_count as "totalEventCount", last_event_at as "lastEventAt",
          last_synced_at as "lastSyncedAt",
          last_reconciled_at as "lastReconciledAt", last_error as "lastError"
        from public.asana_sync_state
        where workspace_external_id = ${input.workspaceGid}
      `);
      const state = rows[0];
      return state
        ? {
            ...state,
            totalEventCount: Number(state.totalEventCount),
            lastEventAt: state.lastEventAt
              ? new Date(state.lastEventAt).toISOString()
              : null,
            lastSyncedAt: state.lastSyncedAt
              ? new Date(state.lastSyncedAt).toISOString()
              : null,
            lastReconciledAt: state.lastReconciledAt
              ? new Date(state.lastReconciledAt).toISOString()
              : null,
          }
        : null;
    }),

  syncNow: asanaAdminProcedure
    .input(z.object({ workspaceGid: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      if (!db)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "A database connection is required for sync",
        });
      const verified = await requireAsana(ctx.employeeId!);
      const workspace = (await verified.adapter.listWorkspaces()).find(
        (candidate) => candidate.gid === input.workspaceGid,
      );
      if (!workspace)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Asana workspace not found on this connection",
        });
      try {
        const result = await syncAsanaWorkspace({
          db,
          adapter: verified.adapter,
          workspaceGid: workspace.gid,
          workspaceName: workspace.name,
          connectedAccountId: verified.account.id,
          actorEmployeeId: ctx.employeeId!,
        });
        if (result.reconciled) {
          await refreshAsanaWebhooksIfEnabled({
            adapter: verified.adapter,
            connectedAccountId: verified.account.id,
            workspace,
            employeeId: ctx.employeeId!,
          }).catch(() => undefined);
        }
        await writeAudit({
          actorEmployeeId: ctx.employeeId,
          action: "asanaMigration.sync",
          entityType: "asana_workspace",
          entityId: null,
          before: null,
          after: {
            workspaceGid: input.workspaceGid,
            eventCount: result.eventCount,
            reset: result.reset,
            reconciled: result.reconciled,
            runId: result.runId,
          },
          reason: "Cursor-based Asana reconciliation",
        });
        await db.execute(sql`
          insert into public.scheduled_job (job_key, kind, run_at, payload)
          values (
            ${`asana-sync:${workspace.gid}`}, 'asana_sync',
            now() + interval '5 minutes',
            ${JSON.stringify({
              workspaceGid: workspace.gid,
              workspaceName: workspace.name,
              actorEmployeeId: ctx.employeeId!,
            })}::jsonb
          ) on conflict (job_key) do update set
            kind = excluded.kind, run_at = excluded.run_at,
            payload = excluded.payload, status = 'pending', attempts = 0,
            locked_at = null, completed_at = null, last_error = null,
            updated_at = now()
        `);
        return result;
      } catch (error) {
        if (error instanceof Error && error.message.includes("already running"))
          throw new TRPCError({ code: "CONFLICT", message: error.message });
        throw error;
      }
    }),

  syncWebhookStatus: asanaAdminProcedure
    .input(z.object({ workspaceGid: z.string().trim().min(1).max(120) }))
    .query(async ({ ctx, input }) => {
      const verified = await requireAsana(ctx.employeeId!);
      return getAsanaWebhookStatus(verified.account.id, input.workspaceGid);
    }),

  syncWebhookEnable: asanaAdminProcedure
    .input(z.object({ workspaceGid: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const verified = await requireAsana(ctx.employeeId!);
      const workspace = (await verified.adapter.listWorkspaces()).find(
        (candidate) => candidate.gid === input.workspaceGid,
      );
      if (!workspace)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Asana workspace not found on this connection",
        });
      const result = await enableAsanaWebhooks({
        adapter: verified.adapter,
        connectedAccountId: verified.account.id,
        workspace,
        employeeId: ctx.employeeId!,
      });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "asanaMigration.webhooks.enable",
        entityType: "asana_workspace",
        entityId: null,
        before: null,
        after: {
          workspaceGid: input.workspaceGid,
          active: result.active,
          requested: result.requested,
          failures: result.failures.length,
        },
        reason: "Enable signed Asana push reconciliation",
      });
      return result;
    }),

  syncWebhookDisable: asanaAdminProcedure
    .input(z.object({ workspaceGid: z.string().trim().min(1).max(120) }))
    .mutation(async ({ ctx, input }) => {
      const verified = await requireAsana(ctx.employeeId!);
      const result = await disableAsanaWebhooks({
        adapter: verified.adapter,
        connectedAccountId: verified.account.id,
        workspaceGid: input.workspaceGid,
      });
      await writeAudit({
        actorEmployeeId: ctx.employeeId,
        action: "asanaMigration.webhooks.disable",
        entityType: "asana_workspace",
        entityId: null,
        before: null,
        after: { workspaceGid: input.workspaceGid, ...result },
        reason: "Disable signed Asana push reconciliation",
      });
      return result;
    }),
});

import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { DEV_USERS } from "../auth/session";
import { importAsanaWorkspace } from "../asana-import";
import { scanAsanaWorkspace } from "../asana-migration";
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
});

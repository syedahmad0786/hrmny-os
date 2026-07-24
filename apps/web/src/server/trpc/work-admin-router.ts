import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { DEV_USERS } from "../auth/session";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import {
  getWorkSsoConfiguration,
  issueScimToken,
  listScimTokens,
  revokeScimToken,
  saveWorkSsoConfiguration,
} from "../enterprise-identity";
import { writeAudit } from "../m1-persistence";
import {
  getWorkOrganizationPolicy,
  getDemoWorkLicense,
  listDemoGuestShares,
  removeDemoGuestShare,
  saveDemoGuestShare,
  saveWorkOrganizationPolicy,
  setDemoWorkLicense,
} from "../work-governance";
import {
  createWorkWebhook,
  deleteWorkWebhook,
  issueWorkApiToken,
  listWorkApiConfiguration,
  revokeWorkApiToken,
  WORK_API_SCOPES,
  WORK_WEBHOOK_EVENTS,
} from "../work-api";
import { getWorkAiPolicy, getWorkAiUsage, saveWorkAiPolicy } from "../work-ai";
import {
  activateWorkSandbox,
  deleteWorkSandbox,
  getWorkSandbox,
  verifyWorkSandbox,
} from "../work-sandbox";
import { getDemoWork, requireProjectAccess } from "./work-management-router";
import { requirePermission, router, staffProcedure } from "./trpc";

const uuid = z.string().uuid();
const accessLevel = z.enum(["commenter", "viewer"]);
const workAdminProcedure = staffProcedure.use(
  requirePermission("admin", "work"),
);

function actor(employeeId: string | null) {
  if (!employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return employeeId;
}

async function audit(
  employeeId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  after: Record<string, unknown> | null,
  reason?: string | null,
) {
  await writeAudit({
    actorEmployeeId: employeeId,
    action,
    entityType,
    entityId,
    before: null,
    after,
    reason: reason ?? null,
  });
}

type DemoTeam = {
  teamId: string;
  name: string;
  description: string;
  privacy: "public" | "request" | "private";
  members: Map<string, "admin" | "member">;
  projectIds: Set<string>;
  createdAt: string;
};

const demoTeams = new Map<string, DemoTeam>();
const demoRoles = new Map<
  string,
  {
    key: string;
    displayName: string;
    policies: Map<string, "allow" | "deny">;
    employeeIds: Set<string>;
  }
>();

function demoDirectory() {
  const staff = Object.values(DEV_USERS).filter(
    (user, index, all) =>
      user.actorType === "staff" &&
      all.findIndex((candidate) => candidate.employeeId === user.employeeId) ===
        index,
  );
  return {
    employees: staff.map((user) => ({
      employeeId: user.employeeId,
      displayName: user.displayName,
      email: user.email,
      active: true,
    })),
    clients: [...getDemoStore().clients.values()].map((client) => ({
      clientId: client.clientId,
      name: client.name,
    })),
    portalUsers: Object.values(DEV_USERS)
      .filter((user) => user.actorType === "portal")
      .map((user) => ({
        portalUserId: user.employeeId,
        clientId: user.clientId!,
        displayName: user.displayName,
        email: user.email,
        active: true,
      })),
    projects: [...getDemoWork().projects.values()].map((project) => ({
      projectId: project.projectId,
      name: project.name,
      privacy: project.privacy,
    })),
  };
}

function csvCell(value: unknown) {
  const text =
    value == null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function rowsToCsv(rows: readonly Record<string, unknown>[]) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  if (!columns.length) return "";
  return [
    columns.map(csvCell).join(","),
    ...rows.map((row) =>
      columns.map((column) => csvCell(row[column])).join(","),
    ),
  ].join("\r\n");
}

const WORK_EXPORT_TABLES = [
  "work_team",
  "work_team_member",
  "work_team_project",
  "work_project",
  "work_project_member",
  "work_project_guest",
  "work_section",
  "work_project_item",
  "work_item",
  "work_item_dependency",
  "work_comment",
  "work_attachment",
  "work_item_follower",
  "work_notification",
  "work_saved_search",
  "work_recurrence_occurrence",
  "work_tag",
  "work_item_tag",
  "work_custom_field",
  "work_custom_field_value",
  "work_form",
  "work_form_submission",
  "work_rule",
  "work_rule_run",
  "work_template",
  "work_bundle",
  "work_bundle_version",
  "work_project_bundle",
  "work_approval_decision",
  "work_goal",
  "work_goal_link",
  "work_portfolio",
  "work_portfolio_project",
  "work_status_update",
  "work_capacity_allocation",
  "work_reporting_dashboard",
  "work_timer",
  "work_item_baseline",
  "work_member_license",
  "work_organization_policy",
  "work_migration_run",
  "asana_sync_state",
  "work_api_token",
  "work_webhook_subscription",
  "work_webhook_delivery",
  "work_ai_policy",
  "work_ai_run",
  "work_ai_action_execution",
  "work_ai_studio_workflow",
  "work_ai_studio_run",
  "work_ai_teammate",
  "work_ai_teammate_member",
  "work_ai_teammate_project_access",
  "work_ai_teammate_skill",
  "work_ai_teammate_memory",
  "work_ai_teammate_run",
  "time_entry",
] as const;

export const workAdminRouter = router({
  directory: workAdminProcedure.query(async () => {
    const db = getDb();
    if (!db) return demoDirectory();
    const [employees, clients, portalUsers, projects] = await Promise.all([
      db.execute<{
        employeeId: string;
        displayName: string;
        email: string;
        active: boolean;
      }>(sql`
        select employee_id as "employeeId", display_name as "displayName",
          email, is_active as active
        from public.employee order by lower(display_name)
      `),
      db.execute<{ clientId: string; name: string }>(sql`
        select client_id as "clientId", name from public.client order by lower(name)
      `),
      db.execute<{
        portalUserId: string;
        clientId: string;
        displayName: string;
        email: string;
        active: boolean;
      }>(sql`
        select client_portal_user_id as "portalUserId", client_id as "clientId",
          display_name as "displayName", email, is_active as active
        from public.client_portal_user order by lower(display_name)
      `),
      db.execute<{ projectId: string; name: string; privacy: string }>(sql`
        select work_project_id as "projectId", name, privacy
        from public.work_project where archived_at is null order by lower(name)
      `),
    ]);
    return { employees, clients, portalUsers, projects };
  }),

  policy: router({
    get: workAdminProcedure.query(() => getWorkOrganizationPolicy()),
    save: workAdminProcedure
      .input(
        z.object({
          approvedDomains: z.array(z.string().trim().min(1).max(253)).max(100),
          defaultProjectPrivacy: z.enum(["organization", "private"]),
          defaultTeamPrivacy: z.enum(["public", "request", "private"]),
          guestInvitePolicy: z.enum(["admins", "members", "disabled"]),
          externalSharingEnabled: z.boolean(),
          appPolicy: z.enum(["allow_all", "approved_only", "disabled"]),
          sessionTimeoutMinutes: z.number().int().min(15).max(43_200),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const saved = await saveWorkOrganizationPolicy(input, employeeId);
        await audit(
          employeeId,
          "work.admin.policy.update",
          "work_organization_policy",
          null,
          saved,
        );
        return saved;
      }),
  }),

  teams: router({
    list: workAdminProcedure.query(async () => {
      const db = getDb();
      if (!db) {
        const directory = demoDirectory();
        return [...demoTeams.values()].map((team) => ({
          teamId: team.teamId,
          name: team.name,
          description: team.description,
          privacy: team.privacy,
          createdAt: team.createdAt,
          members: [...team.members].map(([employeeId, role]) => ({
            employeeId,
            role,
            displayName:
              directory.employees.find((item) => item.employeeId === employeeId)
                ?.displayName ?? "Unknown",
          })),
          projects: [...team.projectIds].map((projectId) => ({
            projectId,
            accessLevel: "editor" as const,
            name:
              directory.projects.find((item) => item.projectId === projectId)
                ?.name ?? "Unknown",
          })),
        }));
      }
      const [teams, members, projects] = await Promise.all([
        db.execute<{
          teamId: string;
          name: string;
          description: string;
          privacy: "public" | "request" | "private";
          createdAt: Date | string;
        }>(sql`
          select work_team_id as "teamId", name, description, privacy,
            created_at as "createdAt"
          from public.work_team where archived_at is null order by lower(name)
        `),
        db.execute<{
          teamId: string;
          employeeId: string;
          displayName: string;
          role: "admin" | "member";
        }>(sql`
          select membership.work_team_id as "teamId",
            membership.employee_id as "employeeId", employee.display_name as "displayName",
            membership.role
          from public.work_team_member membership
          join public.employee employee on employee.employee_id = membership.employee_id
        `),
        db.execute<{
          teamId: string;
          projectId: string;
          name: string;
          accessLevel: "editor" | "commenter" | "viewer";
        }>(sql`
          select membership.work_team_id as "teamId",
            membership.work_project_id as "projectId", project.name,
            membership.access_level as "accessLevel"
          from public.work_team_project membership
          join public.work_project project on project.work_project_id = membership.work_project_id
          where project.archived_at is null
        `),
      ]);
      return teams.map((team) => ({
        ...team,
        createdAt: new Date(team.createdAt).toISOString(),
        members: members.filter((member) => member.teamId === team.teamId),
        projects: projects.filter((project) => project.teamId === team.teamId),
      }));
    }),

    create: workAdminProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(20_000).default(""),
          privacy: z.enum(["public", "request", "private"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const privacy =
          input.privacy ??
          (await getWorkOrganizationPolicy()).defaultTeamPrivacy;
        const db = getDb();
        let team: {
          teamId: string;
          name: string;
          description: string;
          privacy: "public" | "request" | "private";
          createdAt: string;
        };
        if (!db) {
          team = {
            teamId: randomUUID(),
            name: input.name,
            description: input.description,
            privacy,
            createdAt: new Date().toISOString(),
          };
          demoTeams.set(team.teamId, {
            ...team,
            members: new Map([[employeeId, "admin"]]),
            projectIds: new Set(),
          });
        } else {
          team = await db.transaction(async (tx) => {
            const rows = await tx.execute<{
              teamId: string;
              name: string;
              description: string;
              privacy: "public" | "request" | "private";
              createdAt: Date | string;
            }>(sql`
              insert into public.work_team (
                name, description, privacy, created_by_employee_id
              ) values (${input.name}, ${input.description}, ${privacy}, ${employeeId}::uuid)
              returning work_team_id as "teamId", name, description, privacy,
                created_at as "createdAt"
            `);
            const created = rows[0]!;
            await tx.execute(sql`
              insert into public.work_team_member (work_team_id, employee_id, role)
              values (${created.teamId}::uuid, ${employeeId}::uuid, 'admin')
            `);
            return {
              ...created,
              createdAt: new Date(created.createdAt).toISOString(),
            };
          });
        }
        await audit(employeeId, "work.team.create", "work_team", team.teamId, {
          name: team.name,
          privacy: team.privacy,
        });
        return team;
      }),

    update: workAdminProcedure
      .input(
        z.object({
          teamId: uuid,
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(20_000),
          privacy: z.enum(["public", "request", "private"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          const team = demoTeams.get(input.teamId);
          if (!team) throw new TRPCError({ code: "NOT_FOUND" });
          Object.assign(team, input);
        } else {
          const rows = await db.execute(sql`
            update public.work_team set name = ${input.name},
              description = ${input.description}, privacy = ${input.privacy}, updated_at = now()
            where work_team_id = ${input.teamId}::uuid and archived_at is null
            returning work_team_id
          `);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        await audit(employeeId, "work.team.update", "work_team", input.teamId, {
          name: input.name,
          privacy: input.privacy,
        });
        return { ok: true as const };
      }),

    archive: workAdminProcedure
      .input(z.object({ teamId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) demoTeams.delete(input.teamId);
        else
          await db.execute(sql`
            update public.work_team set archived_at = now(), updated_at = now()
            where work_team_id = ${input.teamId}::uuid
          `);
        await audit(
          employeeId,
          "work.team.archive",
          "work_team",
          input.teamId,
          {
            archived: true,
          },
        );
        return { ok: true as const };
      }),

    setMember: workAdminProcedure
      .input(
        z.object({
          teamId: uuid,
          employeeId: uuid,
          role: z.enum(["admin", "member"]).nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          const team = demoTeams.get(input.teamId);
          if (!team) throw new TRPCError({ code: "NOT_FOUND" });
          if (input.role) team.members.set(input.employeeId, input.role);
          else team.members.delete(input.employeeId);
        } else if (input.role) {
          await db.execute(sql`
            insert into public.work_team_member (work_team_id, employee_id, role)
            values (${input.teamId}::uuid, ${input.employeeId}::uuid, ${input.role})
            on conflict (work_team_id, employee_id) do update set
              role = excluded.role, updated_at = now()
          `);
        } else {
          await db.execute(sql`
            delete from public.work_team_member
            where work_team_id = ${input.teamId}::uuid
              and employee_id = ${input.employeeId}::uuid
          `);
        }
        await audit(
          employeeId,
          "work.team.member.set",
          "work_team",
          input.teamId,
          {
            employeeId: input.employeeId,
            role: input.role,
          },
        );
        return { ok: true as const };
      }),

    setProject: workAdminProcedure
      .input(
        z.object({
          teamId: uuid,
          projectId: uuid,
          included: z.boolean(),
          accessLevel: z
            .enum(["editor", "commenter", "viewer"])
            .default("editor"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          const team = demoTeams.get(input.teamId);
          if (!team) throw new TRPCError({ code: "NOT_FOUND" });
          if (input.included) team.projectIds.add(input.projectId);
          else team.projectIds.delete(input.projectId);
        } else if (input.included) {
          await db.execute(sql`
            insert into public.work_team_project (
              work_team_id, work_project_id, access_level
            ) values (
              ${input.teamId}::uuid, ${input.projectId}::uuid, ${input.accessLevel}
            )
            on conflict (work_team_id, work_project_id) do update set
              access_level = excluded.access_level
          `);
        } else {
          await db.execute(sql`
            delete from public.work_team_project
            where work_team_id = ${input.teamId}::uuid
              and work_project_id = ${input.projectId}::uuid
          `);
        }
        await audit(
          employeeId,
          "work.team.project.set",
          "work_team",
          input.teamId,
          {
            projectId: input.projectId,
            included: input.included,
            accessLevel: input.accessLevel,
          },
        );
        return { ok: true as const };
      }),
  }),

  guests: router({
    list: workAdminProcedure.query(async () => {
      const db = getDb();
      if (!db) return listDemoGuestShares();
      const rows = await db.execute<{
        shareId: string;
        projectId: string;
        projectName: string;
        portalUserId: string;
        clientId: string;
        clientName: string;
        email: string;
        displayName: string;
        accessLevel: "commenter" | "viewer";
        updatedAt: Date | string;
      }>(sql`
        select guest.work_project_guest_id as "shareId",
          guest.work_project_id as "projectId", project.name as "projectName",
          guest.portal_user_id as "portalUserId", portal.client_id as "clientId",
          client.name as "clientName", portal.email, portal.display_name as "displayName",
          guest.access_level as "accessLevel", guest.updated_at as "updatedAt"
        from public.work_project_guest guest
        join public.work_project project on project.work_project_id = guest.work_project_id
        join public.client_portal_user portal
          on portal.client_portal_user_id = guest.portal_user_id
        join public.client client on client.client_id = portal.client_id
        order by lower(project.name), lower(portal.display_name)
      `);
      return rows.map((row) => ({
        ...row,
        updatedAt: new Date(row.updatedAt).toISOString(),
      }));
    }),

    invite: workAdminProcedure
      .input(
        z.object({
          projectId: uuid,
          clientId: uuid,
          email: z.string().trim().email().max(320),
          displayName: z.string().trim().min(1).max(160),
          accessLevel,
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const policy = await getWorkOrganizationPolicy();
        if (
          !policy.externalSharingEnabled ||
          policy.guestInvitePolicy === "disabled"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "External sharing is disabled by organization policy",
          });
        }
        const email = input.email.toLowerCase();
        const db = getDb();
        let share: {
          shareId: string;
          projectId: string;
          portalUserId: string;
          clientId: string;
          email: string;
          displayName: string;
          accessLevel: "commenter" | "viewer";
          invitedByEmployeeId?: string;
          updatedAt: string;
        };
        if (!db) {
          const known = Object.values(DEV_USERS).find(
            (user) => user.actorType === "portal" && user.email === email,
          );
          share = saveDemoGuestShare({
            shareId: randomUUID(),
            projectId: input.projectId,
            portalUserId: known?.employeeId ?? randomUUID(),
            clientId: input.clientId,
            email,
            displayName: input.displayName,
            accessLevel: input.accessLevel,
            invitedByEmployeeId: employeeId,
            updatedAt: new Date().toISOString(),
          });
        } else {
          share = await db.transaction(async (tx) => {
            const users = await tx.execute<{ portalUserId: string }>(sql`
              insert into public.client_portal_user (
                client_id, email, display_name, is_active
              ) values (
                ${input.clientId}::uuid, ${email}, ${input.displayName}, true
              )
              on conflict (client_id, (lower(email))) do update set
                display_name = excluded.display_name, is_active = true, updated_at = now()
              returning client_portal_user_id as "portalUserId"
            `);
            const portalUserId = users[0]!.portalUserId;
            const rows = await tx.execute<{
              shareId: string;
              projectId: string;
              portalUserId: string;
              accessLevel: "commenter" | "viewer";
              updatedAt: Date | string;
            }>(sql`
              insert into public.work_project_guest (
                work_project_id, portal_user_id, access_level, invited_by_employee_id
              ) values (
                ${input.projectId}::uuid, ${portalUserId}::uuid,
                ${input.accessLevel}, ${employeeId}::uuid
              )
              on conflict (work_project_id, portal_user_id) do update set
                access_level = excluded.access_level,
                invited_by_employee_id = excluded.invited_by_employee_id,
                updated_at = now()
              returning work_project_guest_id as "shareId",
                work_project_id as "projectId", portal_user_id as "portalUserId",
                access_level as "accessLevel", updated_at as "updatedAt"
            `);
            return {
              ...rows[0]!,
              clientId: input.clientId,
              email,
              displayName: input.displayName,
              updatedAt: new Date(rows[0]!.updatedAt).toISOString(),
            };
          });
        }
        await audit(
          employeeId,
          "work.guest.invite",
          "work_project_guest",
          share.shareId,
          {
            projectId: share.projectId,
            portalUserId: share.portalUserId,
            accessLevel: share.accessLevel,
          },
        );
        return share;
      }),

    setAccess: workAdminProcedure
      .input(z.object({ projectId: uuid, portalUserId: uuid, accessLevel }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          const current = listDemoGuestShares().find(
            (share) =>
              share.projectId === input.projectId &&
              share.portalUserId === input.portalUserId,
          );
          if (!current) throw new TRPCError({ code: "NOT_FOUND" });
          saveDemoGuestShare({
            ...current,
            accessLevel: input.accessLevel,
            updatedAt: new Date().toISOString(),
          });
        } else {
          const rows = await db.execute(sql`
            update public.work_project_guest set access_level = ${input.accessLevel},
              updated_at = now()
            where work_project_id = ${input.projectId}::uuid
              and portal_user_id = ${input.portalUserId}::uuid
            returning work_project_guest_id
          `);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        await audit(
          employeeId,
          "work.guest.access",
          "work_project",
          input.projectId,
          {
            portalUserId: input.portalUserId,
            accessLevel: input.accessLevel,
          },
        );
        return { ok: true as const };
      }),

    revoke: workAdminProcedure
      .input(z.object({ projectId: uuid, portalUserId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) removeDemoGuestShare(input.projectId, input.portalUserId);
        else
          await db.execute(sql`
            delete from public.work_project_guest
            where work_project_id = ${input.projectId}::uuid
              and portal_user_id = ${input.portalUserId}::uuid
          `);
        await audit(
          employeeId,
          "work.guest.revoke",
          "work_project",
          input.projectId,
          {
            portalUserId: input.portalUserId,
          },
        );
        return { ok: true as const };
      }),
  }),

  members: router({
    list: workAdminProcedure.query(async () => {
      const db = getDb();
      if (!db) {
        return demoDirectory().employees.map((employee) => ({
          ...employee,
          licenseType: getDemoWorkLicense(employee.employeeId),
        }));
      }
      return db.execute<{
        employeeId: string;
        displayName: string;
        email: string;
        active: boolean;
        licenseType: "full" | "view_only";
      }>(sql`
        select employee.employee_id as "employeeId",
          employee.display_name as "displayName", employee.email,
          employee.is_active as active,
          coalesce(license.license_type, 'full') as "licenseType"
        from public.employee employee
        left join public.work_member_license license
          on license.employee_id = employee.employee_id
        order by lower(employee.display_name)
      `);
    }),

    setLicense: workAdminProcedure
      .input(
        z.object({
          employeeId: uuid,
          licenseType: z.enum(["full", "view_only"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        if (
          input.employeeId === employeeId &&
          input.licenseType === "view_only"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot make your own Work access view-only",
          });
        }
        const db = getDb();
        if (!db) setDemoWorkLicense(input.employeeId, input.licenseType);
        else
          await db.execute(sql`
            insert into public.work_member_license (
              employee_id, license_type, updated_by_employee_id
            ) values (
              ${input.employeeId}::uuid, ${input.licenseType}, ${employeeId}::uuid
            )
            on conflict (employee_id) do update set
              license_type = excluded.license_type,
              updated_by_employee_id = excluded.updated_by_employee_id,
              updated_at = now()
          `);
        await audit(
          employeeId,
          "work.member.license",
          "employee",
          input.employeeId,
          {
            licenseType: input.licenseType,
          },
        );
        return { ok: true as const };
      }),
  }),

  rbac: router({
    list: workAdminProcedure.query(async () => {
      const db = getDb();
      if (!db) {
        return getDemoStore().roles.map((base) => {
          const custom = demoRoles.get(base.key);
          return {
            key: base.key,
            displayName: custom?.displayName ?? base.displayName,
            policies: [...(custom?.policies ?? new Map())].map(
              ([permission, effect]) => {
                const [resource, action] = permission.split(":");
                return { resource: resource!, action: action!, effect };
              },
            ),
            members: [...(custom?.employeeIds ?? new Set())],
          };
        });
      }
      const [roles, policies, members] = await Promise.all([
        db.execute<{ key: string; displayName: string }>(sql`
          select key, display_name as "displayName" from public.role order by lower(display_name)
        `),
        db.execute<{
          roleKey: string;
          resource: string;
          action: string;
          effect: "allow" | "deny";
        }>(sql`
          select role.key as "roleKey", policy.resource, policy.action, policy.effect
          from public.permission_policy policy
          join public.role role on role.role_id = policy.role_id
          order by role.key, policy.resource, policy.action
        `),
        db.execute<{
          roleKey: string;
          employeeId: string;
          displayName: string;
        }>(sql`
          select role.key as "roleKey", membership.employee_id as "employeeId",
            employee.display_name as "displayName"
          from public.employee_role membership
          join public.role role on role.role_id = membership.role_id
          join public.employee employee on employee.employee_id = membership.employee_id
        `),
      ]);
      return roles.map((role) => ({
        ...role,
        policies: policies.filter((policy) => policy.roleKey === role.key),
        members: members.filter((member) => member.roleKey === role.key),
      }));
    }),

    createRole: workAdminProcedure
      .input(
        z.object({
          key: z
            .string()
            .trim()
            .regex(/^[a-z][a-z0-9_]{1,63}$/),
          displayName: z.string().trim().min(2).max(120),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          if (getDemoStore().roles.some((role) => role.key === input.key)) {
            throw new TRPCError({ code: "CONFLICT" });
          }
          getDemoStore().roles.push(input);
          demoRoles.set(input.key, {
            ...input,
            policies: new Map(),
            employeeIds: new Set(),
          });
        } else {
          await db.execute(sql`
            insert into public.role (key, display_name)
            values (${input.key}, ${input.displayName})
          `);
        }
        await audit(employeeId, "work.rbac.role.create", "role", null, input);
        return input;
      }),

    updateRole: workAdminProcedure
      .input(
        z.object({
          key: z.string().trim().min(1).max(64),
          displayName: z.string().trim().min(2).max(120),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          const role = getDemoStore().roles.find(
            (item) => item.key === input.key,
          );
          if (!role) throw new TRPCError({ code: "NOT_FOUND" });
          role.displayName = input.displayName;
        } else {
          const rows = await db.execute(sql`
            update public.role set display_name = ${input.displayName}, updated_at = now()
            where key = ${input.key} returning role_id
          `);
          if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
        }
        await audit(employeeId, "work.rbac.role.update", "role", null, input);
        return { ok: true as const };
      }),

    setPermission: workAdminProcedure
      .input(
        z.object({
          roleKey: z.string().trim().min(1).max(64),
          resource: z
            .string()
            .trim()
            .regex(/^[a-z0-9_*.-]{1,120}$/),
          action: z
            .string()
            .trim()
            .regex(/^[a-z0-9_*.-]{1,120}$/),
          effect: z.enum(["allow", "deny"]).nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          let role = demoRoles.get(input.roleKey);
          if (!role) {
            const base = getDemoStore().roles.find(
              (item) => item.key === input.roleKey,
            );
            if (!base) throw new TRPCError({ code: "NOT_FOUND" });
            role = {
              ...base,
              policies: new Map(),
              employeeIds: new Set(),
            };
            demoRoles.set(input.roleKey, role);
          }
          const key = `${input.resource}:${input.action}`;
          if (input.effect) role.policies.set(key, input.effect);
          else role.policies.delete(key);
        } else {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              delete from public.permission_policy policy
              using public.role role
              where policy.role_id = role.role_id and role.key = ${input.roleKey}
                and policy.resource = ${input.resource} and policy.action = ${input.action}
            `);
            if (input.effect) {
              await tx.execute(sql`
                insert into public.permission_policy (role_id, resource, action, effect)
                select role_id, ${input.resource}, ${input.action}, ${input.effect}
                from public.role where key = ${input.roleKey}
              `);
            }
          });
        }
        await audit(
          employeeId,
          "work.rbac.permission.set",
          "role",
          null,
          input,
        );
        return { ok: true as const };
      }),

    setMember: workAdminProcedure
      .input(
        z.object({
          roleKey: z.string().trim().min(1).max(64),
          employeeId: uuid,
          assigned: z.boolean(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const db = getDb();
        if (!db) {
          let role = demoRoles.get(input.roleKey);
          if (!role) {
            const base = getDemoStore().roles.find(
              (item) => item.key === input.roleKey,
            );
            if (!base) throw new TRPCError({ code: "NOT_FOUND" });
            role = {
              ...base,
              policies: new Map(),
              employeeIds: new Set(),
            };
            demoRoles.set(input.roleKey, role);
          }
          if (input.assigned) role.employeeIds.add(input.employeeId);
          else role.employeeIds.delete(input.employeeId);
        } else if (input.assigned) {
          await db.execute(sql`
            insert into public.employee_role (employee_id, role_id)
            select ${input.employeeId}::uuid, role_id from public.role where key = ${input.roleKey}
            on conflict (employee_id, role_id) do nothing
          `);
        } else {
          await db.execute(sql`
            delete from public.employee_role membership using public.role role
            where membership.role_id = role.role_id and role.key = ${input.roleKey}
              and membership.employee_id = ${input.employeeId}::uuid
          `);
        }
        await audit(
          employeeId,
          "work.rbac.member.set",
          "employee",
          input.employeeId,
          {
            roleKey: input.roleKey,
            assigned: input.assigned,
          },
        );
        return { ok: true as const };
      }),
  }),

  identity: router({
    get: workAdminProcedure.query(async () => {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(
        /\/$/,
        "",
      );
      return {
        sso: await getWorkSsoConfiguration(),
        scimTokens: await listScimTokens(),
        serviceProvider: supabaseUrl
          ? {
              entityId: `${supabaseUrl}/auth/v1/sso/saml/metadata`,
              metadataUrl: `${supabaseUrl}/auth/v1/sso/saml/metadata`,
              acsUrl: `${supabaseUrl}/auth/v1/sso/saml/acs`,
              scimBaseUrl: `${process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000"}/api/scim/v2`,
            }
          : null,
      };
    }),

    saveSso: workAdminProcedure
      .input(
        z.object({
          status: z.enum(["disabled", "optional", "enforced"]),
          providerId: z.string().trim().max(200).nullable(),
          metadataUrl: z.string().trim().url().max(2048).nullable(),
          domains: z.array(z.string().trim().min(1).max(253)).max(100),
          breakGlassEmails: z.array(z.string().trim().email().max(320)).max(20),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const saved = await saveWorkSsoConfiguration(input, employeeId);
        await audit(
          employeeId,
          "work.identity.sso.update",
          "work_sso_configuration",
          null,
          {
            status: saved.status,
            providerId: saved.providerId,
            domains: saved.domains,
          },
        );
        return saved;
      }),

    issueScimToken: workAdminProcedure
      .input(
        z.object({
          label: z.string().trim().min(1).max(120),
          expiresAt: z.string().datetime().nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const token = await issueScimToken({
          label: input.label,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          employeeId,
        });
        await audit(
          employeeId,
          "work.identity.scim_token.issue",
          "work_scim_token",
          token.tokenId,
          { label: token.label, expiresAt: token.expiresAt },
        );
        return token;
      }),

    revokeScimToken: workAdminProcedure
      .input(z.object({ tokenId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        await revokeScimToken(input.tokenId);
        await audit(
          employeeId,
          "work.identity.scim_token.revoke",
          "work_scim_token",
          input.tokenId,
          { revoked: true },
        );
        return { ok: true as const };
      }),
  }),

  apiWebhooks: router({
    get: workAdminProcedure.query(() => listWorkApiConfiguration()),

    issueToken: workAdminProcedure
      .input(
        z.object({
          label: z.string().trim().min(1).max(120),
          scopes: z
            .array(z.enum(WORK_API_SCOPES))
            .min(1)
            .max(WORK_API_SCOPES.length),
          expiresAt: z.string().datetime().nullable(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const token = await issueWorkApiToken({
          label: input.label,
          scopes: [...new Set(input.scopes)],
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          employeeId,
          employeeName: ctx.user?.displayName,
        });
        await audit(
          employeeId,
          "work.api.token.issue",
          "work_api_token",
          token.tokenId,
          {
            label: token.label,
            scopes: token.scopes,
            expiresAt: token.expiresAt,
          },
        );
        return token;
      }),

    revokeToken: workAdminProcedure
      .input(z.object({ tokenId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        await revokeWorkApiToken(input.tokenId);
        await audit(
          employeeId,
          "work.api.token.revoke",
          "work_api_token",
          input.tokenId,
          { revoked: true },
        );
        return { ok: true as const };
      }),

    createWebhook: workAdminProcedure
      .input(
        z.object({
          projectId: uuid,
          name: z.string().trim().min(1).max(120),
          targetUrl: z.string().trim().url().max(2048),
          eventTypes: z
            .array(z.enum(WORK_WEBHOOK_EVENTS))
            .min(1)
            .max(WORK_WEBHOOK_EVENTS.length),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        await requireProjectAccess(ctx, input.projectId, "admin");
        const webhook = await createWorkWebhook({
          ...input,
          eventTypes: [...new Set(input.eventTypes)],
          employeeId,
          employeeName: ctx.user?.displayName,
        });
        await audit(
          employeeId,
          "work.webhook.create",
          "work_webhook_subscription",
          webhook.subscriptionId,
          {
            projectId: input.projectId,
            targetUrl: webhook.targetUrl,
            eventTypes: webhook.eventTypes,
          },
        );
        return webhook;
      }),

    deleteWebhook: workAdminProcedure
      .input(z.object({ subscriptionId: uuid }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        await deleteWorkWebhook(input.subscriptionId);
        await audit(
          employeeId,
          "work.webhook.delete",
          "work_webhook_subscription",
          input.subscriptionId,
          { deleted: true },
        );
        return { ok: true as const };
      }),
  }),

  aiGovernance: router({
    get: workAdminProcedure.query(async () => ({
      policy: await getWorkAiPolicy(),
      usage: await getWorkAiUsage(),
    })),
    save: workAdminProcedure
      .input(
        z.object({
          model: z.string().trim().min(1).max(200).nullable(),
          monthlyTokenLimit: z.number().int().min(1_000).max(1_000_000_000),
          dailyUserRequestLimit: z.number().int().min(1).max(10_000),
          retentionDays: z.number().int().min(1).max(365),
          requireHumanApproval: z.literal(true),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const saved = await saveWorkAiPolicy(input, employeeId);
        await audit(
          employeeId,
          "work.ai.policy.update",
          "work_ai_policy",
          null,
          {
            model: saved.model,
            monthlyTokenLimit: saved.monthlyTokenLimit,
            dailyUserRequestLimit: saved.dailyUserRequestLimit,
            retentionDays: saved.retentionDays,
            requireHumanApproval: saved.requireHumanApproval,
          },
        );
        return saved;
      }),
  }),

  sandboxes: router({
    get: workAdminProcedure.query(() => getWorkSandbox()),

    activate: workAdminProcedure
      .input(z.object({ name: z.string().trim().min(1).max(120) }))
      .mutation(async ({ input, ctx }) => {
        const employeeId = actor(ctx.employeeId);
        const sandbox = await activateWorkSandbox(input.name, employeeId);
        await audit(
          employeeId,
          "work.sandbox.activate",
          "work_sandbox",
          sandbox?.sandboxId ?? null,
          sandbox ?? null,
        );
        return sandbox;
      }),

    verify: workAdminProcedure.mutation(async ({ ctx }) => {
      const employeeId = actor(ctx.employeeId);
      const sandbox = await verifyWorkSandbox();
      await audit(
        employeeId,
        "work.sandbox.verify",
        "work_sandbox",
        sandbox.sandboxId,
        { status: sandbox.status, lastVerifiedAt: sandbox.lastVerifiedAt },
      );
      return sandbox;
    }),

    delete: workAdminProcedure
      .input(z.object({ confirmation: z.literal("DELETE SANDBOX") }))
      .mutation(async ({ ctx }) => {
        const employeeId = actor(ctx.employeeId);
        await deleteWorkSandbox(employeeId);
        await audit(employeeId, "work.sandbox.delete", "work_sandbox", null, {
          deleted: true,
        });
        return { ok: true as const };
      }),
  }),

  export: router({
    audit: workAdminProcedure
      .input(
        z.object({ limit: z.number().int().min(1).max(10_000).default(1000) }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const rows = db
          ? await db.execute<Record<string, unknown>>(sql`
              select audit_event_id, actor_employee_id, actor_portal_user_id,
                action, entity_type, entity_id, before, after, reason, created_at
              from public.audit_event order by created_at desc limit ${input.limit}
            `)
          : getDemoStore().audits.slice(-input.limit).reverse();
        return {
          filename: `hrmny-audit-${new Date().toISOString().slice(0, 10)}.csv`,
          contentType: "text/csv;charset=utf-8",
          content: rowsToCsv(rows as Record<string, unknown>[]),
        };
      }),

    organization: workAdminProcedure.query(async () => {
      const db = getDb();
      let data: Record<string, unknown>;
      if (!db) {
        data = {
          policy: await getWorkOrganizationPolicy(),
          teams: [...demoTeams.values()].map((team) => ({
            ...team,
            members: [...team.members],
            projectIds: [...team.projectIds],
          })),
          projects: [...getDemoWork().projects.values()],
          guests: listDemoGuestShares(),
        };
      } else {
        const tables = await Promise.all(
          WORK_EXPORT_TABLES.map(async (table) => [
            table,
            await db.execute(sql.raw(`select * from public.${table}`)),
          ]),
        );
        data = Object.fromEntries(tables);
      }
      return {
        filename: `hrmny-work-backup-${new Date().toISOString().slice(0, 10)}.json`,
        contentType: "application/json",
        content: JSON.stringify(
          { exportedAt: new Date().toISOString(), schemaVersion: 1, data },
          null,
          2,
        ),
      };
    }),
  }),
});

export function clearDemoWorkAdmin() {
  demoTeams.clear();
  demoRoles.clear();
}

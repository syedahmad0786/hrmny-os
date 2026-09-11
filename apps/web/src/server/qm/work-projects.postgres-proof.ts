import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { expect, it } from "vitest";
import { resolveActiveStaffByEmails } from "../auth/session";
import { getDb } from "../db";
import { readQmWorkProjects } from "./work-projects";
import {
  readProjectAccessForEmployees,
  requireProjectAccess,
} from "../trpc/work-management-router";

it("uses the shared canonical query for direct, team, and organization project authority", async () => {
  const db = getDb()!;
  const creator = randomUUID();
  const direct = randomUUID();
  const team = randomUUID();
  const organization = randomUUID();
  const inactive = randomUUID();
  const directProject = randomUUID();
  const teamProject = randomUUID();
  const organizationProject = randomUUID();
  const hiddenProject = randomUUID();
  const teamId = randomUUID();
  const email = (id: string) => `qm-project-proof-${id}@hrmny.co`;

  try {
    await db.execute(sql`
      insert into public.employee (
        employee_id, display_name, email, is_active
      ) values
        (${creator}::uuid, 'QM project creator', ${email(creator)}, true),
        (${direct}::uuid, 'QM direct member', ${email(direct)}, true),
        (${team}::uuid, 'QM team member', ${email(team)}, true),
        (${organization}::uuid, 'QM organization member', ${email(organization)}, true),
        (${inactive}::uuid, 'QM inactive member', ${email(inactive)}, false)
    `);
    await db.execute(sql`
      insert into public.work_project (
        work_project_id, name, privacy, created_by_employee_id
      ) values
        (${directProject}::uuid, ${`QM direct ${directProject}`}, 'private', ${creator}::uuid),
        (${teamProject}::uuid, ${`QM team ${teamProject}`}, 'private', ${creator}::uuid),
        (${organizationProject}::uuid, ${`QM organization ${organizationProject}`}, 'organization', ${creator}::uuid),
        (${hiddenProject}::uuid, ${`QM hidden ${hiddenProject}`}, 'private', ${creator}::uuid)
    `);
    await db.execute(sql`
      insert into public.work_project_member (
        work_project_id, employee_id, access_level
      ) values
        (${directProject}::uuid, ${direct}::uuid, 'editor'),
        (${directProject}::uuid, ${inactive}::uuid, 'admin')
    `);
    await db.execute(sql`
      insert into public.work_team (
        work_team_id, name, created_by_employee_id
      ) values (${teamId}::uuid, ${`QM proof ${teamId}`}, ${creator}::uuid)
    `);
    await db.execute(sql`
      insert into public.work_team_member (work_team_id, employee_id)
      values (${teamId}::uuid, ${team}::uuid)
    `);
    await db.execute(sql`
      insert into public.work_team_project (
        work_team_id, work_project_id, access_level
      ) values (${teamId}::uuid, ${teamProject}::uuid, 'commenter')
    `);

    const rows = await readProjectAccessForEmployees(
      [direct, team, organization],
      [directProject, teamProject, organizationProject, hiddenProject],
    );
    expect(
      rows.map((row) => [row.actorEmployeeId, row.projectId, row.accessLevel]),
    ).toEqual(
      expect.arrayContaining([
        [direct, directProject, "editor"],
        [direct, organizationProject, "viewer"],
        [team, teamProject, "commenter"],
        [team, organizationProject, "viewer"],
        [organization, organizationProject, "viewer"],
      ]),
    );
    expect(
      rows.some(
        (row) =>
          row.actorEmployeeId !== creator && row.projectId === hiddenProject,
      ),
    ).toBe(false);

    const directStaff = await resolveActiveStaffByEmails([
      email(direct),
      email(inactive),
    ]);
    expect(directStaff.map((staff) => staff.employeeId)).toEqual([direct]);
    const single = await requireProjectAccess(
      {
        user: directStaff[0]!,
        employeeId: direct,
        roles: directStaff[0]!.roles,
        canViewMargin: false,
        clientId: null,
      },
      directProject,
    );
    expect(single.accessLevel).toBe("editor");
    expect(single).not.toHaveProperty("actorEmployeeId");

    const projection = await readQmWorkProjects({
      operation: "project",
      projectId: directProject,
    });
    expect(projection.revision).toMatch(/^\d+$/);
    expect(projection.projects).toEqual([
      expect.objectContaining({
        id: directProject,
        ownerId: null,
        memberIds: expect.arrayContaining([email(creator), email(direct)]),
        permissions: expect.objectContaining({
          [email(creator)]: "manage",
          [email(direct)]: "write",
        }),
        authorityVersion: projection.revision,
      }),
    ]);
    expect(projection.projects[0]!.memberIds).not.toContain(email(inactive));
  } finally {
    await db.execute(sql`
      delete from public.work_team_project where work_team_id = ${teamId}::uuid
    `);
    await db.execute(sql`
      delete from public.work_team_member where work_team_id = ${teamId}::uuid
    `);
    await db.execute(sql`
      delete from public.work_team where work_team_id = ${teamId}::uuid
    `);
    await db.execute(sql`
      delete from public.work_project_member
        where work_project_id in (
          ${directProject}::uuid, ${teamProject}::uuid,
          ${organizationProject}::uuid, ${hiddenProject}::uuid
        )
    `);
    await db.execute(sql`
      delete from public.work_project
        where work_project_id in (
          ${directProject}::uuid, ${teamProject}::uuid,
          ${organizationProject}::uuid, ${hiddenProject}::uuid
        )
    `);
    await db.execute(sql`
      delete from public.employee
        where employee_id in (
          ${creator}::uuid, ${direct}::uuid, ${team}::uuid,
          ${organization}::uuid, ${inactive}::uuid
        )
    `);
  }
});

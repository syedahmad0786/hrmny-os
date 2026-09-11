import { sql, type Db } from "@hrmny/db";
import { z } from "zod";
import { FEATURE_BY_KEY } from "@/features/catalog";
import { resolveActiveStaffByEmails, type SessionUser } from "../auth/session";
import { getDb, withDatabaseScope } from "../db";
import {
  listFeatureOverrides,
  resolveFeature,
  type FeatureOverride,
} from "../features";
import {
  readProjectAccessForEmployees,
  type AccessLevel,
} from "../trpc/work-management-router";
import { listWorkViewOnlyMemberIds } from "../work-governance";

export const MAX_QM_WORK_PROJECTS = 100;
export const MAX_QM_WORK_STAFF = 200;

const canonicalStaffEmail = z
  .string()
  .email()
  .max(254)
  .refine(
    (email) =>
      email === email.trim().toLowerCase() && email.endsWith("@hrmny.co"),
    "Canonical hrmny.co staff email required",
  );

export const qmWorkProjectsInput = z.discriminatedUnion("operation", [
  z
    .object({ operation: z.literal("project"), projectId: z.string().uuid() })
    .strict(),
  z
    .object({ operation: z.literal("list"), principalId: canonicalStaffEmail })
    .strict(),
]);

export type QmWorkProjectsInput = z.infer<typeof qmWorkProjectsInput>;
export type QmWorkPermission = "read" | "write" | "manage";
export type QmWorkProject = {
  id: string;
  name: string;
  ownerId: string | null;
  memberIds: string[];
  permissions: Record<string, QmWorkPermission>;
  createdAt: number;
  updatedAt: number;
  authorityVersion: string;
};
export type QmWorkProjectsResponse = {
  revision: string;
  projects: QmWorkProject[];
};

type CandidateProject = {
  projectId: string;
  name: string;
  clientId: string | null;
  ownerEmail: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function outputEmail(rawEmail: string | null): string | null {
  if (!rawEmail) return null;
  const email = rawEmail.trim().toLowerCase();
  return canonicalStaffEmail.safeParse(email).success ? email : null;
}

function permissionFor(
  accessLevel: AccessLevel,
  viewOnly: boolean,
): QmWorkPermission {
  if (viewOnly || accessLevel === "viewer" || accessLevel === "commenter")
    return "read";
  return accessLevel === "admin" ? "manage" : "write";
}

function featureAllowsProject(
  staff: SessionUser,
  clientId: string | null,
  overrides: readonly FeatureOverride[],
): boolean {
  const feature = FEATURE_BY_KEY.get("work.projects");
  if (!feature) throw new Error("QM_WORK_PROJECT_FEATURE_MISSING");
  return resolveFeature(feature, overrides, {
    userId: staff.employeeId,
    clientId,
    roles: staff.roles,
  }).enabled;
}

async function candidateProjects(
  db: Db,
  input: QmWorkProjectsInput,
): Promise<CandidateProject[]> {
  const projectFilter =
    input.operation === "project"
      ? sql`and project.work_project_id = ${input.projectId}::uuid`
      : sql``;
  const limit = input.operation === "project" ? 1 : MAX_QM_WORK_PROJECTS + 1;
  const rows = await db.execute<CandidateProject>(sql`
    select project.work_project_id as "projectId", project.name,
      project.client_id as "clientId", owner.email as "ownerEmail",
      project.created_at as "createdAt", project.updated_at as "updatedAt"
    from public.work_project project
    left join public.employee owner
      on owner.employee_id = project.owner_employee_id
    where project.archived_at is null
      and project.project_kind = 'standard'
      ${projectFilter}
    order by lower(project.name), project.work_project_id
    limit ${limit}
  `);
  if (rows.length > MAX_QM_WORK_PROJECTS)
    throw new Error("QM_WORK_PROJECT_LIMIT_EXCEEDED");
  return rows;
}

async function activeStaff(db: Db): Promise<SessionUser[]> {
  const rows = await db.execute<{ email: string }>(sql`
    select email
    from public.employee
    where is_active = true
    order by lower(email), employee_id
    limit ${MAX_QM_WORK_STAFF + 1}
  `);
  if (rows.length > MAX_QM_WORK_STAFF)
    throw new Error("QM_WORK_STAFF_LIMIT_EXCEEDED");
  const staff = await resolveActiveStaffByEmails(rows.map((row) => row.email));
  const canonical = staff.flatMap((person) => {
    const email = outputEmail(person.email);
    return email ? [{ ...person, email }] : [];
  });
  if (
    new Set(canonical.map((person) => person.email)).size !== canonical.length
  )
    throw new Error("QM_WORK_STAFF_IDENTITY_INVALID");
  return canonical;
}

async function projectSnapshot(
  db: Db,
  input: QmWorkProjectsInput,
  revision: string,
): Promise<QmWorkProjectsResponse> {
  const candidates = await candidateProjects(db, input);
  const staff = await activeStaff(db);
  const overrides = await listFeatureOverrides();
  if (!candidates.length || !staff.length) return { revision, projects: [] };

  const staffById = new Map(staff.map((person) => [person.employeeId, person]));
  let visibleCandidates = candidates;
  if (input.operation === "list") {
    const principal = staff.find(
      (person) => outputEmail(person.email) === input.principalId,
    );
    if (!principal) return { revision, projects: [] };
    const principalAccess = await readProjectAccessForEmployees(
      [principal.employeeId],
      candidates.map((project) => project.projectId),
    );
    const candidatesById = new Map(
      candidates.map((project) => [project.projectId, project]),
    );
    const readable = new Set(
      principalAccess
        .filter((access) => {
          const project = candidatesById.get(access.projectId);
          return (
            project &&
            featureAllowsProject(principal, project.clientId, overrides)
          );
        })
        .map((access) => access.projectId),
    );
    visibleCandidates = candidates.filter((project) =>
      readable.has(project.projectId),
    );
  }
  if (!visibleCandidates.length) return { revision, projects: [] };

  // ponytail: one request-local batch replaces O(staff * projects) round trips;
  // current explicit ceilings remain the scale boundary until measured otherwise.
  const [accessRows, viewOnlyIds] = await Promise.all([
    readProjectAccessForEmployees(
      staff.map((person) => person.employeeId),
      visibleCandidates.map((project) => project.projectId),
    ),
    listWorkViewOnlyMemberIds(staff.map((person) => person.employeeId)),
  ]);
  const visibleById = new Map(
    visibleCandidates.map((project) => [project.projectId, project]),
  );
  const accessByProject = new Map<string, Map<string, QmWorkPermission>>();
  for (const access of accessRows) {
    const person = staffById.get(access.actorEmployeeId);
    const project = visibleById.get(access.projectId);
    const email = outputEmail(person?.email ?? null);
    if (
      !person ||
      !project ||
      !email ||
      !featureAllowsProject(person, project.clientId, overrides)
    )
      continue;
    const projectAccess = accessByProject.get(project.projectId) ?? new Map();
    projectAccess.set(
      email,
      permissionFor(access.accessLevel, viewOnlyIds.has(person.employeeId)),
    );
    accessByProject.set(project.projectId, projectAccess);
  }

  const projects = visibleCandidates.flatMap((project) => {
    const access = accessByProject.get(project.projectId);
    if (!access?.size) return [];
    const memberIds = [...access.keys()].sort();
    return [
      {
        id: project.projectId,
        name: project.name,
        ownerId: outputEmail(project.ownerEmail),
        memberIds,
        permissions: Object.fromEntries(
          memberIds.map((email) => [email, access.get(email)!]),
        ),
        createdAt: new Date(project.createdAt).getTime(),
        updatedAt: new Date(project.updatedAt).getTime(),
        authorityVersion: revision,
      },
    ];
  });
  return { revision, projects };
}

export async function readQmWorkProjects(
  rawInput: unknown,
): Promise<QmWorkProjectsResponse> {
  const input = qmWorkProjectsInput.parse(rawInput);
  const db = getDb();
  if (!db) throw new Error("QM_WORK_PROJECTS_DATABASE_REQUIRED");
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      set transaction isolation level repeatable read, read only
    `);
    await tx.execute(sql`set local lock_timeout = '1s'`);
    await tx.execute(sql`set local statement_timeout = '4s'`);
    await tx.execute(sql`set local idle_in_transaction_session_timeout = '5s'`);
    const [state] = await tx.execute<{ revision: string }>(sql`
      select revision::text as revision
      from qm_internal.work_authority_revision
      where singleton = true
    `);
    if (!state) throw new Error("WORK_AUTHORITY_FENCE_STATE_MISSING");
    return withDatabaseScope(tx as unknown as Db, () =>
      projectSnapshot(tx as unknown as Db, input, state.revision),
    );
  });
}

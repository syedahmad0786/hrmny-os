import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { SessionUser } from "./auth/session";
import { getDb } from "./db";
import { featureEnabled } from "./features";
import { writeAudit } from "./m1-persistence";
import type { TrpcContext } from "./trpc/trpc";
import {
  getDemoWork,
  requireItemAccess,
  requireProjectAccess,
} from "./trpc/work-management-router";
import {
  generateWorkAi,
  requireWorkAiFeature,
  type WorkAiAction,
  type WorkAiRun,
} from "./work-ai";
import {
  registerDemoWorkAiActor,
  unregisterDemoWorkAiActor,
  workAiContextForEmployee,
} from "./work-ai-actor";

const teammateActionTypes = [
  "create_task",
  "update_task",
  "create_comment",
  "create_project",
] as const;
type TeammateActionType = (typeof teammateActionTypes)[number];
type TeammateMemberAccess = "owner" | "editor" | "user";
type ProjectAccess = "editor" | "commenter" | "viewer";

export const workAiTeammateInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  roleDescription: z.string().trim().max(20_000).default(""),
  instructions: z.string().trim().min(1).max(20_000),
  allowedActionTypes: z
    .array(z.enum(teammateActionTypes))
    .max(teammateActionTypes.length)
    .default([]),
  model: z.string().trim().min(1).max(200).nullable().default(null),
});
export const workAiTeammateSkillInputSchema = z.object({
  name: z.string().trim().min(1).max(160),
  guidance: z.string().trim().min(1).max(20_000),
  triggerCondition: z.string().trim().max(2_000).default(""),
  referenceText: z.string().trim().max(50_000).default(""),
  isActive: z.boolean().default(true),
});

type WorkAiTeammate = z.infer<typeof workAiTeammateInputSchema> & {
  teammateId: string;
  employeeId: string;
  status: "active" | "paused";
  memberAccess: TeammateMemberAccess;
  createdByEmployeeId: string;
  createdAt: string;
  updatedAt: string;
};
type WorkAiTeammateSkill = z.infer<typeof workAiTeammateSkillInputSchema> & {
  skillId: string;
  teammateId: string;
  createdAt: string;
  updatedAt: string;
};
type WorkAiTeammateMemory = {
  memoryId: string;
  teammateId: string;
  itemId: string;
  itemTitle?: string;
  content: string;
  createdAt: string;
};
type WorkAiTeammateRun = {
  teammateRunId: string;
  teammateId: string;
  aiRunId: string | null;
  projectId: string;
  itemId: string | null;
  triggeredByEmployeeId: string;
  triggerType: "manual" | "assignment" | "mention" | "rule" | "follow_up";
  requestText: string;
  selectedSkillIds: string[];
  eventKey: string;
  status: "running" | "answered" | "proposed" | "failed";
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
};

const demoTeammates = new Map<string, WorkAiTeammate>();
const demoMembers = new Map<string, TeammateMemberAccess>();
const demoProjectAccess = new Map<string, ProjectAccess>();
const demoSkills = new Map<string, WorkAiTeammateSkill>();
const demoMemories = new Map<string, WorkAiTeammateMemory>();
const demoRuns = new Map<string, WorkAiTeammateRun>();
const demoEvents = new Map<string, string>();

function actor(ctx: TrpcContext) {
  if (!ctx.employeeId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return ctx.employeeId;
}
const memberRank: Record<TeammateMemberAccess, number> = {
  user: 1,
  editor: 2,
  owner: 3,
};
const projectRank: Record<ProjectAccess, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
};

function mapTeammate(row: {
  teammateId: string;
  employeeId: string;
  name: string;
  roleDescription: string;
  instructions: string;
  allowedActionTypes: TeammateActionType[];
  model: string | null;
  status: "active" | "paused";
  memberAccess: TeammateMemberAccess;
  createdByEmployeeId: string;
  createdAt: Date | string;
  updatedAt: Date | string;
}): WorkAiTeammate {
  return {
    ...row,
    allowedActionTypes: row.allowedActionTypes ?? [],
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function teammateById(
  ctx: TrpcContext,
  teammateId: string,
  minimum: TeammateMemberAccess = "user",
) {
  const employeeId = actor(ctx);
  const db = getDb();
  let teammate: WorkAiTeammate | undefined;
  if (!db) {
    const row = demoTeammates.get(teammateId);
    const access = demoMembers.get(`${teammateId}:${employeeId}`);
    if (row && access) teammate = { ...row, memberAccess: access };
  } else {
    const [row] = await db.execute<Parameters<typeof mapTeammate>[0]>(sql`
      select teammate.work_ai_teammate_id as "teammateId",
        teammate.employee_id as "employeeId", teammate.name,
        teammate.role_description as "roleDescription", teammate.instructions,
        teammate.allowed_action_types as "allowedActionTypes", teammate.model,
        teammate.status, member.access_level as "memberAccess",
        teammate.created_by_employee_id as "createdByEmployeeId",
        teammate.created_at as "createdAt", teammate.updated_at as "updatedAt"
      from public.work_ai_teammate teammate
      join public.work_ai_teammate_member member
        on member.work_ai_teammate_id = teammate.work_ai_teammate_id
        and member.employee_id = ${employeeId}::uuid
      where teammate.work_ai_teammate_id = ${teammateId}::uuid
        and teammate.archived_at is null
      limit 1
    `);
    if (row) teammate = mapTeammate(row);
  }
  if (!teammate) throw new TRPCError({ code: "NOT_FOUND" });
  if (memberRank[teammate.memberAccess] < memberRank[minimum])
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${minimum} AI Teammate access required`,
    });
  return teammate;
}

export async function listWorkAiTeammates(ctx: TrpcContext) {
  const employeeId = actor(ctx);
  const db = getDb();
  if (!db)
    return [...demoTeammates.values()]
      .flatMap((teammate) => {
        const access = demoMembers.get(`${teammate.teammateId}:${employeeId}`);
        return access ? [{ ...teammate, memberAccess: access }] : [];
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  const rows = await db.execute<Parameters<typeof mapTeammate>[0]>(sql`
    select teammate.work_ai_teammate_id as "teammateId",
      teammate.employee_id as "employeeId", teammate.name,
      teammate.role_description as "roleDescription", teammate.instructions,
      teammate.allowed_action_types as "allowedActionTypes", teammate.model,
      teammate.status, member.access_level as "memberAccess",
      teammate.created_by_employee_id as "createdByEmployeeId",
      teammate.created_at as "createdAt", teammate.updated_at as "updatedAt"
    from public.work_ai_teammate teammate
    join public.work_ai_teammate_member member
      on member.work_ai_teammate_id = teammate.work_ai_teammate_id
      and member.employee_id = ${employeeId}::uuid
    where teammate.archived_at is null
    order by lower(teammate.name)
  `);
  return rows.map(mapTeammate);
}

export async function createWorkAiTeammate(
  ctx: TrpcContext,
  raw: z.infer<typeof workAiTeammateInputSchema>,
) {
  const input = workAiTeammateInputSchema.parse(raw);
  const creatorId = actor(ctx);
  const teammateId = randomUUID();
  const syntheticEmployeeId = randomUUID();
  const now = new Date().toISOString();
  const teammate: WorkAiTeammate = {
    ...input,
    allowedActionTypes: [...new Set(input.allowedActionTypes)],
    teammateId,
    employeeId: syntheticEmployeeId,
    status: "active",
    memberAccess: "owner",
    createdByEmployeeId: creatorId,
    createdAt: now,
    updatedAt: now,
  };
  const email = `ai-${teammateId}@teammate.hrmny.internal`;
  const db = getDb();
  if (!db) {
    demoTeammates.set(teammateId, teammate);
    demoMembers.set(`${teammateId}:${creatorId}`, "owner");
    const user: SessionUser = {
      employeeId: syntheticEmployeeId,
      email,
      displayName: input.name,
      roles: [],
      permissions: [],
      actorType: "staff",
      clientId: null,
    };
    registerDemoWorkAiActor(user);
  } else
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into public.employee (employee_id, display_name, email)
        values (${syntheticEmployeeId}::uuid, ${input.name}, ${email})
      `);
      await tx.execute(sql`
        insert into public.work_ai_teammate (
          work_ai_teammate_id, employee_id, name, role_description,
          instructions, allowed_action_types, model,
          created_by_employee_id, updated_by_employee_id
        ) values (
          ${teammateId}::uuid, ${syntheticEmployeeId}::uuid, ${input.name},
          ${input.roleDescription}, ${input.instructions},
          ${teammate.allowedActionTypes}::text[], ${input.model},
          ${creatorId}::uuid, ${creatorId}::uuid
        )
      `);
      await tx.execute(sql`
        insert into public.work_ai_teammate_member (
          work_ai_teammate_id, employee_id, access_level
        ) values (${teammateId}::uuid, ${creatorId}::uuid, 'owner')
      `);
    });
  await writeAudit({
    actorEmployeeId: creatorId,
    action: "work.ai.teammate.create",
    entityType: "work_ai_teammate",
    entityId: teammateId,
    before: null,
    after: {
      name: input.name,
      allowedActionTypes: teammate.allowedActionTypes,
    },
    reason: null,
  });
  return teammate;
}

export async function updateWorkAiTeammate(
  ctx: TrpcContext,
  teammateId: string,
  raw: z.infer<typeof workAiTeammateInputSchema>,
) {
  const input = workAiTeammateInputSchema.parse(raw);
  const employeeId = actor(ctx);
  const teammate = await teammateById(ctx, teammateId, "editor");
  const before = {
    name: teammate.name,
    allowedActionTypes: teammate.allowedActionTypes,
  };
  const allowedActionTypes = [...new Set(input.allowedActionTypes)];
  const db = getDb();
  if (!db) {
    Object.assign(teammate, input, {
      allowedActionTypes,
      updatedAt: new Date().toISOString(),
    });
    const stored = demoTeammates.get(teammateId);
    if (stored) Object.assign(stored, teammate);
    registerDemoWorkAiActor({
      ...(await workAiContextForEmployee(teammate.employeeId)).user!,
      displayName: input.name,
    });
  } else
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update public.work_ai_teammate set name = ${input.name},
          role_description = ${input.roleDescription},
          instructions = ${input.instructions},
          allowed_action_types = ${allowedActionTypes}::text[], model = ${input.model},
          updated_by_employee_id = ${employeeId}::uuid, updated_at = now()
        where work_ai_teammate_id = ${teammateId}::uuid and archived_at is null
      `);
      await tx.execute(sql`
        update public.employee set display_name = ${input.name}, updated_at = now()
        where employee_id = ${teammate.employeeId}::uuid
      `);
    });
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "work.ai.teammate.update",
    entityType: "work_ai_teammate",
    entityId: teammateId,
    before,
    after: { name: input.name, allowedActionTypes },
    reason: null,
  });
  return teammateById(ctx, teammateId);
}

export async function setWorkAiTeammateStatus(
  ctx: TrpcContext,
  teammateId: string,
  status: "active" | "paused",
) {
  const employeeId = actor(ctx);
  const teammate = await teammateById(ctx, teammateId, "editor");
  const previousStatus = teammate.status;
  const db = getDb();
  if (!db) {
    teammate.status = status;
    demoTeammates.get(teammateId)!.status = status;
  } else
    await db.execute(sql`
      update public.work_ai_teammate set status = ${status},
        updated_by_employee_id = ${employeeId}::uuid, updated_at = now()
      where work_ai_teammate_id = ${teammateId}::uuid and archived_at is null
    `);
  await writeAudit({
    actorEmployeeId: employeeId,
    action: `work.ai.teammate.${status}`,
    entityType: "work_ai_teammate",
    entityId: teammateId,
    before: { status: previousStatus },
    after: { status },
    reason: null,
  });
  return teammateById(ctx, teammateId);
}

export async function archiveWorkAiTeammate(
  ctx: TrpcContext,
  teammateId: string,
) {
  const employeeId = actor(ctx);
  const teammate = await teammateById(ctx, teammateId, "owner");
  const db = getDb();
  if (!db) {
    demoTeammates.delete(teammateId);
    for (const key of demoMembers.keys())
      if (key.startsWith(`${teammateId}:`)) demoMembers.delete(key);
    for (const key of demoProjectAccess.keys())
      if (key.startsWith(`${teammateId}:`)) demoProjectAccess.delete(key);
    for (const [id, skill] of demoSkills)
      if (skill.teammateId === teammateId) demoSkills.delete(id);
    for (const [id, memory] of demoMemories)
      if (memory.teammateId === teammateId) demoMemories.delete(id);
    unregisterDemoWorkAiActor(teammate.employeeId);
  } else
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        update public.work_ai_teammate set status = 'paused', archived_at = now(),
          updated_by_employee_id = ${employeeId}::uuid, updated_at = now()
        where work_ai_teammate_id = ${teammateId}::uuid
      `);
      await tx.execute(sql`
        update public.employee set is_active = false, updated_at = now()
        where employee_id = ${teammate.employeeId}::uuid
      `);
      await tx.execute(sql`
        delete from public.work_project_member
        where employee_id = ${teammate.employeeId}::uuid
      `);
      await tx.execute(sql`
        update public.work_ai_teammate_memory set forgotten_at = now()
        where work_ai_teammate_id = ${teammateId}::uuid and forgotten_at is null
      `);
    });
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "work.ai.teammate.archive",
    entityType: "work_ai_teammate",
    entityId: teammateId,
    before: { status: teammate.status },
    after: { archived: true },
    reason: null,
  });
  return { ok: true as const };
}

export async function listWorkAiTeammateDirectory(ctx: TrpcContext) {
  actor(ctx);
  const db = getDb();
  if (!db)
    return Object.values(
      Object.fromEntries(
        [...demoMembers.keys()].map((key) => {
          const employeeId = key.split(":")[1]!;
          return [
            employeeId,
            { employeeId, displayName: "Team member", email: "" },
          ];
        }),
      ),
    );
  return db.execute<{
    employeeId: string;
    displayName: string;
    email: string;
  }>(sql`
    select employee_id as "employeeId", display_name as "displayName", email
    from public.employee
    where is_active = true and email not like '%@teammate.hrmny.internal'
    order by lower(display_name)
  `);
}

export async function listWorkAiTeammateMembers(
  ctx: TrpcContext,
  teammateId: string,
) {
  await teammateById(ctx, teammateId);
  const db = getDb();
  if (!db)
    return [...demoMembers.entries()]
      .filter(([key]) => key.startsWith(`${teammateId}:`))
      .map(([key, accessLevel]) => ({
        employeeId: key.split(":")[1]!,
        displayName: "Team member",
        email: "",
        accessLevel,
      }));
  return db.execute<{
    employeeId: string;
    displayName: string;
    email: string;
    accessLevel: TeammateMemberAccess;
  }>(sql`
    select member.employee_id as "employeeId", employee.display_name as "displayName",
      employee.email, member.access_level as "accessLevel"
    from public.work_ai_teammate_member member
    join public.employee employee on employee.employee_id = member.employee_id
    where member.work_ai_teammate_id = ${teammateId}::uuid
    order by case member.access_level when 'owner' then 1 when 'editor' then 2 else 3 end,
      lower(employee.display_name)
  `);
}

export async function setWorkAiTeammateMember(input: {
  ctx: TrpcContext;
  teammateId: string;
  employeeId: string;
  accessLevel: TeammateMemberAccess;
}) {
  const teammate = await teammateById(input.ctx, input.teammateId, "owner");
  if (
    input.employeeId === teammate.createdByEmployeeId &&
    input.accessLevel !== "owner"
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "The AI Teammate creator must remain an owner",
    });
  const actorEmployeeId = actor(input.ctx);
  const db = getDb();
  if (!db)
    demoMembers.set(
      `${input.teammateId}:${input.employeeId}`,
      input.accessLevel,
    );
  else {
    const rows = await db.execute(sql`
      insert into public.work_ai_teammate_member (
        work_ai_teammate_id, employee_id, access_level
      ) select ${input.teammateId}::uuid, employee_id, ${input.accessLevel}
      from public.employee where employee_id = ${input.employeeId}::uuid
        and is_active = true
      on conflict (work_ai_teammate_id, employee_id) do update set
        access_level = excluded.access_level, updated_at = now()
      returning work_ai_teammate_member_id
    `);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
  }
  await writeAudit({
    actorEmployeeId,
    action: "work.ai.teammate.member.set",
    entityType: "work_ai_teammate",
    entityId: input.teammateId,
    before: null,
    after: { employeeId: input.employeeId, accessLevel: input.accessLevel },
    reason: null,
  });
  return { ok: true as const };
}

export async function removeWorkAiTeammateMember(input: {
  ctx: TrpcContext;
  teammateId: string;
  employeeId: string;
}) {
  const teammate = await teammateById(input.ctx, input.teammateId, "owner");
  const actorEmployeeId = actor(input.ctx);
  if (input.employeeId === teammate.createdByEmployeeId)
    throw new TRPCError({
      code: "CONFLICT",
      message: "The AI Teammate creator cannot be removed",
    });
  const db = getDb();
  if (!db) demoMembers.delete(`${input.teammateId}:${input.employeeId}`);
  else
    await db.execute(sql`
      delete from public.work_ai_teammate_member
      where work_ai_teammate_id = ${input.teammateId}::uuid
        and employee_id = ${input.employeeId}::uuid
    `);
  await writeAudit({
    actorEmployeeId,
    action: "work.ai.teammate.member.remove",
    entityType: "work_ai_teammate",
    entityId: input.teammateId,
    before: { employeeId: input.employeeId },
    after: null,
    reason: null,
  });
  return { ok: true as const };
}

export async function listWorkAiTeammateProjectAccess(
  ctx: TrpcContext,
  teammateId: string,
) {
  await teammateById(ctx, teammateId);
  const db = getDb();
  if (!db)
    return [...demoProjectAccess.entries()].flatMap(([key, accessLevel]) => {
      const [id, projectId] = key.split(":");
      const project = getDemoWork().projects.get(projectId!);
      return id === teammateId && project
        ? [{ projectId: projectId!, projectName: project.name, accessLevel }]
        : [];
    });
  return db.execute<{
    projectId: string;
    projectName: string;
    accessLevel: ProjectAccess;
  }>(sql`
    select access.work_project_id as "projectId", project.name as "projectName",
      access.access_level as "accessLevel"
    from public.work_ai_teammate_project_access access
    join public.work_project project on project.work_project_id = access.work_project_id
    where access.work_ai_teammate_id = ${teammateId}::uuid
      and project.archived_at is null
    order by lower(project.name)
  `);
}

export async function setWorkAiTeammateProjectAccess(input: {
  ctx: TrpcContext;
  teammateId: string;
  projectId: string;
  accessLevel: ProjectAccess;
}) {
  const teammate = await teammateById(input.ctx, input.teammateId, "editor");
  const actorEmployeeId = actor(input.ctx);
  await requireProjectAccess(input.ctx, input.projectId, "admin");
  const db = getDb();
  if (!db)
    demoProjectAccess.set(
      `${input.teammateId}:${input.projectId}`,
      input.accessLevel,
    );
  else
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into public.work_ai_teammate_project_access (
          work_ai_teammate_id, work_project_id, access_level
        ) values (${input.teammateId}::uuid, ${input.projectId}::uuid, ${input.accessLevel})
        on conflict (work_ai_teammate_id, work_project_id) do update set
          access_level = excluded.access_level, updated_at = now()
      `);
      await tx.execute(sql`
        insert into public.work_project_member (
          work_project_id, employee_id, access_level
        ) values (${input.projectId}::uuid, ${teammate.employeeId}::uuid, ${input.accessLevel})
        on conflict (work_project_id, employee_id) do update set
          access_level = excluded.access_level, updated_at = now()
      `);
    });
  await writeAudit({
    actorEmployeeId,
    action: "work.ai.teammate.project_access.set",
    entityType: "work_ai_teammate",
    entityId: input.teammateId,
    before: null,
    after: { projectId: input.projectId, accessLevel: input.accessLevel },
    reason: null,
  });
  return { ok: true as const };
}

export async function removeWorkAiTeammateProjectAccess(input: {
  ctx: TrpcContext;
  teammateId: string;
  projectId: string;
}) {
  const teammate = await teammateById(input.ctx, input.teammateId, "editor");
  const actorEmployeeId = actor(input.ctx);
  await requireProjectAccess(input.ctx, input.projectId, "admin");
  const db = getDb();
  if (!db) {
    demoProjectAccess.delete(`${input.teammateId}:${input.projectId}`);
    for (const [id, memory] of demoMemories)
      if (
        memory.teammateId === input.teammateId &&
        getDemoWork().items.get(memory.itemId)?.projectId === input.projectId
      )
        demoMemories.delete(id);
  } else
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        delete from public.work_ai_teammate_project_access
        where work_ai_teammate_id = ${input.teammateId}::uuid
          and work_project_id = ${input.projectId}::uuid
      `);
      await tx.execute(sql`
        delete from public.work_project_member
        where work_project_id = ${input.projectId}::uuid
          and employee_id = ${teammate.employeeId}::uuid
      `);
      await tx.execute(sql`
        update public.work_ai_teammate_memory memory set forgotten_at = now()
        where memory.work_ai_teammate_id = ${input.teammateId}::uuid
          and memory.source_work_item_id in (
            select work_item_id from public.work_project_item
            where work_project_id = ${input.projectId}::uuid
          ) and memory.forgotten_at is null
      `);
    });
  await writeAudit({
    actorEmployeeId,
    action: "work.ai.teammate.project_access.remove",
    entityType: "work_ai_teammate",
    entityId: input.teammateId,
    before: { projectId: input.projectId },
    after: null,
    reason: "Task-bound memories were forgotten with project access",
  });
  return { ok: true as const };
}

export async function listWorkAiTeammateSkills(
  ctx: TrpcContext,
  teammateId: string,
) {
  await teammateById(ctx, teammateId);
  const db = getDb();
  if (!db)
    return [...demoSkills.values()].filter(
      (skill) => skill.teammateId === teammateId,
    );
  const rows = await db.execute<{
    skillId: string;
    teammateId: string;
    name: string;
    guidance: string;
    triggerCondition: string;
    referenceText: string;
    isActive: boolean;
    createdAt: Date | string;
    updatedAt: Date | string;
  }>(sql`
    select work_ai_teammate_skill_id as "skillId",
      work_ai_teammate_id as "teammateId", name, guidance,
      trigger_condition as "triggerCondition", reference_text as "referenceText",
      is_active as "isActive", created_at as "createdAt", updated_at as "updatedAt"
    from public.work_ai_teammate_skill
    where work_ai_teammate_id = ${teammateId}::uuid
    order by lower(name)
  `);
  return rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}

export async function saveWorkAiTeammateSkill(input: {
  ctx: TrpcContext;
  teammateId: string;
  skillId?: string;
  skill: z.infer<typeof workAiTeammateSkillInputSchema>;
}) {
  const employeeId = actor(input.ctx);
  await teammateById(input.ctx, input.teammateId, "editor");
  const skill = workAiTeammateSkillInputSchema.parse(input.skill);
  const skillId = input.skillId ?? randomUUID();
  const db = getDb();
  if (!db) {
    const existing = demoSkills.get(skillId);
    if (existing && existing.teammateId !== input.teammateId)
      throw new TRPCError({ code: "NOT_FOUND" });
    const now = new Date().toISOString();
    demoSkills.set(skillId, {
      ...skill,
      skillId,
      teammateId: input.teammateId,
      createdAt: demoSkills.get(skillId)?.createdAt ?? now,
      updatedAt: now,
    });
  } else {
    const rows = await db.execute(sql`
      insert into public.work_ai_teammate_skill (
        work_ai_teammate_skill_id, work_ai_teammate_id, name, guidance,
        trigger_condition, reference_text, is_active, created_by_employee_id
      ) values (
        ${skillId}::uuid, ${input.teammateId}::uuid, ${skill.name},
        ${skill.guidance}, ${skill.triggerCondition}, ${skill.referenceText},
        ${skill.isActive}, ${employeeId}::uuid
      ) on conflict (work_ai_teammate_skill_id) do update set
        name = excluded.name, guidance = excluded.guidance,
        trigger_condition = excluded.trigger_condition,
        reference_text = excluded.reference_text, is_active = excluded.is_active,
        updated_at = now()
      where work_ai_teammate_skill.work_ai_teammate_id = ${input.teammateId}::uuid
      returning work_ai_teammate_skill_id
    `);
    if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND" });
  }
  await writeAudit({
    actorEmployeeId: employeeId,
    action: "work.ai.teammate.skill.save",
    entityType: "work_ai_teammate_skill",
    entityId: skillId,
    before: null,
    after: {
      teammateId: input.teammateId,
      name: skill.name,
      isActive: skill.isActive,
    },
    reason: null,
  });
  return { skillId };
}

export async function deleteWorkAiTeammateSkill(input: {
  ctx: TrpcContext;
  teammateId: string;
  skillId: string;
}) {
  const actorEmployeeId = actor(input.ctx);
  await teammateById(input.ctx, input.teammateId, "editor");
  const db = getDb();
  if (!db) {
    if (demoSkills.get(input.skillId)?.teammateId === input.teammateId)
      demoSkills.delete(input.skillId);
  } else
    await db.execute(sql`
      delete from public.work_ai_teammate_skill
      where work_ai_teammate_skill_id = ${input.skillId}::uuid
        and work_ai_teammate_id = ${input.teammateId}::uuid
    `);
  await writeAudit({
    actorEmployeeId,
    action: "work.ai.teammate.skill.delete",
    entityType: "work_ai_teammate_skill",
    entityId: input.skillId,
    before: { teammateId: input.teammateId },
    after: null,
    reason: null,
  });
  return { ok: true as const };
}

async function teammateProjectAccess(
  teammate: WorkAiTeammate,
  projectId: string,
) {
  const db = getDb();
  if (!db) {
    const explicit = demoProjectAccess.get(
      `${teammate.teammateId}:${projectId}`,
    );
    if (explicit) return explicit;
    const project = getDemoWork().projects.get(projectId);
    return project?.privacy === "organization" ? "viewer" : null;
  }
  const [row] = await db.execute<{
    privacy: "organization" | "private";
    accessLevel: ProjectAccess | null;
  }>(sql`
    select project.privacy, access.access_level as "accessLevel"
    from public.work_project project
    left join public.work_ai_teammate_project_access access
      on access.work_project_id = project.work_project_id
      and access.work_ai_teammate_id = ${teammate.teammateId}::uuid
    where project.work_project_id = ${projectId}::uuid and project.archived_at is null
    limit 1
  `);
  if (!row) return null;
  return row.accessLevel ?? (row.privacy === "organization" ? "viewer" : null);
}

async function requireItemInProject(
  ctx: TrpcContext,
  projectId: string,
  itemId: string,
) {
  await requireItemAccess(ctx, itemId);
  const db = getDb();
  if (!db) {
    if (getDemoWork().items.get(itemId)?.projectId !== projectId)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Task is not in this project",
      });
    return;
  }
  const rows = await db.execute(sql`
    select 1 from public.work_project_item
    where work_project_id = ${projectId}::uuid and work_item_id = ${itemId}::uuid
    limit 1
  `);
  if (!rows[0])
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Task is not in this project",
    });
}

function skillMatches(skill: WorkAiTeammateSkill, requestText: string) {
  if (!skill.isActive) return false;
  const words =
    skill.triggerCondition.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  if (!words.length) return true;
  const request = requestText.toLowerCase();
  return words.some((word) => request.includes(word));
}

async function listAccessibleMemories(
  ctx: TrpcContext,
  teammateId: string,
  itemId: string,
) {
  if (
    !(await featureEnabled("work.ai.teammate_memory", {
      userId: ctx.employeeId,
      clientId: ctx.clientId,
      roles: ctx.roles,
    }))
  )
    return [];
  const db = getDb();
  if (!db)
    return [...demoMemories.values()]
      .filter(
        (memory) =>
          memory.teammateId === teammateId && memory.itemId === itemId,
      )
      .slice(-10);
  const rows = await db.execute<{
    memoryId: string;
    teammateId: string;
    itemId: string;
    content: string;
    createdAt: Date | string;
  }>(sql`
    select work_ai_teammate_memory_id as "memoryId",
      work_ai_teammate_id as "teammateId", source_work_item_id as "itemId",
      content, created_at as "createdAt"
    from public.work_ai_teammate_memory
    where work_ai_teammate_id = ${teammateId}::uuid
      and source_work_item_id = ${itemId}::uuid and forgotten_at is null
    order by created_at desc limit 10
  `);
  return rows.map((row) => ({
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function listWorkAiTeammateMemories(
  ctx: TrpcContext,
  teammateId: string,
) {
  await teammateById(ctx, teammateId);
  const db = getDb();
  const memories = !db
    ? [...demoMemories.values()]
        .filter((memory) => memory.teammateId === teammateId)
        .map((memory) => ({
          ...memory,
          itemTitle: getDemoWork().items.get(memory.itemId)?.title,
        }))
    : (
        await db.execute<{
          memoryId: string;
          teammateId: string;
          itemId: string;
          itemTitle: string;
          content: string;
          createdAt: Date | string;
        }>(sql`
          select work_ai_teammate_memory_id as "memoryId",
            work_ai_teammate_id as "teammateId",
            memory.source_work_item_id as "itemId", item.title as "itemTitle",
            memory.content, memory.created_at as "createdAt"
          from public.work_ai_teammate_memory memory
          join public.work_item item on item.work_item_id = memory.source_work_item_id
          where memory.work_ai_teammate_id = ${teammateId}::uuid
            and memory.forgotten_at is null
          order by memory.created_at desc limit 100
        `)
      ).map((row) => ({
        ...row,
        createdAt: new Date(row.createdAt).toISOString(),
      }));
  const visible: WorkAiTeammateMemory[] = [];
  for (const memory of memories) {
    try {
      await requireItemAccess(ctx, memory.itemId);
      visible.push(memory);
    } catch (error) {
      if (!(error instanceof TRPCError)) throw error;
    }
  }
  return visible;
}

export async function forgetWorkAiTeammateMemory(input: {
  ctx: TrpcContext;
  teammateId: string;
  memoryId: string;
}) {
  const actorEmployeeId = actor(input.ctx);
  await teammateById(input.ctx, input.teammateId, "editor");
  const db = getDb();
  if (!db) {
    const memory = demoMemories.get(input.memoryId);
    if (!memory || memory.teammateId !== input.teammateId)
      throw new TRPCError({ code: "NOT_FOUND" });
    await requireItemAccess(input.ctx, memory.itemId);
    demoMemories.delete(input.memoryId);
  } else {
    const [memory] = await db.execute<{ itemId: string }>(sql`
      select source_work_item_id as "itemId"
      from public.work_ai_teammate_memory
      where work_ai_teammate_memory_id = ${input.memoryId}::uuid
        and work_ai_teammate_id = ${input.teammateId}::uuid
        and forgotten_at is null
      limit 1
    `);
    if (!memory) throw new TRPCError({ code: "NOT_FOUND" });
    await requireItemAccess(input.ctx, memory.itemId);
    await db.execute(sql`
      update public.work_ai_teammate_memory set forgotten_at = now()
      where work_ai_teammate_memory_id = ${input.memoryId}::uuid
        and work_ai_teammate_id = ${input.teammateId}::uuid
    `);
  }
  await writeAudit({
    actorEmployeeId,
    action: "work.ai.teammate.memory.forget",
    entityType: "work_ai_teammate_memory",
    entityId: input.memoryId,
    before: { teammateId: input.teammateId },
    after: null,
    reason: null,
  });
  return { ok: true as const };
}

export async function runWorkAiTeammate(input: {
  ctx: TrpcContext;
  teammateId: string;
  projectId: string;
  itemId: string | null;
  requestText: string;
  triggerType: WorkAiTeammateRun["triggerType"];
  eventKey?: string;
}) {
  const employeeId = actor(input.ctx);
  const teammate = await teammateById(input.ctx, input.teammateId);
  if (teammate.status !== "active")
    throw new TRPCError({ code: "CONFLICT", message: "AI Teammate is paused" });
  await requireProjectAccess(input.ctx, input.projectId);
  if (input.itemId)
    await requireItemInProject(input.ctx, input.projectId, input.itemId);
  const access = await teammateProjectAccess(teammate, input.projectId);
  if (!access)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "AI Teammate does not have access to this project",
    });
  const permitted = teammate.allowedActionTypes.filter((action) =>
    access === "editor"
      ? true
      : access === "commenter"
        ? action === "create_comment"
        : false,
  );
  const skillsEnabled = await featureEnabled("work.ai.teammate_skills", {
    userId: input.ctx.employeeId,
    clientId: input.ctx.clientId,
    roles: input.ctx.roles,
  });
  const skills = skillsEnabled
    ? (await listWorkAiTeammateSkills(input.ctx, input.teammateId))
        .filter((skill) => skillMatches(skill, input.requestText))
        .slice(0, 5)
    : [];
  const memories = input.itemId
    ? await listAccessibleMemories(input.ctx, input.teammateId, input.itemId)
    : [];
  const eventKey = input.eventKey ?? `manual:${randomUUID()}`;
  let teammateRunId: string = randomUUID();
  const db = getDb();
  if (!db) {
    const eventId = `${input.teammateId}:${eventKey}`;
    const duplicate = demoEvents.get(eventId);
    if (duplicate && demoRuns.get(duplicate)?.status !== "failed")
      return { duplicate: true as const, teammateRunId: duplicate, run: null };
    if (duplicate) teammateRunId = duplicate;
    else demoEvents.set(eventId, teammateRunId);
    demoRuns.set(teammateRunId, {
      teammateRunId,
      teammateId: input.teammateId,
      aiRunId: null,
      projectId: input.projectId,
      itemId: input.itemId,
      triggeredByEmployeeId: employeeId,
      triggerType: input.triggerType,
      requestText: input.requestText,
      selectedSkillIds: skills.map((skill) => skill.skillId),
      eventKey,
      status: "running",
      errorMessage: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
    });
  } else {
    const inserted = await db.execute<{ teammateRunId: string }>(sql`
      insert into public.work_ai_teammate_run (
        work_ai_teammate_run_id, work_ai_teammate_id, work_project_id,
        work_item_id, triggered_by_employee_id, trigger_type, request_text,
        selected_skill_ids, event_key
      ) values (
        ${teammateRunId}::uuid, ${input.teammateId}::uuid, ${input.projectId}::uuid,
        ${input.itemId}::uuid, ${employeeId}::uuid, ${input.triggerType},
        ${input.requestText}, ${skills.map((skill) => skill.skillId)}::uuid[], ${eventKey}
      ) on conflict (work_ai_teammate_id, event_key) do update set
        status = 'running', error_message = null, completed_at = null
      where work_ai_teammate_run.status = 'failed'
      returning work_ai_teammate_run_id as "teammateRunId"
    `);
    if (!inserted[0])
      return { duplicate: true as const, teammateRunId: null, run: null };
    teammateRunId = inserted[0].teammateRunId;
  }
  try {
    const run = await generateWorkAi({
      ctx: input.ctx,
      kind: "teammate",
      requestText: input.requestText,
      projectIds: [input.projectId],
      itemId: input.itemId,
      workflowInstructions: [
        `You are ${teammate.name}. ${teammate.roleDescription}`,
        teammate.instructions,
        ...skills.map(
          (skill) => `Skill: ${skill.name}\nGuidance: ${skill.guidance}`,
        ),
        ...memories.map((memory) => `Task memory: ${memory.content}`),
      ].join("\n\n"),
      referenceText: skills
        .filter((skill) => skill.referenceText)
        .map((skill) => `${skill.name}:\n${skill.referenceText}`)
        .join("\n\n"),
      allowedActionTypes: permitted,
      model: teammate.model,
    });
    const status = run.status === "proposed" ? "proposed" : "answered";
    if (!db) {
      const stored = demoRuns.get(teammateRunId)!;
      stored.aiRunId = run.runId;
      stored.status = status;
      stored.completedAt = new Date().toISOString();
    } else
      await db.execute(sql`
        update public.work_ai_teammate_run set work_ai_run_id = ${run.runId}::uuid,
          status = ${status}, completed_at = now()
        where work_ai_teammate_run_id = ${teammateRunId}::uuid
      `);
    if (
      input.itemId &&
      run.result?.body &&
      (await featureEnabled("work.ai.teammate_memory", {
        userId: input.ctx.employeeId,
        clientId: input.ctx.clientId,
        roles: input.ctx.roles,
      }))
    ) {
      const memoryId = randomUUID();
      const content = run.result.body.slice(0, 20_000);
      if (!db)
        demoMemories.set(memoryId, {
          memoryId,
          teammateId: input.teammateId,
          itemId: input.itemId,
          content,
          createdAt: new Date().toISOString(),
        });
      else
        await db.execute(sql`
          insert into public.work_ai_teammate_memory (
            work_ai_teammate_memory_id, work_ai_teammate_id,
            source_work_item_id, content, created_by_employee_id
          ) values (
            ${memoryId}::uuid, ${input.teammateId}::uuid, ${input.itemId}::uuid,
            ${content}, ${employeeId}::uuid
          )
        `);
    }
    await writeAudit({
      actorEmployeeId: employeeId,
      action: "work.ai.teammate.run",
      entityType: "work_ai_teammate",
      entityId: input.teammateId,
      before: null,
      after: {
        teammateRunId,
        aiRunId: run.runId,
        itemId: input.itemId,
        skillIds: skills.map((skill) => skill.skillId),
      },
      reason: null,
    });
    return { duplicate: false as const, teammateRunId, run };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message.slice(0, 2_000)
        : "AI Teammate failed";
    if (!db) {
      const stored = demoRuns.get(teammateRunId);
      if (stored) {
        stored.status = "failed";
        stored.errorMessage = message;
        stored.completedAt = new Date().toISOString();
      }
    } else
      await db.execute(sql`
        update public.work_ai_teammate_run set status = 'failed',
          error_message = ${message}, completed_at = now()
        where work_ai_teammate_run_id = ${teammateRunId}::uuid
      `);
    throw error;
  }
}

async function projectForItem(ctx: TrpcContext, itemId: string) {
  const item = await requireItemAccess(ctx, itemId);
  return item.projectId;
}

export async function runWorkAiTeammateJob(input: {
  teammateId: string;
  itemId: string;
  actorEmployeeId: string;
  requestText: string;
  triggerType: "assignment" | "mention" | "rule" | "follow_up";
  eventKey: string;
}) {
  const ctx = await workAiContextForEmployee(input.actorEmployeeId);
  const projectId = await projectForItem(ctx, input.itemId);
  return runWorkAiTeammate({
    ctx,
    teammateId: input.teammateId,
    projectId,
    itemId: input.itemId,
    requestText: input.requestText,
    triggerType: input.triggerType,
    eventKey: input.eventKey,
  });
}

export async function workAiTeammateExecutionContext(
  ctx: TrpcContext,
  run: WorkAiRun,
  action: WorkAiAction,
) {
  const db = getDb();
  type TeammateRunLink = {
    teammateId: string;
    projectId: string;
    employeeId: string;
    status: "active" | "paused";
    allowedActionTypes: TeammateActionType[];
  };
  let link: TeammateRunLink | undefined;
  if (!db) {
    const teammateRun = [...demoRuns.values()].find(
      (candidate) => candidate.aiRunId === run.runId,
    );
    const teammate = teammateRun
      ? demoTeammates.get(teammateRun.teammateId)
      : undefined;
    if (teammateRun && teammate)
      link = {
        teammateId: teammate.teammateId,
        projectId: teammateRun.projectId,
        employeeId: teammate.employeeId,
        status: teammate.status,
        allowedActionTypes: teammate.allowedActionTypes,
      };
  } else {
    const [row] = await db.execute<TeammateRunLink>(sql`
      select teammate.work_ai_teammate_id as "teammateId",
        teammate_run.work_project_id as "projectId",
        teammate.employee_id as "employeeId", teammate.status,
        teammate.allowed_action_types as "allowedActionTypes"
      from public.work_ai_teammate_run teammate_run
      join public.work_ai_teammate teammate
        on teammate.work_ai_teammate_id = teammate_run.work_ai_teammate_id
      where teammate_run.work_ai_run_id = ${run.runId}::uuid
        and teammate.archived_at is null
      limit 1
    `);
    link = row;
  }
  if (!link) return ctx;
  await requireWorkAiFeature(ctx, "teammate");
  const teammate = await teammateById(ctx, link.teammateId);
  if (link.status !== "active")
    throw new TRPCError({ code: "CONFLICT", message: "AI Teammate is paused" });
  if (!link.allowedActionTypes.includes(action.type as TeammateActionType))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "AI Teammate is not allowed to perform this action",
    });
  const access = await teammateProjectAccess(teammate, link.projectId);
  const required: ProjectAccess =
    action.type === "create_comment" ? "commenter" : "editor";
  if (!access || projectRank[access] < projectRank[required])
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `AI Teammate requires ${required} project access`,
    });
  if ("projectId" in action && action.projectId !== link.projectId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Action is outside the teammate project",
    });
  if ("itemId" in action)
    await requireItemInProject(ctx, link.projectId, action.itemId);
  if (action.type === "create_project" && action.privacy !== "organization")
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "AI Teammates may only create organization-visible projects",
    });
  return workAiContextForEmployee(link.employeeId);
}

export function clearDemoWorkAiTeammates() {
  for (const teammate of demoTeammates.values())
    unregisterDemoWorkAiActor(teammate.employeeId);
  demoTeammates.clear();
  demoMembers.clear();
  demoProjectAccess.clear();
  demoSkills.clear();
  demoMemories.clear();
  demoRuns.clear();
  demoEvents.clear();
}

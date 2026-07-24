import { sql } from "@hrmny/db";
import { z } from "zod";
import { authenticateScimRequest } from "./enterprise-identity";
import { getDb } from "./db";
import { featureEnabled } from "./features";

export const SCIM = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  list: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patch: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
} as const;

class ScimError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly scimType?: string,
  ) {
    super(message);
  }
}

export function scimResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/scim+json",
    },
  });
}

export function scimErrorResponse(error: unknown) {
  const known = error instanceof ScimError ? error : null;
  return scimResponse(
    {
      schemas: [SCIM.error],
      status: String(known?.status ?? 500),
      detail: known?.message ?? "SCIM request failed",
      ...(known?.scimType ? { scimType: known.scimType } : {}),
    },
    known?.status ?? 500,
  );
}

export async function requireScim(request: Request) {
  const principal = await authenticateScimRequest(request);
  if (!principal) throw new ScimError(401, "Valid bearer token required");
  if (
    !(await featureEnabled("work.sso_scim", {
      userId: principal.employeeId,
      roles: principal.roles,
    }))
  ) {
    throw new ScimError(403, "SCIM provisioning is disabled");
  }
  return principal;
}

async function readScimJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new ScimError(400, "Invalid JSON document", "invalidSyntax");
  }
}

type Filter = { attribute: string; value: string };

export function parseScimFilter(
  raw: string | null,
  allowed: readonly string[],
): Filter | null {
  if (!raw) return null;
  const match = /^([A-Za-z][A-Za-z0-9.]*)\s+eq\s+"([^"]+)"$/i.exec(raw.trim());
  if (
    !match ||
    !allowed.some((item) => item.toLowerCase() === match[1]!.toLowerCase())
  ) {
    throw new ScimError(
      400,
      "Only supported eq filters may be used",
      "invalidFilter",
    );
  }
  return { attribute: match[1]!.toLowerCase(), value: match[2]! };
}

function page(request: Request) {
  const url = new URL(request.url);
  const requestedStart = Number(url.searchParams.get("startIndex") ?? 1);
  const requestedCount = Number(url.searchParams.get("count") ?? 100);
  const startIndex = Math.max(
    1,
    Number.isFinite(requestedStart) ? Math.trunc(requestedStart) : 1,
  );
  const count = Math.min(
    200,
    Math.max(
      0,
      Number.isFinite(requestedCount) ? Math.trunc(requestedCount) : 100,
    ),
  );
  return { url, startIndex, count, offset: startIndex - 1 };
}

type UserRow = {
  id: string;
  externalId: string | null;
  displayName: string;
  email: string;
  active: boolean;
  scimManaged: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function userResource(row: UserRow, request: Request) {
  const location = `${new URL(request.url).origin}/api/scim/v2/Users/${row.id}`;
  return {
    schemas: [SCIM.user],
    id: row.id,
    externalId: row.externalId ?? undefined,
    userName: row.email,
    name: { formatted: row.displayName },
    displayName: row.displayName,
    active: row.active,
    emails: [{ value: row.email, type: "work", primary: true }],
    meta: {
      resourceType: "User",
      created: new Date(row.createdAt).toISOString(),
      lastModified: new Date(row.updatedAt).toISOString(),
      location,
    },
  };
}

const userInput = z.object({
  schemas: z.array(z.string()).optional(),
  externalId: z.string().trim().min(1).max(500).nullable().optional(),
  userName: z.string().trim().email().max(320),
  displayName: z.string().trim().min(1).max(160).optional(),
  name: z
    .object({ formatted: z.string().trim().min(1).max(160).optional() })
    .optional(),
  active: z.boolean().default(true),
});

async function readUser(id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ScimError(404, "User not found");
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  const rows = await db.execute<UserRow>(sql`
    select employee_id as id, scim_external_id as "externalId",
      display_name as "displayName", email, is_active as active,
      scim_managed as "scimManaged",
      created_at as "createdAt", updated_at as "updatedAt"
    from public.employee where employee_id = ${id}::uuid limit 1
  `);
  if (!rows[0]) throw new ScimError(404, "User not found");
  return rows[0];
}

export async function listScimUsers(request: Request) {
  await requireScim(request);
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  const { url, startIndex, count, offset } = page(request);
  const filter = parseScimFilter(url.searchParams.get("filter"), [
    "id",
    "userName",
    "externalId",
  ]);
  const attribute = filter?.attribute ?? null;
  const value = filter?.value ?? null;
  const [totals, rows] = await Promise.all([
    db.execute<{ total: number | string }>(sql`
      select count(*) as total from public.employee
      where ${attribute}::text is null
        or (${attribute} = 'id' and employee_id::text = ${value})
        or (${attribute} = 'username' and lower(email) = lower(${value}))
        or (${attribute} = 'externalid' and scim_external_id = ${value})
    `),
    db.execute<UserRow>(sql`
      select employee_id as id, scim_external_id as "externalId",
        display_name as "displayName", email, is_active as active,
        scim_managed as "scimManaged",
        created_at as "createdAt", updated_at as "updatedAt"
      from public.employee
      where ${attribute}::text is null
        or (${attribute} = 'id' and employee_id::text = ${value})
        or (${attribute} = 'username' and lower(email) = lower(${value}))
        or (${attribute} = 'externalid' and scim_external_id = ${value})
      order by lower(email) limit ${count} offset ${offset}
    `),
  ]);
  return {
    schemas: [SCIM.list],
    totalResults: Number(totals[0]?.total ?? 0),
    startIndex,
    itemsPerPage: rows.length,
    Resources: rows.map((row) => userResource(row, request)),
  };
}

async function saveUser(
  request: Request,
  raw: unknown,
  actorEmployeeId: string,
  id?: string,
) {
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  const parsed = userInput.safeParse(raw);
  if (!parsed.success)
    throw new ScimError(
      400,
      parsed.error.issues[0]?.message ?? "Invalid user",
      "invalidValue",
    );
  const input = parsed.data;
  const email = input.userName.toLowerCase();
  const matching = id
    ? [await readUser(id)]
    : await db.execute<UserRow>(sql`
        select employee_id as id, scim_external_id as "externalId",
          display_name as "displayName", email, is_active as active,
          created_at as "createdAt", updated_at as "updatedAt"
        from public.employee where lower(email) = ${email} limit 2
      `);
  if (matching.length > 1) {
    throw new ScimError(
      409,
      "More than one existing user has this email",
      "uniqueness",
    );
  }
  const current = matching[0] ?? null;
  if (!id && current?.scimManaged)
    throw new ScimError(409, "User already exists", "uniqueness");
  const targetId = id ?? current?.id;
  const displayName =
    input.displayName ?? input.name?.formatted ?? current?.displayName ?? email;
  try {
    const row = await db.transaction(async (tx) => {
      const rows = targetId
        ? await tx.execute<UserRow>(sql`
            update public.employee set email = ${email}, display_name = ${displayName},
              scim_external_id = ${input.externalId === undefined ? (current?.externalId ?? null) : input.externalId},
              scim_managed = true, is_active = ${input.active},
              lifecycle_status = ${input.active ? "active" : "offboarding"},
              updated_at = now()
            where employee_id = ${targetId}::uuid
            returning employee_id as id, scim_external_id as "externalId",
              display_name as "displayName", email, is_active as active,
              scim_managed as "scimManaged",
              created_at as "createdAt", updated_at as "updatedAt"
          `)
        : await tx.execute<UserRow>(sql`
            insert into public.employee (
              display_name, email, lifecycle_status, is_active,
              scim_external_id, scim_managed
            ) values (
              ${displayName}, ${email}, ${input.active ? "active" : "offboarding"},
              ${input.active}, ${input.externalId ?? null}, true
            )
            returning employee_id as id, scim_external_id as "externalId",
              display_name as "displayName", email, is_active as active,
              scim_managed as "scimManaged",
              created_at as "createdAt", updated_at as "updatedAt"
          `);
      const saved = rows[0];
      if (!saved) throw new ScimError(404, "User not found");
      await tx.execute(sql`
        insert into public.audit_event (
          actor_employee_id, action, entity_type, entity_id, after, reason
        ) values (
          ${actorEmployeeId}::uuid, 'work.scim.user.upsert', 'employee',
          ${saved.id}::uuid,
          jsonb_build_object('email', ${saved.email}, 'active', ${saved.active}),
          'SCIM 2.0'
        )
      `);
      return saved;
    });
    return userResource(row, request);
  } catch (error) {
    if (error instanceof ScimError) throw error;
    throw new ScimError(
      409,
      "User name or external ID already exists",
      "uniqueness",
    );
  }
}

export async function createScimUser(request: Request) {
  const principal = await requireScim(request);
  return saveUser(request, await readScimJson(request), principal.employeeId);
}

export async function getScimUser(request: Request, id: string) {
  await requireScim(request);
  return userResource(await readUser(id), request);
}

export async function replaceScimUser(request: Request, id: string) {
  const principal = await requireScim(request);
  return saveUser(
    request,
    await readScimJson(request),
    principal.employeeId,
    id,
  );
}

export const scimPatchInput = z.object({
  schemas: z.array(z.string()).optional(),
  Operations: z.array(
    z.object({
      op: z.preprocess(
        (value) => (typeof value === "string" ? value.toLowerCase() : value),
        z.enum(["add", "replace", "remove"]),
      ),
      path: z.string().optional(),
      value: z.unknown().optional(),
    }),
  ),
});

export async function patchScimUser(request: Request, id: string) {
  const principal = await requireScim(request);
  const current = await readUser(id);
  const patch = scimPatchInput.safeParse(await readScimJson(request));
  if (!patch.success)
    throw new ScimError(400, "Invalid PATCH document", "invalidSyntax");
  const draft: z.input<typeof userInput> = {
    userName: current.email,
    displayName: current.displayName,
    externalId: current.externalId ?? undefined,
    active: current.active,
  };
  for (const operation of patch.data.Operations) {
    const path = operation.path?.toLowerCase();
    const values =
      !path && operation.value && typeof operation.value === "object"
        ? (operation.value as Record<string, unknown>)
        : null;
    if (path === "active") {
      if (typeof operation.value !== "boolean")
        throw new ScimError(400, "active must be a boolean", "invalidValue");
      draft.active = operation.value;
    } else if (path === "displayname" || path === "name.formatted")
      draft.displayName = String(operation.value ?? "");
    else if (path === "username")
      draft.userName = String(operation.value ?? "");
    else if (path === "externalid")
      draft.externalId =
        operation.op === "remove" ? null : String(operation.value ?? "");
    else if (values) Object.assign(draft, values);
    else
      throw new ScimError(
        400,
        `Unsupported PATCH path: ${operation.path}`,
        "invalidPath",
      );
  }
  return saveUser(request, draft, principal.employeeId, id);
}

export async function deleteScimUser(request: Request, id: string) {
  const principal = await requireScim(request);
  const current = await readUser(id);
  await saveUser(
    request,
    {
      userName: current.email,
      displayName: current.displayName,
      externalId: current.externalId ?? undefined,
      active: false,
    },
    principal.employeeId,
    id,
  );
}

type GroupRow = {
  id: string;
  externalId: string | null;
  displayName: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

async function readGroup(id: string) {
  if (!z.string().uuid().safeParse(id).success)
    throw new ScimError(404, "Group not found");
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  const rows = await db.execute<GroupRow>(sql`
    select work_team_id as id, scim_external_id as "externalId",
      name as "displayName", created_at as "createdAt", updated_at as "updatedAt"
    from public.work_team where work_team_id = ${id}::uuid and archived_at is null
    limit 1
  `);
  if (!rows[0]) throw new ScimError(404, "Group not found");
  return rows[0];
}

async function groupResource(row: GroupRow, request: Request) {
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  const members = await db.execute<{ value: string; display: string }>(sql`
    select membership.employee_id as value, employee.display_name as display
    from public.work_team_member membership
    join public.employee employee on employee.employee_id = membership.employee_id
    where membership.work_team_id = ${row.id}::uuid order by lower(employee.display_name)
  `);
  return {
    schemas: [SCIM.group],
    id: row.id,
    externalId: row.externalId ?? undefined,
    displayName: row.displayName,
    members,
    meta: {
      resourceType: "Group",
      created: new Date(row.createdAt).toISOString(),
      lastModified: new Date(row.updatedAt).toISOString(),
      location: `${new URL(request.url).origin}/api/scim/v2/Groups/${row.id}`,
    },
  };
}

const groupInput = z.object({
  schemas: z.array(z.string()).optional(),
  externalId: z.string().trim().min(1).max(500).optional(),
  displayName: z.string().trim().min(1).max(160),
  members: z.array(z.object({ value: z.string().uuid() })).default([]),
});

export async function listScimGroups(request: Request) {
  await requireScim(request);
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  const { url, startIndex, count, offset } = page(request);
  const filter = parseScimFilter(url.searchParams.get("filter"), [
    "id",
    "displayName",
    "externalId",
  ]);
  const attribute = filter?.attribute ?? null;
  const value = filter?.value ?? null;
  const [totals, rows] = await Promise.all([
    db.execute<{ total: number | string }>(sql`
      select count(*) as total from public.work_team where archived_at is null and (
        ${attribute}::text is null
        or (${attribute} = 'id' and work_team_id::text = ${value})
        or (${attribute} = 'displayname' and lower(name) = lower(${value}))
        or (${attribute} = 'externalid' and scim_external_id = ${value})
      )
    `),
    db.execute<GroupRow>(sql`
      select work_team_id as id, scim_external_id as "externalId",
        name as "displayName", created_at as "createdAt", updated_at as "updatedAt"
      from public.work_team where archived_at is null and (
        ${attribute}::text is null
        or (${attribute} = 'id' and work_team_id::text = ${value})
        or (${attribute} = 'displayname' and lower(name) = lower(${value}))
        or (${attribute} = 'externalid' and scim_external_id = ${value})
      ) order by lower(name) limit ${count} offset ${offset}
    `),
  ]);
  return {
    schemas: [SCIM.list],
    totalResults: Number(totals[0]?.total ?? 0),
    startIndex,
    itemsPerPage: rows.length,
    Resources: await Promise.all(
      rows.map((row) => groupResource(row, request)),
    ),
  };
}

async function replaceGroupMembers(
  tx: Pick<NonNullable<ReturnType<typeof getDb>>, "execute">,
  groupId: string,
  members: readonly string[],
) {
  await tx.execute(sql`
    delete from public.work_team_member where work_team_id = ${groupId}::uuid
  `);
  for (const employeeId of [...new Set(members)]) {
    await tx.execute(sql`
      insert into public.work_team_member (work_team_id, employee_id, role)
      values (${groupId}::uuid, ${employeeId}::uuid, 'member')
    `);
  }
}

async function saveGroup(
  request: Request,
  raw: unknown,
  actorEmployeeId: string,
  id?: string,
) {
  const parsed = groupInput.safeParse(raw);
  if (!parsed.success)
    throw new ScimError(400, "Invalid group", "invalidValue");
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  try {
    const row = await db.transaction(async (tx) => {
      const rows = id
        ? await tx.execute<GroupRow>(sql`
            update public.work_team set name = ${parsed.data.displayName},
              scim_external_id = ${parsed.data.externalId ?? null}, updated_at = now()
            where work_team_id = ${id}::uuid and archived_at is null
            returning work_team_id as id, scim_external_id as "externalId",
              name as "displayName", created_at as "createdAt", updated_at as "updatedAt"
          `)
        : await tx.execute<GroupRow>(sql`
            insert into public.work_team (
              name, description, privacy, created_by_employee_id, scim_external_id
            ) values (
              ${parsed.data.displayName}, '', 'private', ${actorEmployeeId}::uuid,
              ${parsed.data.externalId ?? null}
            ) returning work_team_id as id, scim_external_id as "externalId",
              name as "displayName", created_at as "createdAt", updated_at as "updatedAt"
          `);
      const saved = rows[0];
      if (!saved) throw new ScimError(404, "Group not found");
      await replaceGroupMembers(
        tx,
        saved.id,
        parsed.data.members.map((member) => member.value),
      );
      await tx.execute(sql`
        insert into public.audit_event (
          actor_employee_id, action, entity_type, entity_id, after, reason
        ) values (
          ${actorEmployeeId}::uuid, 'work.scim.group.upsert', 'work_team',
          ${saved.id}::uuid, jsonb_build_object('name', ${saved.displayName}), 'SCIM 2.0'
        )
      `);
      return saved;
    });
    return groupResource(row, request);
  } catch (error) {
    if (error instanceof ScimError) throw error;
    throw new ScimError(
      409,
      "Group name, external ID, or member is invalid",
      "uniqueness",
    );
  }
}

export async function createScimGroup(request: Request) {
  const principal = await requireScim(request);
  return saveGroup(request, await readScimJson(request), principal.employeeId);
}

export async function getScimGroup(request: Request, id: string) {
  await requireScim(request);
  return groupResource(await readGroup(id), request);
}

export async function replaceScimGroup(request: Request, id: string) {
  const principal = await requireScim(request);
  return saveGroup(
    request,
    await readScimJson(request),
    principal.employeeId,
    id,
  );
}

export async function patchScimGroup(request: Request, id: string) {
  const principal = await requireScim(request);
  const current = await groupResource(await readGroup(id), request);
  const patch = scimPatchInput.safeParse(await readScimJson(request));
  if (!patch.success)
    throw new ScimError(400, "Invalid PATCH document", "invalidSyntax");
  let displayName = current.displayName;
  let externalId = current.externalId;
  const members = new Set(current.members.map((member) => member.value));
  for (const operation of patch.data.Operations) {
    const path = operation.path?.toLowerCase();
    const values =
      !path && operation.value && typeof operation.value === "object"
        ? (operation.value as Record<string, unknown>)
        : null;
    if (path === "displayname") displayName = String(operation.value ?? "");
    else if (path === "externalid")
      externalId =
        operation.op === "remove" ? undefined : String(operation.value ?? "");
    else if (path === "members" && Array.isArray(operation.value)) {
      if (operation.op === "replace") members.clear();
      for (const member of operation.value) {
        if (member && typeof member === "object" && "value" in member) {
          const value = String(member.value);
          if (operation.op === "remove") members.delete(value);
          else members.add(value);
        }
      }
    } else if (values) {
      if (typeof values.displayName === "string")
        displayName = values.displayName;
      if (values.externalId === null) externalId = undefined;
      else if (typeof values.externalId === "string")
        externalId = values.externalId;
      if (Array.isArray(values.members)) {
        if (operation.op === "replace") members.clear();
        for (const member of values.members) {
          if (member && typeof member === "object" && "value" in member) {
            const value = String(member.value);
            if (operation.op === "remove") members.delete(value);
            else members.add(value);
          }
        }
      }
    } else {
      const remove = /^members\[value eq "([^"]+)"\]$/i.exec(
        operation.path ?? "",
      );
      if (operation.op === "remove" && remove) members.delete(remove[1]!);
      else
        throw new ScimError(
          400,
          `Unsupported PATCH path: ${operation.path}`,
          "invalidPath",
        );
    }
  }
  return saveGroup(
    request,
    {
      displayName,
      externalId,
      members: [...members].map((value) => ({ value })),
    },
    principal.employeeId,
    id,
  );
}

export async function deleteScimGroup(request: Request, id: string) {
  const principal = await requireScim(request);
  if (!z.string().uuid().safeParse(id).success)
    throw new ScimError(404, "Group not found");
  const db = getDb();
  if (!db) throw new ScimError(503, "Database unavailable");
  await db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      update public.work_team set archived_at = now(), updated_at = now()
      where work_team_id = ${id}::uuid and archived_at is null
      returning work_team_id
    `);
    if (!rows[0]) throw new ScimError(404, "Group not found");
    await tx.execute(sql`
      insert into public.audit_event (
        actor_employee_id, action, entity_type, entity_id, after, reason
      ) values (
        ${principal.employeeId}::uuid, 'work.scim.group.delete', 'work_team',
        ${id}::uuid, jsonb_build_object('archived', true), 'SCIM 2.0'
      )
    `);
  });
}

export function scimServiceProviderConfig() {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Bearer token",
        description: "Admin-issued SCIM bearer token over TLS",
        specUri: "https://www.rfc-editor.org/rfc/rfc6750",
        primary: true,
      },
    ],
  };
}

export function scimResourceTypes(request: Request, id?: string) {
  const base = `${new URL(request.url).origin}/api/scim/v2`;
  const resources = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCIM.user,
      meta: {
        resourceType: "ResourceType",
        location: `${base}/ResourceTypes/User`,
      },
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: SCIM.group,
      meta: {
        resourceType: "ResourceType",
        location: `${base}/ResourceTypes/Group`,
      },
    },
  ];
  if (id) {
    const resource = resources.find(
      (item) => item.id.toLowerCase() === id.toLowerCase(),
    );
    if (!resource) throw new ScimError(404, "Resource type not found");
    return resource;
  }
  return {
    schemas: [SCIM.list],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

export function scimSchemas(id?: string) {
  const resources = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: SCIM.user,
      name: "User",
      attributes: [
        {
          name: "userName",
          type: "string",
          multiValued: false,
          required: true,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
        {
          name: "displayName",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "active",
          type: "boolean",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
        },
        {
          name: "externalId",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
      ],
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
      id: SCIM.group,
      name: "Group",
      attributes: [
        {
          name: "displayName",
          type: "string",
          multiValued: false,
          required: true,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
        {
          name: "members",
          type: "complex",
          multiValued: true,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "none",
          subAttributes: [
            {
              name: "value",
              type: "string",
              multiValued: false,
              required: false,
              mutability: "immutable",
              returned: "default",
              uniqueness: "none",
              referenceTypes: ["User"],
            },
            {
              name: "display",
              type: "string",
              multiValued: false,
              required: false,
              mutability: "readOnly",
              returned: "default",
              uniqueness: "none",
            },
          ],
        },
        {
          name: "externalId",
          type: "string",
          multiValued: false,
          required: false,
          mutability: "readWrite",
          returned: "default",
          uniqueness: "server",
        },
      ],
    },
  ];
  if (id) {
    const resource = resources.find((item) => item.id === id);
    if (!resource) throw new ScimError(404, "Schema not found");
    return resource;
  }
  return {
    schemas: [SCIM.list],
    totalResults: resources.length,
    startIndex: 1,
    itemsPerPage: resources.length,
    Resources: resources,
  };
}

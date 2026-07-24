import { createHash, timingSafeEqual } from "node:crypto";
import { sql } from "@hrmny/db";
import { z } from "zod";
import { getDb } from "./db";

export type WorkEnvironmentManifest = {
  environmentId: string;
  kind: "production" | "sandbox";
  appOrigin: string;
  databaseFingerprint: string;
  authFingerprint: string | null;
  schemaReady: boolean;
};

const manifestSchema = z.object({
  environmentId: z.string().trim().min(1).max(160),
  kind: z.enum(["production", "sandbox"]),
  appOrigin: z.string().url().max(2048),
  databaseFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  authFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  schemaReady: z.boolean(),
});

export type WorkSandboxBootstrap = {
  administrator: {
    displayName: string;
    email: string;
    jobTitle: string | null;
    department: string | null;
    reportsToEmail: string | null;
    capacityHoursPerWeek: string | null;
    authUserId: string | null;
    roleKeys: string[];
  };
  roles: { key: string; displayName: string; legacyTitles: string[] }[];
  policies: {
    roleKey: string;
    resource: string;
    action: string;
    effect: string;
  }[];
  featureOverrides: {
    featureKey: string;
    enabled: boolean;
    reason: string | null;
  }[];
  organizationPolicy: {
    approvedDomains: string[];
    defaultProjectPrivacy: string;
    defaultTeamPrivacy: string;
    guestInvitePolicy: string;
    externalSharingEnabled: boolean;
    appPolicy: string;
    sessionTimeoutMinutes: number;
  };
};

type SandboxRecord = {
  sandboxId: string;
  name: string;
  environmentId: string;
  baseUrl: string;
  databaseFingerprint: string;
  authFingerprint: string | null;
  status: "active" | "unreachable" | "deleted";
  settingsCopiedAt: Date | string | null;
  lastVerifiedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
};

function fingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function databaseEndpoint() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is required");
  const url = new URL(value);
  return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
}

function requiredEnvironmentId() {
  const value = process.env.WORK_ENVIRONMENT_ID?.trim();
  if (!value) throw new Error("WORK_ENVIRONMENT_ID is required");
  return value;
}

function environmentKind(): "production" | "sandbox" {
  const value = process.env.WORK_ENVIRONMENT_KIND?.trim() ?? "production";
  if (value !== "production" && value !== "sandbox")
    throw new Error("WORK_ENVIRONMENT_KIND must be production or sandbox");
  return value;
}

function origin(value: string) {
  const url = new URL(value);
  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    url.hostname !== "localhost"
  )
    throw new Error("Sandbox URL must use HTTPS");
  return url.origin;
}

export function sandboxRequestAuthorized(authorization: string | null) {
  const expected = process.env.WORK_ENVIRONMENT_VERIFICATION_TOKEN?.trim();
  const supplied = /^Bearer\s+(.+)$/i.exec(authorization?.trim() ?? "")?.[1];
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function currentWorkEnvironmentManifest(
  requestOrigin?: string,
): Promise<WorkEnvironmentManifest> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const [identity] = await db.execute<{
    databaseName: string;
    serverAddress: string;
    serverPort: number;
    schemaReady: boolean;
  }>(sql`
    select current_database() as "databaseName",
      coalesce(inet_server_addr()::text, 'local') as "serverAddress",
      inet_server_port() as "serverPort",
      to_regclass('public.work_sandbox') is not null as "schemaReady"
  `);
  if (!identity) throw new Error("Could not identify the database");
  const configuredOrigin =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ?? requestOrigin;
  if (!configuredOrigin) throw new Error("NEXT_PUBLIC_APP_URL is required");
  const authUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  return {
    environmentId: requiredEnvironmentId(),
    kind: environmentKind(),
    appOrigin: origin(configuredOrigin),
    databaseFingerprint: fingerprint(
      `${databaseEndpoint()}|${identity.serverAddress}:${identity.serverPort}/${identity.databaseName}`,
    ),
    authFingerprint: authUrl ? fingerprint(origin(authUrl)) : null,
    schemaReady: identity.schemaReady,
  };
}

export function assertSeparateSandbox(
  production: WorkEnvironmentManifest,
  sandbox: WorkEnvironmentManifest,
  configuredBaseUrl: string,
) {
  if (production.kind !== "production")
    throw new Error("Sandbox activation must run from production");
  if (sandbox.kind !== "sandbox")
    throw new Error("The target did not identify itself as a sandbox");
  if (!sandbox.schemaReady)
    throw new Error("The sandbox database is missing required migrations");
  if (sandbox.environmentId === production.environmentId)
    throw new Error("Production and sandbox environment IDs must differ");
  if (sandbox.databaseFingerprint === production.databaseFingerprint)
    throw new Error("Production and sandbox must use different databases");
  if (sandbox.appOrigin !== origin(configuredBaseUrl))
    throw new Error("The sandbox manifest does not match its configured URL");
}

function targetConfiguration() {
  const baseUrl = process.env.WORK_SANDBOX_BASE_URL?.trim();
  const token = process.env.WORK_SANDBOX_VERIFICATION_TOKEN?.trim();
  return {
    baseUrl: baseUrl ? origin(baseUrl) : null,
    token: token || null,
    ready: Boolean(baseUrl && token),
  };
}

async function sandboxRequest(
  baseUrl: string,
  token: string,
  init?: RequestInit,
) {
  const response = await fetch(`${baseUrl}/api/work/sandbox/environment`, {
    ...init,
    cache: "no-store",
    redirect: "error",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!response.ok)
    throw new Error(
      typeof body?.error === "string"
        ? body.error
        : `Sandbox request failed (${response.status})`,
    );
  return body;
}

async function fetchSandboxManifest(baseUrl: string, token: string) {
  return manifestSchema.parse(await sandboxRequest(baseUrl, token));
}

function serialize(record: SandboxRecord | undefined) {
  if (!record) return null;
  return {
    ...record,
    settingsCopiedAt: record.settingsCopiedAt
      ? new Date(record.settingsCopiedAt).toISOString()
      : null,
    lastVerifiedAt: record.lastVerifiedAt
      ? new Date(record.lastVerifiedAt).toISOString()
      : null,
    deletedAt: record.deletedAt
      ? new Date(record.deletedAt).toISOString()
      : null,
    createdAt: new Date(record.createdAt).toISOString(),
  };
}

async function sandboxRecord() {
  const db = getDb();
  if (!db) return null;
  const rows = await db.execute<SandboxRecord>(sql`
    select work_sandbox_id as "sandboxId", name,
      environment_id as "environmentId", base_url as "baseUrl",
      database_fingerprint as "databaseFingerprint",
      auth_fingerprint as "authFingerprint", status,
      settings_copied_at as "settingsCopiedAt",
      last_verified_at as "lastVerifiedAt", deleted_at as "deletedAt",
      created_at as "createdAt"
    from public.work_sandbox where organization_key = 'default'
  `);
  return serialize(rows[0]);
}

export async function getWorkSandbox() {
  const configuration = targetConfiguration();
  return {
    environmentKind: environmentKind(),
    configurationReady: configuration.ready,
    configuredBaseUrl: configuration.baseUrl,
    sandbox: await sandboxRecord(),
  };
}

async function readBootstrap(
  employeeId: string,
): Promise<WorkSandboxBootstrap> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const [
    administrators,
    auth,
    roleMemberships,
    roles,
    policies,
    overrides,
    settings,
  ] = await Promise.all([
    db.execute<{
      displayName: string;
      email: string;
      jobTitle: string | null;
      department: string | null;
      reportsToEmail: string | null;
      capacityHoursPerWeek: string | null;
    }>(sql`
        select display_name as "displayName", email, job_title as "jobTitle",
          department, reports_to_email as "reportsToEmail",
          capacity_hours_per_week as "capacityHoursPerWeek"
        from public.employee where employee_id = ${employeeId}::uuid
      `),
    db.execute<{ authUserId: string }>(sql`
        select auth_user_id as "authUserId" from public.employee_auth
        where employee_id = ${employeeId}::uuid
      `),
    db.execute<{ roleKey: string }>(sql`
        select role.key as "roleKey" from public.employee_role membership
        join public.role role on role.role_id = membership.role_id
        where membership.employee_id = ${employeeId}::uuid
      `),
    db.execute<{
      key: string;
      displayName: string;
      legacyTitles: string[];
    }>(sql`
        select key, display_name as "displayName", legacy_titles as "legacyTitles"
        from public.role
      `),
    db.execute<{
      roleKey: string;
      resource: string;
      action: string;
      effect: string;
    }>(sql`
        select role.key as "roleKey", policy.resource, policy.action, policy.effect
        from public.permission_policy policy
        join public.role role on role.role_id = policy.role_id
      `),
    db.execute<{
      featureKey: string;
      enabled: boolean;
      reason: string | null;
    }>(sql`
        select feature_key as "featureKey", enabled, reason
        from public.feature_override
        where scope_type = 'global' and scope_key = '*'
      `),
    db.execute<WorkSandboxBootstrap["organizationPolicy"]>(sql`
        select approved_domains as "approvedDomains",
          default_project_privacy as "defaultProjectPrivacy",
          default_team_privacy as "defaultTeamPrivacy",
          guest_invite_policy as "guestInvitePolicy",
          external_sharing_enabled as "externalSharingEnabled",
          app_policy as "appPolicy",
          session_timeout_minutes as "sessionTimeoutMinutes"
        from public.work_organization_policy where organization_key = 'default'
      `),
  ]);
  const administrator = administrators[0];
  if (!administrator) throw new Error("Administrator not found");
  return {
    administrator: {
      ...administrator,
      authUserId: auth[0]?.authUserId ?? null,
      roleKeys: roleMemberships.map((row) => row.roleKey),
    },
    roles,
    policies,
    featureOverrides: overrides,
    organizationPolicy: settings[0]!,
  };
}

export async function activateWorkSandbox(name: string, employeeId: string) {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const configuration = targetConfiguration();
  if (!configuration.baseUrl || !configuration.token)
    throw new Error("Sandbox deployment is not configured");
  const production = await currentWorkEnvironmentManifest();
  const sandbox = await fetchSandboxManifest(
    configuration.baseUrl,
    configuration.token,
  );
  assertSeparateSandbox(production, sandbox, configuration.baseUrl);
  const bootstrap = await readBootstrap(employeeId);
  await sandboxRequest(configuration.baseUrl, configuration.token, {
    method: "POST",
    body: JSON.stringify(bootstrap),
  });
  const rows = await db.execute<SandboxRecord>(sql`
    insert into public.work_sandbox (
      organization_key, name, environment_id, base_url,
      database_fingerprint, auth_fingerprint, status,
      settings_copied_at, last_verified_at, created_by_employee_id,
      deleted_by_employee_id, deleted_at
    ) values (
      'default', ${name}, ${sandbox.environmentId}, ${sandbox.appOrigin},
      ${sandbox.databaseFingerprint}, ${sandbox.authFingerprint}, 'active',
      now(), now(), ${employeeId}::uuid, null, null
    )
    on conflict (organization_key) do update set
      name = excluded.name, environment_id = excluded.environment_id,
      base_url = excluded.base_url,
      database_fingerprint = excluded.database_fingerprint,
      auth_fingerprint = excluded.auth_fingerprint, status = 'active',
      settings_copied_at = now(), last_verified_at = now(),
      created_by_employee_id = excluded.created_by_employee_id,
      deleted_by_employee_id = null, deleted_at = null, updated_at = now()
    returning work_sandbox_id as "sandboxId", name,
      environment_id as "environmentId", base_url as "baseUrl",
      database_fingerprint as "databaseFingerprint",
      auth_fingerprint as "authFingerprint", status,
      settings_copied_at as "settingsCopiedAt",
      last_verified_at as "lastVerifiedAt", deleted_at as "deletedAt",
      created_at as "createdAt"
  `);
  return serialize(rows[0]);
}

export async function verifyWorkSandbox() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const record = await sandboxRecord();
  const configuration = targetConfiguration();
  if (!record || record.status === "deleted")
    throw new Error("Sandbox not found");
  if (!configuration.baseUrl || !configuration.token)
    throw new Error("Sandbox deployment is not configured");
  if (configuration.baseUrl !== record.baseUrl)
    throw new Error("Configured sandbox URL changed; activate it again");
  try {
    const production = await currentWorkEnvironmentManifest();
    const sandbox = await fetchSandboxManifest(
      record.baseUrl,
      configuration.token,
    );
    assertSeparateSandbox(production, sandbox, record.baseUrl);
    if (
      sandbox.environmentId !== record.environmentId ||
      sandbox.databaseFingerprint !== record.databaseFingerprint
    )
      throw new Error("The configured sandbox environment was replaced");
    await db.execute(sql`
      update public.work_sandbox set status = 'active', last_verified_at = now(),
        updated_at = now() where organization_key = 'default'
    `);
    return {
      ...record,
      status: "active" as const,
      lastVerifiedAt: new Date().toISOString(),
    };
  } catch (error) {
    await db.execute(sql`
      update public.work_sandbox set status = 'unreachable', updated_at = now()
      where organization_key = 'default'
    `);
    throw error;
  }
}

export async function deleteWorkSandbox(employeeId: string) {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  const record = await sandboxRecord();
  const configuration = targetConfiguration();
  if (!record || record.status === "deleted")
    throw new Error("Sandbox not found");
  if (!configuration.token || configuration.baseUrl !== record.baseUrl)
    throw new Error("Sandbox deployment configuration does not match");
  const production = await currentWorkEnvironmentManifest();
  const sandbox = await fetchSandboxManifest(
    record.baseUrl,
    configuration.token,
  );
  assertSeparateSandbox(production, sandbox, record.baseUrl);
  if (
    sandbox.environmentId !== record.environmentId ||
    sandbox.databaseFingerprint !== record.databaseFingerprint
  )
    throw new Error("Refusing to reset a replaced sandbox environment");
  await sandboxRequest(record.baseUrl, configuration.token, {
    method: "DELETE",
    body: JSON.stringify({ environmentId: record.environmentId }),
  });
  await db.execute(sql`
    update public.work_sandbox set status = 'deleted', deleted_at = now(),
      deleted_by_employee_id = ${employeeId}::uuid, updated_at = now()
    where organization_key = 'default'
  `);
  return { ok: true as const };
}

export async function bootstrapSandboxDatabase(input: WorkSandboxBootstrap) {
  if (environmentKind() !== "sandbox")
    throw new Error("Bootstrap is only available inside a sandbox");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  await db.transaction(async (tx) => {
    const [counts] = await tx.execute<{ projects: number; items: number }>(sql`
      select (select count(*)::int from public.work_project) as projects,
        (select count(*)::int from public.work_item) as items
    `);
    if ((counts?.projects ?? 0) > 0 || (counts?.items ?? 0) > 0)
      throw new Error("Sandbox contains work; reset it before activation");
    for (const role of input.roles)
      await tx.execute(sql`
        insert into public.role (key, display_name, legacy_titles)
        values (${role.key}, ${role.displayName}, ${JSON.stringify(role.legacyTitles)}::jsonb)
        on conflict (key) do update set display_name = excluded.display_name,
          legacy_titles = excluded.legacy_titles, updated_at = now()
      `);
    const adminRows = await tx.execute<{ employeeId: string }>(sql`
      insert into public.employee (
        display_name, email, job_title, department, reports_to_email,
        lifecycle_status, capacity_hours_per_week, is_active
      ) values (
        ${input.administrator.displayName}, ${input.administrator.email.toLowerCase()},
        ${input.administrator.jobTitle}, ${input.administrator.department},
        ${input.administrator.reportsToEmail}, 'active',
        ${input.administrator.capacityHoursPerWeek}, true
      )
      on conflict (email) do update set display_name = excluded.display_name,
        job_title = excluded.job_title, department = excluded.department,
        reports_to_email = excluded.reports_to_email,
        lifecycle_status = 'active', capacity_hours_per_week = excluded.capacity_hours_per_week,
        is_active = true, updated_at = now()
      returning employee_id as "employeeId"
    `);
    const adminId = adminRows[0]!.employeeId;
    await tx.execute(sql`
      delete from public.employee_auth where employee_id = ${adminId}::uuid
    `);
    if (input.administrator.authUserId)
      await tx.execute(sql`
        insert into public.employee_auth (employee_id, auth_user_id)
        values (${adminId}::uuid, ${input.administrator.authUserId}::uuid)
        on conflict (auth_user_id) do update set employee_id = excluded.employee_id,
          updated_at = now()
      `);
    await tx.execute(sql`
      delete from public.employee_role where employee_id = ${adminId}::uuid
    `);
    for (const roleKey of input.administrator.roleKeys)
      await tx.execute(sql`
        insert into public.employee_role (employee_id, role_id)
        select ${adminId}::uuid, role_id from public.role where key = ${roleKey}
        on conflict (employee_id, role_id) do nothing
      `);
    await tx.execute(sql`
      delete from public.permission_policy where role_id in (
        select role_id from public.role
        where key in (${sql.join(
          input.roles.map((role) => sql`${role.key}`),
          sql`, `,
        )})
      )
    `);
    for (const policy of input.policies)
      await tx.execute(sql`
        insert into public.permission_policy (role_id, resource, action, effect)
        select role_id, ${policy.resource}, ${policy.action}, ${policy.effect}
        from public.role where key = ${policy.roleKey}
      `);
    for (const override of input.featureOverrides)
      await tx.execute(sql`
        insert into public.feature_override (
          feature_key, scope_type, scope_key, enabled, reason, updated_by_employee_id
        ) values (
          ${override.featureKey}, 'global', '*', ${override.enabled},
          ${override.reason}, ${adminId}::uuid
        )
        on conflict (feature_key, scope_type, scope_key) do update set
          enabled = excluded.enabled, reason = excluded.reason,
          updated_by_employee_id = excluded.updated_by_employee_id,
          updated_at = now()
      `);
    const settings = input.organizationPolicy;
    await tx.execute(sql`
      insert into public.work_organization_policy (
        organization_key, approved_domains, default_project_privacy,
        default_team_privacy, guest_invite_policy, external_sharing_enabled,
        app_policy, session_timeout_minutes, updated_by_employee_id
      ) values (
        'default', ${JSON.stringify(settings.approvedDomains)}::jsonb,
        ${settings.defaultProjectPrivacy}, ${settings.defaultTeamPrivacy},
        ${settings.guestInvitePolicy}, ${settings.externalSharingEnabled},
        ${settings.appPolicy}, ${settings.sessionTimeoutMinutes}, ${adminId}::uuid
      )
      on conflict (organization_key) do update set
        approved_domains = excluded.approved_domains,
        default_project_privacy = excluded.default_project_privacy,
        default_team_privacy = excluded.default_team_privacy,
        guest_invite_policy = excluded.guest_invite_policy,
        external_sharing_enabled = excluded.external_sharing_enabled,
        app_policy = excluded.app_policy,
        session_timeout_minutes = excluded.session_timeout_minutes,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_at = now()
    `);
  });
  return { ok: true as const };
}

export async function resetSandboxDatabase(environmentId: string) {
  if (environmentKind() !== "sandbox")
    throw new Error("Reset is only available inside a sandbox");
  if (process.env.WORK_SANDBOX_ALLOW_RESET !== "true")
    throw new Error("Sandbox reset is disabled");
  if (environmentId !== requiredEnvironmentId())
    throw new Error("Sandbox environment ID does not match");
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  await db.execute(sql`
    do $$
    declare targets text;
    begin
      select string_agg(format('%I.%I', schemaname, tablename), ', ')
      into targets
      from pg_tables
      where schemaname = 'public'
        and tablename not in ('__drizzle_migrations', 'schema_migrations')
        and not exists (
          select 1
          from pg_class class
          join pg_namespace namespace on namespace.oid = class.relnamespace
          join pg_depend dependency on dependency.objid = class.oid
          where namespace.nspname = pg_tables.schemaname
            and class.relname = pg_tables.tablename
            and dependency.deptype = 'e'
        );
      if targets is not null then
        execute 'truncate table ' || targets || ' cascade';
      end if;
    end $$
  `);
  return { ok: true as const };
}

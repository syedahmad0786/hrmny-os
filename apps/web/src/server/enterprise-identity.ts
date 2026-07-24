import { createHash, randomBytes } from "node:crypto";
import { sql } from "@hrmny/db";
import { getDb } from "./db";
import { normalizeDomains } from "./work-governance";

export type WorkSsoConfiguration = {
  status: "disabled" | "optional" | "enforced";
  providerId: string | null;
  metadataUrl: string | null;
  domains: string[];
  breakGlassEmails: string[];
  updatedAt: string;
};

const demoConfig: WorkSsoConfiguration = {
  status: "disabled",
  providerId: null,
  metadataUrl: null,
  domains: [],
  breakGlassEmails: [],
  updatedAt: new Date(0).toISOString(),
};

let demoSso = demoConfig;

function requireDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  return db;
}

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function getWorkSsoConfiguration(): Promise<WorkSsoConfiguration> {
  const db = getDb();
  if (!db) return demoSso;
  const rows = await db.execute<{
    status: WorkSsoConfiguration["status"];
    providerId: string | null;
    metadataUrl: string | null;
    domains: unknown;
    breakGlassEmails: unknown;
    updatedAt: Date | string;
  }>(sql`
    select status, provider_id as "providerId", metadata_url as "metadataUrl",
      domains, break_glass_emails as "breakGlassEmails", updated_at as "updatedAt"
    from public.work_sso_configuration where organization_key = 'default'
  `);
  const row = rows[0];
  if (!row) return demoConfig;
  return {
    ...row,
    domains: strings(row.domains),
    breakGlassEmails: strings(row.breakGlassEmails),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function saveWorkSsoConfiguration(
  input: Omit<WorkSsoConfiguration, "updatedAt">,
  employeeId: string,
) {
  const config = {
    ...input,
    providerId: input.providerId?.trim() || null,
    metadataUrl: input.metadataUrl?.trim() || null,
    domains: normalizeDomains(input.domains),
    breakGlassEmails: [
      ...new Set(
        input.breakGlassEmails.map((email) => email.trim().toLowerCase()),
      ),
    ].filter(Boolean),
  };
  if (
    config.status === "enforced" &&
    (!config.providerId || config.domains.length === 0)
  ) {
    throw new Error(
      "Enforced SSO needs a Supabase provider ID and at least one domain",
    );
  }
  const db = getDb();
  if (!db) {
    demoSso = { ...config, updatedAt: new Date().toISOString() };
    return demoSso;
  }
  await db.execute(sql`
    insert into public.work_sso_configuration (
      organization_key, status, provider_id, metadata_url, domains,
      break_glass_emails, updated_by_employee_id
    ) values (
      'default', ${config.status}, ${config.providerId}, ${config.metadataUrl},
      ${JSON.stringify(config.domains)}::jsonb,
      ${JSON.stringify(config.breakGlassEmails)}::jsonb, ${employeeId}::uuid
    )
    on conflict (organization_key) do update set
      status = excluded.status, provider_id = excluded.provider_id,
      metadata_url = excluded.metadata_url, domains = excluded.domains,
      break_glass_emails = excluded.break_glass_emails,
      updated_by_employee_id = excluded.updated_by_employee_id,
      updated_at = now()
  `);
  return getWorkSsoConfiguration();
}

export function ssoAccessAllowed(
  config: WorkSsoConfiguration,
  user: {
    email?: string | null;
    identities?: readonly { provider?: string | null }[] | null;
  },
) {
  if (config.status !== "enforced") return true;
  const email = user.email?.trim().toLowerCase();
  if (!email || config.breakGlassEmails.includes(email)) return Boolean(email);
  const domain = email.split("@")[1] ?? "";
  if (!config.domains.includes(domain)) return true;
  return Boolean(
    user.identities?.some(
      (identity) => identity.provider === `sso:${config.providerId}`,
    ),
  );
}

export function hashBearerToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueScimToken(input: {
  label: string;
  expiresAt: Date | null;
  employeeId: string;
}) {
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  const db = requireDb();
  const rows = await db.execute<{
    tokenId: string;
    label: string;
    expiresAt: Date | string | null;
    createdAt: Date | string;
  }>(sql`
    insert into public.work_scim_token (
      label, token_hash, expires_at, created_by_employee_id
    ) values (
      ${input.label}, ${hashBearerToken(token)},
      ${input.expiresAt?.toISOString() ?? null}::timestamptz,
      ${input.employeeId}::uuid
    )
    returning work_scim_token_id as "tokenId", label,
      expires_at as "expiresAt", created_at as "createdAt"
  `);
  const row = rows[0]!;
  return {
    ...row,
    token,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listScimTokens() {
  const db = getDb();
  if (!db) return [];
  const rows = await db.execute<{
    tokenId: string;
    label: string;
    expiresAt: Date | string | null;
    lastUsedAt: Date | string | null;
    revokedAt: Date | string | null;
    createdAt: Date | string;
  }>(sql`
    select work_scim_token_id as "tokenId", label, expires_at as "expiresAt",
      last_used_at as "lastUsedAt", revoked_at as "revokedAt",
      created_at as "createdAt"
    from public.work_scim_token order by created_at desc
  `);
  return rows.map((row) => ({
    ...row,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    revokedAt: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

export async function revokeScimToken(tokenId: string) {
  const db = requireDb();
  await db.execute(sql`
    update public.work_scim_token set revoked_at = now()
    where work_scim_token_id = ${tokenId}::uuid and revoked_at is null
  `);
}

export async function authenticateScimRequest(request: Request) {
  const match = /^Bearer\s+(\S+)$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (!match) return false;
  const db = getDb();
  if (!db) return false;
  const rows = await db.execute<{
    tokenId: string;
    employeeId: string;
    roles: string[];
  }>(sql`
    with authenticated as (
      update public.work_scim_token set last_used_at = now()
      where token_hash = ${hashBearerToken(match[1]!)} and revoked_at is null
        and (expires_at is null or expires_at > now())
      returning work_scim_token_id, created_by_employee_id
    )
    select authenticated.work_scim_token_id as "tokenId",
      authenticated.created_by_employee_id as "employeeId",
      coalesce(
        array_agg(distinct assigned_role.key)
          filter (where assigned_role.key is not null),
        '{}'::text[]
      ) as roles
    from authenticated
    inner join public.employee credential_owner
      on credential_owner.employee_id = authenticated.created_by_employee_id
      and credential_owner.is_active = true
    left join public.employee_role membership
      on membership.employee_id = authenticated.created_by_employee_id
    left join public.role assigned_role
      on assigned_role.role_id = membership.role_id
    group by authenticated.work_scim_token_id,
      authenticated.created_by_employee_id
  `);
  return rows[0] ?? null;
}

export function clearDemoEnterpriseIdentity() {
  demoSso = demoConfig;
}

import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpsRequest } from "node:https";
import { sql } from "@hrmny/db";
import type { TrpcContext } from "./trpc/trpc";
import { getDb } from "./db";
import { featureEnabled } from "./features";
import { hashBearerToken } from "./enterprise-identity";
import { requireProjectAccess } from "./trpc/work-management-router";

export const WORK_API_SCOPES = [
  "projects:read",
  "projects:write",
  "tasks:read",
  "tasks:write",
  "comments:read",
  "comments:write",
] as const;
export type WorkApiScope = (typeof WORK_API_SCOPES)[number];

export const WORK_WEBHOOK_EVENTS = [
  "project.created",
  "project.updated",
  "task.created",
  "task.updated",
  "task.moved",
  "task.removed",
  "comment.created",
] as const;
export type WorkWebhookEvent = (typeof WORK_WEBHOOK_EVENTS)[number];

type ApiTokenRow = {
  tokenId: string;
  label: string;
  tokenPrefix: string;
  scopes: WorkApiScope[];
  expiresAt: Date | string | null;
  lastUsedAt: Date | string | null;
  revokedAt: Date | string | null;
  createdByEmployeeId: string;
  createdByName: string;
  createdAt: Date | string;
};

type WebhookRow = {
  subscriptionId: string;
  projectId: string;
  projectName: string;
  name: string;
  targetUrl: string;
  eventTypes: WorkWebhookEvent[];
  status: "active" | "disabled";
  createdByEmployeeId: string;
  createdByName: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

const demoTokens = new Map<string, ApiTokenRow & { tokenHash: string }>();
const demoWebhooks = new Map<string, WebhookRow>();

function requiredDb() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required");
  return db;
}

function iso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

function publicToken(row: ApiTokenRow) {
  return {
    ...row,
    expiresAt: iso(row.expiresAt),
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: iso(row.createdAt)!,
  };
}

function publicWebhook(row: WebhookRow) {
  return {
    ...row,
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
  };
}

export async function listWorkApiConfiguration() {
  const db = getDb();
  if (!db)
    return {
      tokens: [...demoTokens.values()].map(publicToken),
      webhooks: [...demoWebhooks.values()].map(publicWebhook),
      deliveries: [],
    };
  const [tokens, webhooks, deliveries] = await Promise.all([
    db.execute<ApiTokenRow>(sql`
      select token.work_api_token_id as "tokenId", token.label,
        token.token_prefix as "tokenPrefix", token.scopes,
        token.expires_at as "expiresAt", token.last_used_at as "lastUsedAt",
        token.revoked_at as "revokedAt",
        token.created_by_employee_id as "createdByEmployeeId",
        employee.display_name as "createdByName", token.created_at as "createdAt"
      from public.work_api_token token
      join public.employee employee
        on employee.employee_id = token.created_by_employee_id
      order by token.created_at desc
    `),
    db.execute<WebhookRow>(sql`
      select subscription.work_webhook_subscription_id as "subscriptionId",
        subscription.project_id as "projectId", project.name as "projectName",
        subscription.name, subscription.target_url as "targetUrl",
        subscription.event_types as "eventTypes", subscription.status,
        subscription.created_by_employee_id as "createdByEmployeeId",
        employee.display_name as "createdByName",
        subscription.created_at as "createdAt",
        subscription.updated_at as "updatedAt"
      from public.work_webhook_subscription subscription
      join public.work_project project
        on project.work_project_id = subscription.project_id
      join public.employee employee
        on employee.employee_id = subscription.created_by_employee_id
      order by subscription.created_at desc
    `),
    db.execute<{
      deliveryId: string;
      subscriptionId: string;
      subscriptionName: string;
      eventType: string;
      status: string;
      attempts: number;
      responseStatus: number | null;
      lastError: string | null;
      createdAt: Date | string;
      deliveredAt: Date | string | null;
    }>(sql`
      select delivery.work_webhook_delivery_id as "deliveryId",
        delivery.work_webhook_subscription_id as "subscriptionId",
        subscription.name as "subscriptionName", delivery.event_type as "eventType",
        delivery.status, delivery.attempts,
        delivery.response_status as "responseStatus",
        delivery.last_error as "lastError", delivery.created_at as "createdAt",
        delivery.delivered_at as "deliveredAt"
      from public.work_webhook_delivery delivery
      join public.work_webhook_subscription subscription
        on subscription.work_webhook_subscription_id = delivery.work_webhook_subscription_id
      order by delivery.created_at desc limit 50
    `),
  ]);
  return {
    tokens: tokens.map(publicToken),
    webhooks: webhooks.map(publicWebhook),
    deliveries: deliveries.map((row) => ({
      ...row,
      createdAt: iso(row.createdAt)!,
      deliveredAt: iso(row.deliveredAt),
    })),
  };
}

export async function issueWorkApiToken(input: {
  label: string;
  scopes: WorkApiScope[];
  expiresAt: Date | null;
  employeeId: string;
  employeeName?: string;
}) {
  const token = `hrmny_work_${randomBytes(32).toString("base64url")}`;
  const tokenPrefix = token.slice(0, 17);
  const db = getDb();
  if (!db) {
    const tokenId = randomUUID();
    const row: ApiTokenRow & { tokenHash: string } = {
      tokenId,
      label: input.label,
      tokenPrefix,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
      lastUsedAt: null,
      revokedAt: null,
      createdByEmployeeId: input.employeeId,
      createdByName: input.employeeName ?? "Current user",
      createdAt: new Date(),
      tokenHash: hashBearerToken(token),
    };
    demoTokens.set(tokenId, row);
    return { ...publicToken(row), token };
  }
  const rows = await db.execute<ApiTokenRow>(sql`
    insert into public.work_api_token (
      label, token_hash, token_prefix, scopes, expires_at, created_by_employee_id
    ) values (
      ${input.label}, ${hashBearerToken(token)}, ${tokenPrefix},
      ${input.scopes}::text[], ${input.expiresAt?.toISOString() ?? null}::timestamptz,
      ${input.employeeId}::uuid
    )
    returning work_api_token_id as "tokenId", label,
      token_prefix as "tokenPrefix", scopes, expires_at as "expiresAt",
      last_used_at as "lastUsedAt", revoked_at as "revokedAt",
      created_by_employee_id as "createdByEmployeeId",
      ${input.employeeName ?? "Current user"}::text as "createdByName",
      created_at as "createdAt"
  `);
  return { ...publicToken(rows[0]!), token };
}

export async function revokeWorkApiToken(tokenId: string) {
  const db = getDb();
  if (!db) {
    const row = demoTokens.get(tokenId);
    if (row) row.revokedAt = new Date();
    return;
  }
  await db.execute(sql`
    update public.work_api_token set revoked_at = now()
    where work_api_token_id = ${tokenId}::uuid and revoked_at is null
  `);
}

function blockedIpv4(address: string) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part)))
    return true;
  const [a, b, c] = octets as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

export function isPublicAddress(address: string) {
  if (isIP(address) === 4) return !blockedIpv4(address);
  if (isIP(address) !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:"))
    return !blockedIpv4(normalized.slice(7));
  return (
    (normalized.startsWith("2") || normalized.startsWith("3")) &&
    !normalized.startsWith("2001:db8:")
  );
}

async function resolvePublicTarget(rawUrl: string) {
  const url = new URL(rawUrl);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    rawUrl.length > 2048
  )
    throw new Error("Webhook URL must be a public HTTPS address");
  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await lookup(url.hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error(
      "Webhook URL cannot resolve to a private or reserved address",
    );
  return { url, address: addresses[0]!.address };
}

export async function validateWorkWebhookUrl(rawUrl: string) {
  return (await resolvePublicTarget(rawUrl)).url.toString();
}

export function signWorkWebhook(
  secret: string,
  timestamp: string,
  body: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
}

export async function createWorkWebhook(input: {
  projectId: string;
  name: string;
  targetUrl: string;
  eventTypes: WorkWebhookEvent[];
  employeeId: string;
  employeeName?: string;
}) {
  const targetUrl = await validateWorkWebhookUrl(input.targetUrl);
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const subscriptionId = randomUUID();
  const db = getDb();
  if (!db) {
    const row: WebhookRow = {
      subscriptionId,
      projectId: input.projectId,
      projectName: "Demo project",
      name: input.name,
      targetUrl,
      eventTypes: input.eventTypes,
      status: "active",
      createdByEmployeeId: input.employeeId,
      createdByName: input.employeeName ?? "Current user",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    demoWebhooks.set(subscriptionId, row);
    return { ...publicWebhook(row), secret };
  }
  const row = await db.transaction(async (tx) => {
    const secretRows = await tx.execute<{ id: string }>(sql`
      select vault.create_secret(
        ${secret}, ${`work-webhook:${subscriptionId}`},
        'hrmny Work outbound webhook signing secret'
      ) as id
    `);
    const secretId = secretRows[0]?.id;
    if (!secretId) throw new Error("Vault did not store the webhook secret");
    const rows = await tx.execute<WebhookRow>(sql`
      insert into public.work_webhook_subscription (
        work_webhook_subscription_id, project_id, name, target_url, event_types, secret_id,
        created_by_employee_id
      ) values (
        ${subscriptionId}::uuid, ${input.projectId}::uuid, ${input.name}, ${targetUrl},
        ${input.eventTypes}::text[], ${secretId}::uuid, ${input.employeeId}::uuid
      )
      returning work_webhook_subscription_id as "subscriptionId",
        project_id as "projectId", ${"Project"}::text as "projectName", name,
        target_url as "targetUrl", event_types as "eventTypes", status,
        created_by_employee_id as "createdByEmployeeId",
        ${input.employeeName ?? "Current user"}::text as "createdByName",
        created_at as "createdAt", updated_at as "updatedAt"
    `);
    return rows[0]!;
  });
  return { ...publicWebhook(row), secret };
}

export async function deleteWorkWebhook(subscriptionId: string) {
  const db = getDb();
  if (!db) {
    demoWebhooks.delete(subscriptionId);
    return;
  }
  await db.transaction(async (tx) => {
    const rows = await tx.execute<{ secretId: string }>(sql`
      delete from public.work_webhook_subscription
      where work_webhook_subscription_id = ${subscriptionId}::uuid
      returning secret_id as "secretId"
    `);
    if (rows[0]?.secretId)
      await tx.execute(
        sql`delete from vault.secrets where id = ${rows[0].secretId}::uuid`,
      );
  });
}

export type WorkApiIdentity = {
  tokenId: string;
  employeeId: string;
  email: string;
  displayName: string;
  scopes: WorkApiScope[];
  roles: string[];
};

function identityContext(identity: WorkApiIdentity): TrpcContext {
  const user = {
    employeeId: identity.employeeId,
    email: identity.email,
    displayName: identity.displayName,
    roles: identity.roles,
    permissions: [],
    actorType: "staff" as const,
    clientId: null,
  };
  return {
    user,
    employeeId: identity.employeeId,
    roles: identity.roles,
    canViewMargin: false,
    clientId: null,
  };
}

async function identityForEmployee(employeeId: string) {
  const db = requiredDb();
  const rows = await db.execute<
    Omit<WorkApiIdentity, "tokenId" | "scopes">
  >(sql`
    select employee.employee_id as "employeeId", employee.email,
      employee.display_name as "displayName",
      coalesce(array_agg(distinct role.key) filter (where role.key is not null),
        '{}'::text[]) as roles
    from public.employee employee
    left join public.employee_role membership
      on membership.employee_id = employee.employee_id
    left join public.role role on role.role_id = membership.role_id
    where employee.employee_id = ${employeeId}::uuid and employee.is_active = true
    group by employee.employee_id, employee.email, employee.display_name
  `);
  return rows[0] ?? null;
}

export async function authenticateWorkApiToken(request: Request) {
  const match = /^Bearer\s+(hrmny_work_[A-Za-z0-9_-]{40,})$/i.exec(
    request.headers.get("authorization")?.trim() ?? "",
  );
  if (!match) return null;
  const db = getDb();
  let identity: WorkApiIdentity | null = null;
  if (!db) {
    const row = [...demoTokens.values()].find(
      (token) => token.tokenHash === hashBearerToken(match[1]!),
    );
    if (
      row &&
      !row.revokedAt &&
      (!row.expiresAt || new Date(row.expiresAt) > new Date())
    ) {
      row.lastUsedAt = new Date();
      identity = {
        tokenId: row.tokenId,
        employeeId: row.createdByEmployeeId,
        email: "api@hrmny.local",
        displayName: row.createdByName,
        scopes: row.scopes,
        roles: ["partner"],
      };
    }
  } else {
    const rows = await db.execute<WorkApiIdentity>(sql`
      with authenticated as (
        update public.work_api_token set last_used_at = now()
        where token_hash = ${hashBearerToken(match[1]!)} and revoked_at is null
          and (expires_at is null or expires_at > now())
        returning work_api_token_id, created_by_employee_id, scopes
      )
      select authenticated.work_api_token_id as "tokenId",
        employee.employee_id as "employeeId", employee.email,
        employee.display_name as "displayName", authenticated.scopes,
        coalesce(array_agg(distinct role.key) filter (where role.key is not null),
          '{}'::text[]) as roles
      from authenticated
      join public.employee employee
        on employee.employee_id = authenticated.created_by_employee_id
        and employee.is_active = true
      left join public.employee_role membership
        on membership.employee_id = employee.employee_id
      left join public.role role on role.role_id = membership.role_id
      group by authenticated.work_api_token_id, employee.employee_id,
        employee.email, employee.display_name, authenticated.scopes
    `);
    identity = rows[0] ?? null;
  }
  if (!identity) return null;
  if (
    !(await featureEnabled("work.api_webhooks", {
      userId: identity.employeeId,
      roles: identity.roles,
    }))
  )
    return null;
  return { identity, context: identityContext(identity) };
}

export async function authenticateWorkApiRequest(
  request: Request,
  requiredScope: WorkApiScope,
) {
  const authenticated = await authenticateWorkApiToken(request);
  return authenticated?.identity.scopes.includes(requiredScope)
    ? authenticated
    : null;
}

type DeliveryRow = {
  deliveryId: string;
  subscriptionId: string;
  projectId: string;
  targetUrl: string;
  secretId: string;
  employeeId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  createdAt: Date | string;
};

async function postSignedWebhook(input: {
  targetUrl: string;
  deliveryId: string;
  eventType: string;
  secret: string;
  body: string;
}) {
  const { url, address } = await resolvePublicTarget(input.targetUrl);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signWorkWebhook(input.secret, timestamp, input.body);
  return new Promise<number>((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: address,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        servername: isIP(url.hostname) ? undefined : url.hostname,
        timeout: 10_000,
        headers: {
          host: url.host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(input.body),
          "user-agent": "hrmny-work-webhooks/1.0",
          "x-hrmny-delivery": input.deliveryId,
          "x-hrmny-event": input.eventType,
          "x-hrmny-timestamp": timestamp,
          "x-hrmny-signature": `sha256=${signature}`,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("Webhook timed out")),
    );
    request.on("error", reject);
    request.end(input.body);
  });
}

const retryDelays = [60, 300, 1_800, 7_200, 28_800, 86_400, 172_800];

export async function deliverPendingWorkWebhooks(limit = 20) {
  const db = getDb();
  if (!db) return { claimed: 0, delivered: 0, failed: 0, suppressed: 0 };
  await db.execute(sql`
    update public.work_webhook_delivery set status = 'retry', locked_at = null,
      next_attempt_at = now(), updated_at = now()
    where status = 'delivering' and locked_at < now() - interval '10 minutes'
  `);
  await db.execute(sql`
    update public.work_webhook_delivery delivery set status = 'suppressed',
      last_error = 'Subscription disabled', updated_at = now()
    from public.work_webhook_subscription subscription
    where subscription.work_webhook_subscription_id = delivery.work_webhook_subscription_id
      and subscription.status <> 'active'
      and delivery.status in ('pending', 'retry')
  `);
  const claimed = await db.execute<DeliveryRow>(sql`
    with due as (
      select delivery.work_webhook_delivery_id
      from public.work_webhook_delivery delivery
      join public.work_webhook_subscription subscription
        on subscription.work_webhook_subscription_id = delivery.work_webhook_subscription_id
        and subscription.status = 'active'
      where delivery.status in ('pending', 'retry')
        and delivery.next_attempt_at <= now()
      order by delivery.next_attempt_at
      for update skip locked limit ${Math.min(Math.max(limit, 1), 100)}
    ), claimed as (
      update public.work_webhook_delivery delivery
      set status = 'delivering', attempts = attempts + 1,
        locked_at = now(), updated_at = now()
      from due
      where delivery.work_webhook_delivery_id = due.work_webhook_delivery_id
      returning delivery.*
    )
    select claimed.work_webhook_delivery_id as "deliveryId",
      claimed.work_webhook_subscription_id as "subscriptionId",
      subscription.project_id as "projectId",
      subscription.target_url as "targetUrl", subscription.secret_id as "secretId",
      subscription.created_by_employee_id as "employeeId",
      claimed.event_type as "eventType", claimed.payload, claimed.attempts,
      claimed.created_at as "createdAt"
    from claimed
    join public.work_webhook_subscription subscription
      on subscription.work_webhook_subscription_id = claimed.work_webhook_subscription_id
      and subscription.status = 'active'
  `);
  let delivered = 0;
  let failed = 0;
  let suppressed = 0;
  for (const delivery of claimed) {
    try {
      const identity = await identityForEmployee(delivery.employeeId);
      if (!identity) throw new Error("Webhook owner is inactive");
      const context = identityContext({
        ...identity,
        tokenId: delivery.subscriptionId,
        scopes: [],
      });
      const enabled = await featureEnabled("work.api_webhooks", {
        userId: identity.employeeId,
        roles: identity.roles,
      });
      if (!enabled) {
        await db.execute(sql`
          update public.work_webhook_delivery set status = 'suppressed',
            locked_at = null, last_error = 'Feature disabled', updated_at = now()
          where work_webhook_delivery_id = ${delivery.deliveryId}::uuid
        `);
        suppressed += 1;
        continue;
      }
      try {
        await requireProjectAccess(context, delivery.projectId);
      } catch {
        await db.execute(sql`
          update public.work_webhook_delivery set status = 'suppressed',
            locked_at = null, last_error = 'Project access removed', updated_at = now()
          where work_webhook_delivery_id = ${delivery.deliveryId}::uuid
        `);
        suppressed += 1;
        continue;
      }
      const secrets = await db.execute<{ secret: string }>(sql`
        select decrypted_secret as secret from vault.decrypted_secrets
        where id = ${delivery.secretId}::uuid limit 1
      `);
      const secret = secrets[0]?.secret;
      if (!secret) throw new Error("Webhook signing secret is unavailable");
      const body = JSON.stringify({
        apiVersion: "2026-07-24",
        deliveryId: delivery.deliveryId,
        eventType: delivery.eventType,
        createdAt: iso(delivery.createdAt),
        data: delivery.payload,
      });
      const responseStatus = await postSignedWebhook({
        targetUrl: delivery.targetUrl,
        deliveryId: delivery.deliveryId,
        eventType: delivery.eventType,
        secret,
        body,
      });
      if (responseStatus < 200 || responseStatus >= 300)
        throw Object.assign(new Error(`Webhook returned ${responseStatus}`), {
          responseStatus,
        });
      await db.execute(sql`
        update public.work_webhook_delivery set status = 'delivered',
          response_status = ${responseStatus}, delivered_at = now(), locked_at = null,
          last_error = null, updated_at = now()
        where work_webhook_delivery_id = ${delivery.deliveryId}::uuid
      `);
      delivered += 1;
    } catch (error) {
      const attempts = Number(delivery.attempts);
      const terminal = attempts >= 8;
      const delay =
        retryDelays[Math.min(attempts - 1, retryDelays.length - 1)]!;
      const responseStatus =
        typeof error === "object" && error && "responseStatus" in error
          ? Number(error.responseStatus)
          : null;
      await db.execute(sql`
        update public.work_webhook_delivery set
          status = ${terminal ? "failed" : "retry"},
          next_attempt_at = ${new Date(Date.now() + delay * 1_000)},
          response_status = ${responseStatus}, locked_at = null,
          last_error = ${error instanceof Error ? error.message.slice(0, 2_000) : "Webhook delivery failed"},
          updated_at = now()
        where work_webhook_delivery_id = ${delivery.deliveryId}::uuid
      `);
      failed += 1;
    }
  }
  return { claimed: claimed.length, delivered, failed, suppressed };
}

export function clearDemoWorkApi() {
  demoTokens.clear();
  demoWebhooks.clear();
}

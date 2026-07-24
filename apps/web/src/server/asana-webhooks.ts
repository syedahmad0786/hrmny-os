import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { sql, type Db } from "@hrmny/db";
import type {
  AsanaAdapter,
  AsanaProject,
  AsanaWebhookFilter,
  AsanaWorkspace,
} from "@hrmny/integrations";
import { z } from "zod";
import { getDb } from "./db";
import { featureEnabled } from "./features";

type SubscriptionRow = {
  subscriptionId: string;
  workspaceGid: string;
  workspaceName: string;
  resourceGid: string;
  resourceType: "workspace" | "project";
  resourceName: string;
  connectedAccountId: string;
  webhookGid: string | null;
  endpointToken: string;
  targetUrl: string;
  secretId: string | null;
  status: "pending" | "active" | "error" | "deleted";
  lastEventAt: Date | string | null;
  lastEventCount: number;
  lastError: string | null;
  employeeId: string;
  updatedAt: Date | string;
};

const subscriptionColumns = sql`
  asana_webhook_subscription_id as "subscriptionId",
  workspace_external_id as "workspaceGid", workspace_name as "workspaceName",
  resource_external_id as "resourceGid", resource_type as "resourceType",
  resource_name as "resourceName", connected_account_id as "connectedAccountId",
  webhook_external_id as "webhookGid", endpoint_token as "endpointToken",
  target_url as "targetUrl", secret_id as "secretId", status,
  last_event_at as "lastEventAt", last_event_count as "lastEventCount",
  last_error as "lastError", created_by_employee_id as "employeeId",
  updated_at as "updatedAt"
`;

const workspaceFilters: readonly AsanaWebhookFilter[] = (
  ["added", "changed", "deleted", "removed", "undeleted"] as const
).map((action) => ({ resource_type: "project", action }));

function dbRequired() {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required for Asana webhooks");
  return db;
}

function appOrigin() {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!raw) throw new Error("NEXT_PUBLIC_APP_URL is required for webhooks");
  const url = new URL(raw);
  if (url.protocol !== "https:")
    throw new Error("Asana webhooks require a public HTTPS app URL");
  return url.origin;
}

function publicSubscription(row: SubscriptionRow) {
  return {
    subscriptionId: row.subscriptionId,
    resourceGid: row.resourceGid,
    resourceType: row.resourceType,
    resourceName: row.resourceName,
    webhookGid: row.webhookGid,
    status: row.status,
    lastEventAt: row.lastEventAt
      ? new Date(row.lastEventAt).toISOString()
      : null,
    lastEventCount: row.lastEventCount,
    lastError: row.lastError,
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

async function rowsForWorkspace(
  db: Db,
  connectedAccountId: string,
  workspaceGid: string,
) {
  return db.execute<SubscriptionRow>(sql`
    select ${subscriptionColumns}
    from public.asana_webhook_subscription
    where connected_account_id = ${connectedAccountId}
      and workspace_external_id = ${workspaceGid}
    order by resource_type desc, lower(resource_name)
  `);
}

export async function getAsanaWebhookStatus(
  connectedAccountId: string,
  workspaceGid: string,
) {
  const db = dbRequired();
  const rows = await rowsForWorkspace(db, connectedAccountId, workspaceGid);
  return {
    active: rows.filter((row) => row.status === "active").length,
    errors: rows.filter((row) => row.status === "error").length,
    subscriptions: rows.map(publicSubscription),
  };
}

async function registerResource(input: {
  db: Db;
  adapter: AsanaAdapter;
  connectedAccountId: string;
  workspace: AsanaWorkspace;
  resource: Pick<AsanaProject, "gid" | "name">;
  resourceType: "workspace" | "project";
  employeeId: string;
}) {
  const existing = await input.db.execute<SubscriptionRow>(sql`
    select ${subscriptionColumns}
    from public.asana_webhook_subscription
    where connected_account_id = ${input.connectedAccountId}
      and resource_external_id = ${input.resource.gid}
    limit 1
  `);
  if (existing[0]?.status === "active" && existing[0].webhookGid)
    return existing[0];

  const endpointToken = randomBytes(32).toString("base64url");
  const targetUrl = `${appOrigin()}/api/asana/webhooks/${endpointToken}`;
  const pending = await input.db.transaction(async (tx) => {
    if (existing[0]?.secretId)
      await tx.execute(
        sql`delete from vault.secrets where id = ${existing[0].secretId}::uuid`,
      );
    const rows = await tx.execute<SubscriptionRow>(sql`
      insert into public.asana_webhook_subscription (
        workspace_external_id, workspace_name, resource_external_id,
        resource_type, resource_name, connected_account_id, endpoint_token,
        target_url, created_by_employee_id
      ) values (
        ${input.workspace.gid}, ${input.workspace.name}, ${input.resource.gid},
        ${input.resourceType}, ${input.resource.name}, ${input.connectedAccountId},
        ${endpointToken}, ${targetUrl}, ${input.employeeId}::uuid
      ) on conflict (resource_external_id, connected_account_id) do update set
        workspace_external_id = excluded.workspace_external_id,
        workspace_name = excluded.workspace_name,
        resource_type = excluded.resource_type,
        resource_name = excluded.resource_name,
        endpoint_token = excluded.endpoint_token, target_url = excluded.target_url,
        webhook_external_id = null, secret_id = null, status = 'pending',
        last_error = null, created_by_employee_id = excluded.created_by_employee_id,
        updated_at = now()
      returning ${subscriptionColumns}
    `);
    return rows[0]!;
  });

  try {
    const webhook = await input.adapter.createWebhook(
      input.resource.gid,
      pending.targetUrl,
      input.resourceType === "workspace" ? workspaceFilters : [],
    );
    const rows = await input.db.execute<SubscriptionRow>(sql`
      update public.asana_webhook_subscription
      set webhook_external_id = ${webhook.gid}, status = 'active',
        last_error = null, updated_at = now()
      where asana_webhook_subscription_id = ${pending.subscriptionId}::uuid
        and secret_id is not null
      returning ${subscriptionColumns}
    `);
    if (!rows[0]) {
      await input.adapter.deleteWebhook(webhook.gid).catch(() => undefined);
      throw new Error("Asana did not complete the webhook handshake");
    }
    return rows[0];
  } catch (error) {
    await input.db.execute(sql`
      update public.asana_webhook_subscription set status = 'error',
        last_error = ${error instanceof Error ? error.message.slice(0, 2_000) : "Webhook registration failed"},
        updated_at = now()
      where asana_webhook_subscription_id = ${pending.subscriptionId}::uuid
    `);
    throw error;
  }
}

export async function enableAsanaWebhooks(input: {
  adapter: AsanaAdapter;
  connectedAccountId: string;
  workspace: AsanaWorkspace;
  employeeId: string;
}) {
  const db = dbRequired();
  const projects = (
    await input.adapter.listProjects(input.workspace.gid)
  ).filter((project) => !project.archived);
  const resources = [
    {
      resource: { gid: input.workspace.gid, name: input.workspace.name },
      resourceType: "workspace" as const,
    },
    ...projects.map((project) => ({
      resource: project,
      resourceType: "project" as const,
    })),
  ];
  const failures: { resourceGid: string; message: string }[] = [];
  for (let index = 0; index < resources.length; index += 5) {
    await Promise.all(
      resources.slice(index, index + 5).map(async (entry) => {
        try {
          await registerResource({ db, ...input, ...entry });
        } catch (error) {
          failures.push({
            resourceGid: entry.resource.gid,
            message:
              error instanceof Error ? error.message : "Registration failed",
          });
        }
      }),
    );
  }
  const desired = new Set(resources.map((entry) => entry.resource.gid));
  const stale = (
    await rowsForWorkspace(db, input.connectedAccountId, input.workspace.gid)
  ).filter((row) => row.status !== "deleted" && !desired.has(row.resourceGid));
  for (const row of stale) await removeSubscription(db, input.adapter, row);
  const status = await getAsanaWebhookStatus(
    input.connectedAccountId,
    input.workspace.gid,
  );
  return { ...status, requested: resources.length, failures };
}

export async function refreshAsanaWebhooksIfEnabled(input: {
  adapter: AsanaAdapter;
  connectedAccountId: string;
  workspace: AsanaWorkspace;
  employeeId: string;
}) {
  const db = dbRequired();
  const active = await db.execute(sql`
    select 1 from public.asana_webhook_subscription
    where connected_account_id = ${input.connectedAccountId}
      and workspace_external_id = ${input.workspace.gid}
      and resource_type = 'workspace' and status = 'active'
    limit 1
  `);
  return active[0] ? enableAsanaWebhooks(input) : null;
}

async function removeSubscription(
  db: Db,
  adapter: AsanaAdapter,
  row: SubscriptionRow,
) {
  if (row.webhookGid)
    await adapter.deleteWebhook(row.webhookGid).catch(() => undefined);
  await db.transaction(async (tx) => {
    if (row.secretId)
      await tx.execute(
        sql`delete from vault.secrets where id = ${row.secretId}::uuid`,
      );
    await tx.execute(sql`
      update public.asana_webhook_subscription set status = 'deleted',
        secret_id = null, updated_at = now()
      where asana_webhook_subscription_id = ${row.subscriptionId}::uuid
    `);
  });
}

export async function disableAsanaWebhooks(input: {
  adapter: AsanaAdapter;
  connectedAccountId: string;
  workspaceGid: string;
}) {
  const db = dbRequired();
  const rows = await rowsForWorkspace(
    db,
    input.connectedAccountId,
    input.workspaceGid,
  );
  for (const row of rows) {
    if (row.status !== "deleted")
      await removeSubscription(db, input.adapter, row);
  }
  return { disabled: rows.length };
}

export function asanaWebhookSignature(secret: string, rawBody: string) {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function validAsanaWebhookSignature(
  secret: string,
  rawBody: string,
  signature: string,
) {
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(asanaWebhookSignature(secret, rawBody), "hex");
  const received = Buffer.from(signature, "hex");
  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  );
}

const webhookPayload = z.object({ events: z.array(z.unknown()).max(10_000) });

export async function receiveAsanaWebhook(
  request: Request,
  endpointToken: string,
) {
  const db = dbRequired();
  const rows = await db.execute<SubscriptionRow>(sql`
    select ${subscriptionColumns}
    from public.asana_webhook_subscription
    where endpoint_token = ${endpointToken} limit 1
  `);
  const subscription = rows[0];
  if (!subscription) return new Response("Not found", { status: 404 });

  const handshakeSecret = request.headers.get("x-hook-secret")?.trim();
  if (handshakeSecret) {
    if (subscription.status !== "pending")
      return new Response("Handshake is not pending", { status: 409 });
    if (handshakeSecret.length < 16 || handshakeSecret.length > 512)
      return new Response("Invalid handshake", { status: 400 });
    await db.transaction(async (tx) => {
      let secretId = subscription.secretId;
      if (secretId)
        await tx.execute(
          sql`select vault.update_secret(${secretId}::uuid, ${handshakeSecret})`,
        );
      else {
        const created = await tx.execute<{ id: string }>(sql`
          select vault.create_secret(
            ${handshakeSecret},
            ${`asana-webhook:${subscription.subscriptionId}`},
            'Asana webhook signing secret'
          ) as id
        `);
        secretId = created[0]?.id ?? null;
      }
      if (!secretId) throw new Error("Vault did not store the webhook secret");
      await tx.execute(sql`
        update public.asana_webhook_subscription set secret_id = ${secretId}::uuid,
          last_error = null, updated_at = now()
        where asana_webhook_subscription_id = ${subscription.subscriptionId}::uuid
      `);
    });
    return new Response(null, {
      status: 200,
      headers: { "x-hook-secret": handshakeSecret },
    });
  }

  if (subscription.status === "deleted")
    return new Response(null, { status: 410 });
  if (subscription.status !== "active" || !subscription.secretId)
    return new Response("Webhook is not active", { status: 409 });
  const roles = await db.execute<{ key: string }>(sql`
    select role.key from public.employee_role membership
    join public.role role on role.role_id = membership.role_id
    where membership.employee_id = ${subscription.employeeId}::uuid
  `);
  if (
    !(await featureEnabled("asana.sync", {
      userId: subscription.employeeId,
      roles: roles.map((role) => role.key),
    }))
  ) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`delete from vault.secrets where id = ${subscription.secretId}::uuid`,
      );
      await tx.execute(sql`
        update public.asana_webhook_subscription set status = 'deleted',
          secret_id = null, updated_at = now()
        where asana_webhook_subscription_id = ${subscription.subscriptionId}::uuid
      `);
    });
    return new Response(null, { status: 410 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000)
    return new Response("Payload too large", { status: 413 });
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > 1_000_000)
    return new Response("Payload too large", { status: 413 });
  const secrets = await db.execute<{ decryptedSecret: string }>(sql`
    select decrypted_secret as "decryptedSecret" from vault.decrypted_secrets
    where id = ${subscription.secretId}::uuid limit 1
  `);
  const secret = secrets[0]?.decryptedSecret;
  const signature = request.headers.get("x-hook-signature")?.trim() ?? "";
  if (!secret || !validAsanaWebhookSignature(secret, rawBody, signature))
    return new Response("Invalid signature", { status: 401 });

  let payload: z.infer<typeof webhookPayload>;
  try {
    payload = webhookPayload.parse(JSON.parse(rawBody));
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const accepted = await db.transaction(async (tx) => {
    const receipt = await tx.execute(sql`
      insert into public.asana_webhook_receipt (
        asana_webhook_subscription_id, payload_hash, event_count
      ) values (
        ${subscription.subscriptionId}::uuid, ${payloadHash}, ${payload.events.length}
      ) on conflict (asana_webhook_subscription_id, payload_hash) do nothing
      returning asana_webhook_receipt_id
    `);
    await tx.execute(sql`
      update public.asana_webhook_subscription set last_event_at = now(),
        last_event_count = ${payload.events.length}, last_error = null,
        updated_at = now()
      where asana_webhook_subscription_id = ${subscription.subscriptionId}::uuid
    `);
    if (!receipt[0] || payload.events.length === 0) return Boolean(receipt[0]);
    await tx.execute(sql`
      insert into public.scheduled_job (job_key, kind, run_at, payload)
      values (
        ${`asana-sync:${subscription.workspaceGid}`}, 'asana_sync', now(),
        ${JSON.stringify({
          workspaceGid: subscription.workspaceGid,
          workspaceName: subscription.workspaceName,
          actorEmployeeId: subscription.employeeId,
        })}::jsonb
      ) on conflict (job_key) do update set
        kind = excluded.kind, run_at = least(public.scheduled_job.run_at, now()),
        payload = excluded.payload,
        status = case when public.scheduled_job.status = 'running'
          then 'running' else 'pending' end,
        attempts = case when public.scheduled_job.status = 'running'
          then public.scheduled_job.attempts else 0 end,
        completed_at = null, last_error = null, updated_at = now()
    `);
    await tx.execute(sql`
      insert into public.audit_event (
        actor_employee_id, action, entity_type, entity_id, after, reason
      ) values (
        ${subscription.employeeId}::uuid, 'asana.webhook.received',
        'asana_webhook_subscription', ${subscription.subscriptionId}::uuid,
        jsonb_build_object('events', ${payload.events.length}, 'hash', ${payloadHash}),
        'Verified Asana HMAC webhook'
      )
    `);
    return true;
  });
  return Response.json(
    { received: true, duplicate: !accepted, events: payload.events.length },
    { headers: { "cache-control": "no-store" } },
  );
}

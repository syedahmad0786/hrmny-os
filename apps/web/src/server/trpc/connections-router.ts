import { TRPCError } from "@trpc/server";
import { and, auditEvent, connectionAccount, eq, or, sql } from "@hrmny/db";
import {
  createAsanaViaComposio,
  createComposioLive,
  createComposioStub,
  ComposioApiError,
  type AsanaAdapter,
  type ComposioConnectedAccount,
  type ComposioLiveClient,
} from "@hrmny/integrations";
import { z } from "zod";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { router, staffProcedure } from "./trpc";
import { randomUUID } from "node:crypto";
import { isWorkConnectedAppAllowed } from "../work-governance";
import { featureEnabled } from "../features";

const composioStub = createComposioStub();
const apiKeyToolkit = z.enum(["apollo", "hunter", "bayzat", "n8n"]);
const oauthToolkit = z.enum(["gmail", "calendar", "canva", "linkedin"]);

export const GoogleProfileSchema = z.object({
  email: z
    .string()
    .email()
    .refine((email) => email.toLowerCase().endsWith("@hrmny.co"), {
      message: "Connect an @hrmny.co Google Workspace account",
    }),
  email_verified: z.literal(true),
});

const GoogleWorkspaceSecretSchema = z.object({
  accessToken: z.string().min(20),
  refreshToken: z.string().min(20),
  expiresAt: z.string().datetime(),
});

const GoogleTokenResponseSchema = z.object({
  access_token: z.string().min(20),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(20).optional(),
});

export const CONNECTION_CATALOG = [
  {
    toolkit: "apollo",
    label: "Apollo",
    authType: "api_key",
    ready: true,
    note: "Paste or replace the key without a deployment.",
  },
  {
    toolkit: "hunter",
    label: "Hunter",
    authType: "api_key",
    ready: true,
    note: "Paste or replace the key without a deployment.",
  },
  {
    toolkit: "n8n",
    label: "n8n",
    authType: "api_key",
    ready: true,
    note: "hrmny Cloud API key — paste to leave mock without redeploy.",
  },
  {
    toolkit: "bayzat",
    label: "Bayzat",
    authType: "api_key",
    ready: true,
    note: "API key storage is ready; CSV remains the fallback.",
  },
  {
    toolkit: "google_workspace",
    label: "Google Workspace",
    authType: "oauth",
    ready: true,
    note: "Gmail, Calendar, Drive, and Sheets via the existing Google SSO app.",
  },
  {
    toolkit: "asana",
    label: "Asana",
    authType: "managed",
    ready: true,
    note: "Verified through the connected Composio project before any migration runs.",
  },
  {
    toolkit: "canva",
    label: "Canva",
    authType: "oauth",
    ready: true,
    note: "Connect via Composio-managed OAuth; design list is live when connected.",
  },
  {
    toolkit: "linkedin",
    label: "LinkedIn",
    authType: "oauth",
    ready: true,
    note: "Connect via Composio-managed OAuth; campaign publish is HITL when connected.",
  },
  {
    toolkit: "xero",
    label: "Xero",
    authType: "oauth",
    ready: true,
    note: "Read/mirror only — connect via OAuth; OS never writes unless XERO_WRITE_ENABLED=true.",
  },
] as const;

const workAppToolkits = [
  "googledrive",
  "one_drive",
  "dropbox",
  "box",
  "adobe",
  "gmail",
  "outlook",
  "slack",
  "microsoft_teams",
  "zoom",
  "salesforce",
  "jira",
  "power_bi",
  "servicenow",
] as const;
const workAppToolkit = z.enum(workAppToolkits);
export type WorkAppToolkit = (typeof workAppToolkits)[number];

export const WORK_APP_CATALOG = [
  {
    toolkit: "googledrive",
    label: "Google Drive",
    family: "files",
    familyFeatureKey: "work.integrations.files",
    featureKey: "work.integrations.files.google_drive",
    note: "Attach Drive files to work without copying them into hrmny.",
  },
  {
    toolkit: "one_drive",
    label: "OneDrive",
    family: "files",
    familyFeatureKey: "work.integrations.files",
    featureKey: "work.integrations.files.one_drive",
    note: "Use Microsoft cloud files alongside tasks and projects.",
  },
  {
    toolkit: "dropbox",
    label: "Dropbox",
    family: "files",
    familyFeatureKey: "work.integrations.files",
    featureKey: "work.integrations.files.dropbox",
    note: "Link Dropbox assets to shared work.",
  },
  {
    toolkit: "box",
    label: "Box",
    family: "files",
    familyFeatureKey: "work.integrations.files",
    featureKey: "work.integrations.files.box",
    note: "Connect governed Box content to work.",
  },
  {
    toolkit: "adobe",
    label: "Adobe",
    family: "files",
    familyFeatureKey: "work.integrations.files",
    featureKey: "work.integrations.files.adobe",
    note: "Connect Adobe assets; review and proofing stay in hrmny.",
  },
  {
    toolkit: "gmail",
    label: "Gmail",
    family: "communication",
    familyFeatureKey: "work.integrations.communication",
    featureKey: "work.integrations.communication.gmail",
    note: "Capture email context and send governed work updates.",
  },
  {
    toolkit: "outlook",
    label: "Outlook",
    family: "communication",
    familyFeatureKey: "work.integrations.communication",
    featureKey: "work.integrations.communication.outlook",
    note: "Connect Microsoft email and calendar context.",
  },
  {
    toolkit: "slack",
    label: "Slack",
    family: "communication",
    familyFeatureKey: "work.integrations.communication",
    featureKey: "work.integrations.communication.slack",
    note: "Turn conversations into work and publish approved updates.",
  },
  {
    toolkit: "microsoft_teams",
    label: "Microsoft Teams",
    family: "communication",
    familyFeatureKey: "work.integrations.communication",
    featureKey: "work.integrations.communication.teams",
    note: "Connect Teams conversations and meeting collaboration.",
  },
  {
    toolkit: "zoom",
    label: "Zoom",
    family: "communication",
    familyFeatureKey: "work.integrations.communication",
    featureKey: "work.integrations.communication.zoom",
    note: "Connect meeting recordings and transcripts to follow-up work.",
  },
  {
    toolkit: "salesforce",
    label: "Salesforce",
    family: "enterprise",
    familyFeatureKey: "work.integrations.enterprise",
    featureKey: "work.integrations.enterprise.salesforce",
    note: "Connect customer records and delivery work.",
  },
  {
    toolkit: "jira",
    label: "Jira",
    family: "enterprise",
    familyFeatureKey: "work.integrations.enterprise",
    featureKey: "work.integrations.enterprise.jira",
    note: "Coordinate product and engineering work across systems.",
  },
  {
    toolkit: "power_bi",
    label: "Power BI",
    family: "enterprise",
    familyFeatureKey: "work.integrations.enterprise",
    featureKey: "work.integrations.enterprise.power_bi",
    note: "Use a project auth config to connect reporting workflows.",
  },
  {
    toolkit: "servicenow",
    label: "ServiceNow",
    family: "enterprise",
    familyFeatureKey: "work.integrations.enterprise",
    featureKey: "work.integrations.enterprise.servicenow",
    note: "Connect service-management requests and delivery work.",
  },
] as const;

type WorkAppDefinition = (typeof WORK_APP_CATALOG)[number];
type WorkIntegrationFeatureKey =
  WorkAppDefinition["familyFeatureKey"] | WorkAppDefinition["featureKey"];
const WORK_INTEGRATION_FEATURE_KEYS: readonly WorkIntegrationFeatureKey[] = [
  ...new Set(
    WORK_APP_CATALOG.flatMap((item) => [
      item.familyFeatureKey,
      item.featureKey,
    ]),
  ),
];

export function workIntegrationFeatureKeysForToolkit(toolkit: string) {
  const item = WORK_APP_CATALOG.find(
    (candidate) => candidate.toolkit === toolkit,
  );
  return item ? [item.familyFeatureKey, item.featureKey] : [];
}

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "DATABASE_URL is required for persistent connections",
    });
  }
  return db;
}

function requireEmployeeId(employeeId: string | null): string {
  if (!employeeId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Employee required" });
  }
  return employeeId;
}

async function requireAllowedApp(toolkit: string) {
  if (!(await isWorkConnectedAppAllowed(toolkit))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${toolkit} is blocked by the organization connected-app policy`,
    });
  }
}

function featureSubject(ctx: {
  employeeId: string | null;
  clientId?: string | null;
  roles: readonly string[];
}) {
  return {
    userId: ctx.employeeId,
    clientId: ctx.clientId,
    roles: ctx.roles,
  };
}

async function requireWorkIntegrationFeature(
  definition: WorkAppDefinition,
  ctx: Parameters<typeof featureSubject>[0],
) {
  for (const featureKey of [
    definition.familyFeatureKey,
    definition.featureKey,
  ]) {
    if (!(await featureEnabled(featureKey, featureSubject(ctx)))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `FEATURE_DISABLED:${featureKey}`,
      });
    }
  }
}

async function auditComposioConnection(input: {
  employeeId: string;
  action:
    "connections.workApp.connectStarted" | "connections.workApp.disconnect";
  toolkit: string;
  connectedAccountId: string;
}) {
  const after = {
    toolkit: input.toolkit,
    connectedAccountId: input.connectedAccountId,
  };
  const db = getDb();
  if (db) {
    await db.insert(auditEvent).values({
      actorEmployeeId: input.employeeId,
      action: input.action,
      entityType: "composio_connected_account",
      entityId: null,
      after,
    });
    return;
  }
  getDemoStore().appendAudit({
    actorEmployeeId: input.employeeId,
    action: input.action,
    entityType: "composio_connected_account",
    entityId: "00000000-0000-4000-8000-000000000000",
    before: null,
    after,
    reason: null,
  });
}

export async function getEmployeeIntegrationSecret(
  employeeId: string,
  toolkit: "apollo" | "hunter" | "bayzat" | "n8n",
): Promise<string | null> {
  if (!(await isWorkConnectedAppAllowed(toolkit))) return null;
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .select({ secretId: connectionAccount.secretId })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.toolkit, toolkit),
        eq(connectionAccount.scope, "staff"),
        eq(connectionAccount.status, "connected"),
      ),
    )
    .limit(1);
  if (!row?.secretId) return null;
  const secrets = await db.execute(
    sql<{ decrypted_secret: string }>`
      select decrypted_secret
      from vault.decrypted_secrets
      where id = ${row.secretId}::uuid
      limit 1
    `,
  );
  const decrypted = secrets[0]?.decrypted_secret;
  return typeof decrypted === "string" ? decrypted : null;
}

const ACTIVE_COMPOSIO_STATUSES = new Set(["ACTIVE", "CONNECTED", "SUCCESS"]);
let systemComposio: ComposioLiveClient | undefined;

function requireSystemComposio() {
  const apiKey = process.env.COMPOSIO_API_KEY?.trim();
  if (!apiKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "COMPOSIO_API_KEY is not configured",
    });
  }
  return (systemComposio ??= createComposioLive({ apiKey }));
}

/** Where Canva/LinkedIn OAuth should return so reconcile + polling can run. */
export function composioConnectionsCallbackUrl(): string {
  return new URL(
    "/settings/connections",
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
  ).toString();
}

function isActiveComposioStatus(
  status: string | null | undefined,
  isDisabled?: boolean | null,
): boolean {
  if (isDisabled) return false;
  if (!status) return false;
  return ACTIVE_COMPOSIO_STATUSES.has(status.toUpperCase());
}

/** Prefer exact toolkit match, then Composio-managed `composio:<toolkit>` vault row. */
export function findStaffConnectionRow<T extends { toolkit: string }>(
  rows: readonly T[],
  toolkit: string,
): T | undefined {
  return (
    rows.find((candidate) => candidate.toolkit === toolkit) ??
    rows.find((candidate) => candidate.toolkit === `composio:${toolkit}`)
  );
}

export function isActiveComposioRemote(
  status: string | null | undefined,
  isDisabled?: boolean | null,
): boolean {
  return isActiveComposioStatus(status, isDisabled);
}

/**
 * Prefer an ACTIVE account matching the stored Composio id; otherwise any
 * ACTIVE account for the toolkit. Never let a stale INITIATED/expired id
 * block reconcile when another ACTIVE account exists (reconnect leftovers).
 */
export function pickActiveComposioAccount<
  T extends {
    id: string;
    status: string;
    is_disabled?: boolean | null;
    toolkit: { slug: string };
  },
>(input: {
  externalConnectionId: string | null | undefined;
  toolkitSlug: string;
  remote: readonly T[];
}): T | undefined {
  const slug = input.toolkitSlug.toLowerCase();
  const byId = input.externalConnectionId
    ? input.remote.find(
        (candidate) => candidate.id === input.externalConnectionId,
      )
    : undefined;
  if (byId && isActiveComposioStatus(byId.status, byId.is_disabled)) {
    return byId;
  }
  return input.remote.find(
    (candidate) =>
      candidate.toolkit.slug.toLowerCase() === slug &&
      isActiveComposioStatus(candidate.status, candidate.is_disabled),
  );
}

/**
 * After Composio OAuth, vault rows often stay `pending` even when the remote
 * account is ACTIVE. Flip them to `connected` so /api/ready and Connections UI
 * reflect a completed connect (and keep externalConnectionId in sync).
 */
async function reconcileComposioManagedStatus(
  db: NonNullable<ReturnType<typeof getDb>>,
  employeeId: string,
  remote: readonly ComposioConnectedAccount[],
): Promise<void> {
  const local = await db
    .select({
      connectionAccountId: connectionAccount.connectionAccountId,
      toolkit: connectionAccount.toolkit,
      externalConnectionId: connectionAccount.externalConnectionId,
      status: connectionAccount.status,
    })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.scope, "staff"),
        sql`${connectionAccount.toolkit} like 'composio:%'`,
      ),
    );

  for (const account of local) {
    const slug = account.toolkit.slice("composio:".length).toLowerCase();
    const current = pickActiveComposioAccount({
      externalConnectionId: account.externalConnectionId,
      toolkitSlug: slug,
      remote,
    });
    if (!current) {
      continue;
    }
    if (
      account.status === "connected" &&
      account.externalConnectionId === current.id
    ) {
      continue;
    }
    await db
      .update(connectionAccount)
      .set({
        status: "connected",
        externalConnectionId: current.id,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        eq(
          connectionAccount.connectionAccountId,
          account.connectionAccountId,
        ),
      );
  }
}

export type VerifiedWorkAppConnection = {
  account: ComposioConnectedAccount;
  client: ComposioLiveClient;
};

export async function getVerifiedWorkAppConnection(
  employeeId: string,
  toolkit: WorkAppToolkit,
  ctx: { clientId?: string | null; roles: readonly string[] },
): Promise<VerifiedWorkAppConnection | null> {
  const definition = WORK_APP_CATALOG.find(
    (candidate) => candidate.toolkit === toolkit,
  )!;
  const subject = { employeeId, clientId: ctx.clientId, roles: ctx.roles };
  const [bridgeAllowed, toolkitAllowed, familyEnabled, providerEnabled] =
    await Promise.all([
      isWorkConnectedAppAllowed("composio"),
      isWorkConnectedAppAllowed(toolkit),
      featureEnabled(definition.familyFeatureKey, featureSubject(subject)),
      featureEnabled(definition.featureKey, featureSubject(subject)),
    ]);
  if (!bridgeAllowed || !toolkitAllowed || !familyEnabled || !providerEnabled)
    return null;
  if (!process.env.COMPOSIO_API_KEY?.trim()) return null;
  const client = requireSystemComposio();
  const accounts = await client.listConnectedAccounts({
    toolkit,
    userId: employeeId,
  });
  const account = accounts.find(
    (candidate) =>
      candidate.user_id === employeeId &&
      candidate.toolkit.slug === toolkit &&
      !candidate.is_disabled &&
      ACTIVE_COMPOSIO_STATUSES.has(candidate.status.toUpperCase()),
  );
  return account ? { account, client } : null;
}

export type VerifiedAsanaConnection = {
  account: ComposioConnectedAccount;
  adapter: AsanaAdapter;
  provider: "composio";
};

export async function getVerifiedAsanaConnection(
  _employeeId: string,
): Promise<VerifiedAsanaConnection | null> {
  if (
    !(await isWorkConnectedAppAllowed("asana")) ||
    !(await isWorkConnectedAppAllowed("composio"))
  )
    return null;
  if (!process.env.COMPOSIO_API_KEY?.trim()) return null;
  const client = requireSystemComposio();
  const accounts = await client.listConnectedAccounts({ toolkit: "asana" });
  const account = accounts.find(
    (candidate) =>
      !candidate.is_disabled &&
      ACTIVE_COMPOSIO_STATUSES.has(candidate.status.toUpperCase()),
  );
  if (!account) return null;
  return {
    account,
    adapter: createAsanaViaComposio({
      client,
      connectedAccountId: account.id,
    }),
    provider: "composio",
  };
}

export async function getGoogleWorkspaceAccessToken(
  employeeId: string,
): Promise<string | null> {
  if (!(await isWorkConnectedAppAllowed("google_workspace"))) return null;
  const db = getDb();
  if (!db) return null;
  // Include `error` rows that still have a vault secret so a transient refresh
  // failure (missing env locally, brief Google outage) can self-heal once
  // credentials work again — without forcing a full OAuth reconnect.
  const [row] = await db
    .select({
      connectionAccountId: connectionAccount.connectionAccountId,
      secretId: connectionAccount.secretId,
      status: connectionAccount.status,
    })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.toolkit, "google_workspace"),
        eq(connectionAccount.scope, "staff"),
        or(
          eq(connectionAccount.status, "connected"),
          eq(connectionAccount.status, "error"),
        ),
      ),
    )
    .limit(1);
  if (!row?.secretId) return null;

  const secrets = await db.execute(
    sql<{ decrypted_secret: string }>`
      select decrypted_secret
      from vault.decrypted_secrets
      where id = ${row.secretId}::uuid
      limit 1
    `,
  );
  const decrypted = secrets[0]?.decrypted_secret;
  if (typeof decrypted !== "string") {
    throw new Error("Google Workspace connection secret is unavailable");
  }
  const stored = GoogleWorkspaceSecretSchema.parse(JSON.parse(decrypted));
  if (Date.parse(stored.expiresAt) > Date.now() + 60_000) {
    if (row.status === "error") {
      await db
        .update(connectionAccount)
        .set({
          status: "connected",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(
          eq(connectionAccount.connectionAccountId, row.connectionAccountId),
        );
    }
    return stored.accessToken;
  }

  const clientId = (
    process.env.GOOGLE_OAUTH_CLIENT_ID ?? process.env.client_id
  )?.trim();
  const clientSecret = (
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? process.env.client_secret
  )?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth client credentials are not configured");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let reason = `Google token refresh failed (${response.status})`;
    try {
      const parsed = JSON.parse(detail) as {
        error?: string;
        error_description?: string;
      };
      if (parsed.error_description || parsed.error) {
        reason = `Google token refresh failed (${response.status}): ${
          parsed.error_description ?? parsed.error
        }`;
      }
    } catch {
      if (detail.trim()) reason = `${reason}: ${detail.slice(0, 180)}`;
    }
    // Record the failure for ops UI, but keep the vault secret reachable so a
    // later refresh (after env/credentials recover) or reconnect can restore
    // `connected` without a stuck permanent lockout.
    await db
      .update(connectionAccount)
      .set({
        status: "error",
        lastError: reason.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(
        eq(connectionAccount.connectionAccountId, row.connectionAccountId),
      );
    throw new Error(reason);
  }

  const refreshed = GoogleTokenResponseSchema.parse(await response.json());
  const expiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
  const replacement = JSON.stringify({
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? stored.refreshToken,
    expiresAt: expiresAt.toISOString(),
  });
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select vault.update_secret(${row.secretId}::uuid, ${replacement})`,
    );
    await tx
      .update(connectionAccount)
      .set({
        status: "connected",
        expiresAt,
        lastTestedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        eq(connectionAccount.connectionAccountId, row.connectionAccountId),
      );
  });
  return refreshed.access_token;
}

export const connectionsRouter = router({
  list: staffProcedure
    .input(
      z.object({ scope: z.enum(["staff", "portal"]).optional() }).optional(),
    )
    .query(async ({ ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      const allowed = new Map(
        await Promise.all(
          CONNECTION_CATALOG.map(
            async (item) =>
              [
                item.toolkit,
                await isWorkConnectedAppAllowed(item.toolkit),
              ] as const,
          ),
        ),
      );
      const db = getDb();
      if (!db) {
        const existing = getDemoStore().connections;
        return CONNECTION_CATALOG.map((item) => {
          const row = existing.find(
            (candidate) => candidate.toolkit === item.toolkit,
          );
        return {
            ...item,
            ready:
              item.toolkit === "xero"
                ? Boolean(
                    process.env.XERO_CLIENT_ID?.trim() &&
                      process.env.XERO_CLIENT_SECRET?.trim(),
                  )
                : item.ready,
            allowed: allowed.get(item.toolkit) ?? false,
            connectionAccountId: row?.connectionAccountId ?? null,
            scope: row?.scope ?? "staff",
            status: row?.status ?? "disconnected",
            externalConnectionId: row?.externalConnectionId ?? null,
            hasSecret: false,
            lastTestedAt: null,
            lastError: null,
          };
        });
      }
      if (process.env.COMPOSIO_API_KEY?.trim()) {
        try {
          const remote =
            await requireSystemComposio().listUserConnectedAccounts(employeeId);
          await reconcileComposioManagedStatus(db, employeeId, remote);
        } catch {
          // Readiness reconcile is best-effort; catalog still returns vault rows.
        }
      }

      const rows = await db
        .select({
          connectionAccountId: connectionAccount.connectionAccountId,
          toolkit: connectionAccount.toolkit,
          status: connectionAccount.status,
          secretId: connectionAccount.secretId,
          externalConnectionId: connectionAccount.externalConnectionId,
          lastTestedAt: connectionAccount.lastTestedAt,
          lastError: connectionAccount.lastError,
        })
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.ownerEmployeeId, employeeId),
            eq(connectionAccount.scope, "staff"),
          ),
        );
      return CONNECTION_CATALOG.map((item) => {
        const row = findStaffConnectionRow(rows, item.toolkit);
        return {
          ...item,
          ready:
            item.toolkit === "xero"
              ? Boolean(
                  process.env.XERO_CLIENT_ID?.trim() &&
                    process.env.XERO_CLIENT_SECRET?.trim(),
                )
              : item.ready,
          allowed: allowed.get(item.toolkit) ?? false,
          connectionAccountId: row?.connectionAccountId ?? null,
          scope: "staff" as const,
          status: row?.status ?? "disconnected",
          externalConnectionId: row?.externalConnectionId ?? null,
          hasSecret: Boolean(row?.secretId),
          lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
          lastError: row?.lastError ?? null,
        };
      });
    }),

  saveApiKey: staffProcedure
    .input(
      z.object({
        toolkit: apiKeyToolkit,
        apiKey: z.string().trim().min(6).max(4096),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      await requireAllowedApp(input.toolkit);

      const { probeIntegrationApiKey } = await import(
        "../integrations/probe-api-key"
      );
      const probed = await probeIntegrationApiKey(input.toolkit, input.apiKey);
      if (!probed.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Key rejected by ${input.toolkit}: ${probed.reason}`,
        });
      }

      const db = requireDb();
      const [existing] = await db
        .select()
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.ownerEmployeeId, employeeId),
            eq(connectionAccount.toolkit, input.toolkit),
            eq(connectionAccount.scope, "staff"),
          ),
        )
        .limit(1);

      const row = await db.transaction(async (tx) => {
        let secretId = existing?.secretId ?? null;
        if (secretId) {
          await tx.execute(
            sql`select vault.update_secret(${secretId}::uuid, ${input.apiKey})`,
          );
        } else {
          const created = await tx.execute(
            sql<{ id: string }>`
              select vault.create_secret(
                ${input.apiKey},
                ${`hrmny:${employeeId}:${input.toolkit}`},
                ${`${input.toolkit} API key managed by hrmny OS`}
              ) as id
            `,
          );
          const createdId = created[0]?.id;
          secretId = typeof createdId === "string" ? createdId : null;
        }
        if (!secretId) throw new Error("Vault did not return a secret id");

        const values = {
          ownerEmployeeId: employeeId,
          toolkit: input.toolkit,
          scope: "staff",
          authType: "api_key",
          label: input.toolkit,
          secretId,
          externalConnectionId: existing?.externalConnectionId,
          status: "connected",
          lastTestedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        };
        const [saved] = existing
          ? await tx
              .update(connectionAccount)
              .set(values)
              .where(
                eq(
                  connectionAccount.connectionAccountId,
                  existing.connectionAccountId,
                ),
              )
              .returning()
          : await tx.insert(connectionAccount).values(values).returning();

        await tx.insert(auditEvent).values({
          actorEmployeeId: employeeId,
          action: existing
            ? "connections.replaceKey"
            : "connections.connectKey",
          entityType: "connection_account",
          entityId: saved!.connectionAccountId,
          before: existing ? { status: existing.status } : null,
          after: {
            toolkit: input.toolkit,
            status: "connected",
            probed: true,
          },
        });
        return saved!;
      });

      return {
        connectionAccountId: row.connectionAccountId,
        toolkit: row.toolkit,
        status: row.status,
        hasSecret: true,
        probed: true as const,
      };
    }),

  asanaStatus: staffProcedure.query(async ({ ctx }) => {
    const verified = await getVerifiedAsanaConnection(
      requireEmployeeId(ctx.employeeId),
    );
    if (!verified) {
      return {
        connected: false as const,
        provider: null,
        connectedAccountId: null,
        providerUserId: null,
        user: null,
        workspaces: [],
      };
    }
    const [user, workspaces] = await Promise.all([
      verified.adapter.me(),
      verified.adapter.listWorkspaces(),
    ]);
    return {
      connected: true as const,
      provider: verified.provider,
      connectedAccountId: verified.account.id,
      providerUserId: verified.account.user_id ?? null,
      user,
      workspaces,
    };
  }),

  workApps: staffProcedure.query(async ({ ctx }) => {
    const employeeId = requireEmployeeId(ctx.employeeId);
    const enabled = new Map<WorkIntegrationFeatureKey, boolean>(
      await Promise.all(
        WORK_INTEGRATION_FEATURE_KEYS.map(
          async (featureKey) =>
            [
              featureKey,
              await featureEnabled(featureKey, featureSubject(ctx)),
            ] as const,
        ),
      ),
    );
    const visible = WORK_APP_CATALOG.filter(
      (item) =>
        enabled.get(item.familyFeatureKey) && enabled.get(item.featureKey),
    );
    const bridgeAllowed = await isWorkConnectedAppAllowed("composio");
    if (!visible.length) {
      return {
        bridgeAllowed,
        bridgeConfigured: false,
        bridgeError: null,
        apps: [],
      };
    }
    const allowed = new Map(
      await Promise.all(
        visible.map(
          async (item) =>
            [
              item.toolkit,
              await isWorkConnectedAppAllowed(item.toolkit),
            ] as const,
        ),
      ),
    );
    const apiKey = bridgeAllowed ? process.env.COMPOSIO_API_KEY?.trim() : null;
    const emptyApps = () =>
      visible.map((item) => ({
        ...item,
        allowed: allowed.get(item.toolkit) ?? false,
        connected: false,
        connectedAccountId: null,
        connectionStatus: null,
        authConfigured: null,
        managedAuth: null,
      }));
    if (!apiKey) {
      return {
        bridgeAllowed,
        bridgeConfigured: false,
        bridgeError: null,
        apps: emptyApps(),
      };
    }

    try {
      const client = requireSystemComposio();
      const [accounts, authConfigs] = await Promise.all([
        client.listConnectedAccounts({ userId: employeeId }),
        client.listAuthConfigs(),
      ]);
      return {
        bridgeAllowed,
        bridgeConfigured: true,
        bridgeError: null,
        apps: visible.map((item) => {
          const candidates = accounts.filter(
            (account) => account.toolkit.slug.toLowerCase() === item.toolkit,
          );
          const account =
            candidates.find(
              (candidate) =>
                !candidate.is_disabled &&
                ACTIVE_COMPOSIO_STATUSES.has(candidate.status.toUpperCase()),
            ) ?? candidates[0];
          const authConfig = authConfigs.find(
            (config) =>
              config.toolkit.slug.toLowerCase() === item.toolkit &&
              config.status.toUpperCase() === "ENABLED",
          );
          return {
            ...item,
            allowed: allowed.get(item.toolkit) ?? false,
            connected: Boolean(
              account &&
              !account.is_disabled &&
              ACTIVE_COMPOSIO_STATUSES.has(account.status.toUpperCase()),
            ),
            connectedAccountId: account?.id ?? null,
            connectionStatus: account?.status ?? null,
            authConfigured: Boolean(authConfig),
            managedAuth: authConfig?.is_composio_managed ?? null,
          };
        }),
      };
    } catch (error) {
      return {
        bridgeAllowed,
        bridgeConfigured: true,
        bridgeError:
          error instanceof ComposioApiError
            ? `Composio rejected the connection check (${error.status})`
            : "Composio returned an invalid connection response",
        apps: emptyApps(),
      };
    }
  }),

  startWorkAppLink: staffProcedure
    .input(z.object({ toolkit: workAppToolkit }))
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      const definition = WORK_APP_CATALOG.find(
        (item) => item.toolkit === input.toolkit,
      )!;
      await requireWorkIntegrationFeature(definition, ctx);
      await requireAllowedApp("composio");
      await requireAllowedApp(input.toolkit);
      const client = requireSystemComposio();
      const [configs, accounts] = await Promise.all([
        client.listAuthConfigs({ toolkits: [input.toolkit] }),
        client.listConnectedAccounts({
          toolkit: input.toolkit,
          userId: employeeId,
        }),
      ]);
      if (
        accounts.some(
          (account) =>
            !account.is_disabled &&
            ACTIVE_COMPOSIO_STATUSES.has(account.status.toUpperCase()),
        )
      ) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `${definition.label} is already connected`,
        });
      }
      const authConfig = configs.find(
        (config) => config.status.toUpperCase() === "ENABLED",
      );
      if (!authConfig) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Create and enable a ${definition.label} auth config in Composio first`,
        });
      }
      const link = await client.createConnectLink({
        authConfigId: authConfig.id,
        userId: employeeId,
        callbackUrl: new URL(
          "/settings/connections",
          process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
        ).toString(),
      });
      await auditComposioConnection({
        employeeId,
        action: "connections.workApp.connectStarted",
        toolkit: input.toolkit,
        connectedAccountId: link.connected_account_id,
      });
      return {
        redirectUrl: link.redirect_url,
        connectedAccountId: link.connected_account_id,
        expiresAt: link.expires_at,
      };
    }),

  disconnectWorkApp: staffProcedure
    .input(
      z.object({
        toolkit: workAppToolkit,
        connectedAccountId: z.string().min(1),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      const definition = WORK_APP_CATALOG.find(
        (item) => item.toolkit === input.toolkit,
      )!;
      await requireWorkIntegrationFeature(definition, ctx);
      await requireAllowedApp("composio");
      await requireAllowedApp(input.toolkit);
      const client = requireSystemComposio();
      const accounts = await client.listConnectedAccounts({
        toolkit: input.toolkit,
        userId: employeeId,
      });
      if (
        !accounts.some((account) => account.id === input.connectedAccountId)
      ) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await client.deleteConnectedAccount({
        connectedAccountId: input.connectedAccountId,
        revokeOnDelete: true,
      });
      await auditComposioConnection({
        employeeId,
        action: "connections.workApp.disconnect",
        toolkit: input.toolkit,
        connectedAccountId: input.connectedAccountId,
      });
      return { ok: true as const };
    }),

  managedToolkits: staffProcedure
    .input(
      z
        .object({
          search: z.string().trim().max(80).default(""),
          page: z.number().int().min(1).default(1),
          pageSize: z.number().int().min(6).max(24).default(12),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      await requireAllowedApp("composio");
      const search = input?.search.toLowerCase() ?? "";
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 12;
      const toolkits = (
        await requireSystemComposio().listManagedToolkits()
      ).filter(
        (toolkit) =>
          !workAppToolkits.some((slug) => slug === toolkit.slug) &&
          (!search ||
            toolkit.name.toLowerCase().includes(search) ||
            toolkit.slug.toLowerCase().includes(search) ||
            toolkit.description?.toLowerCase().includes(search)),
      );
      const offset = (page - 1) * pageSize;
      return {
        items: await Promise.all(
          toolkits.slice(offset, offset + pageSize).map(async (toolkit) => ({
            ...toolkit,
            allowed: await isWorkConnectedAppAllowed(toolkit.slug),
          })),
        ),
        page,
        pageCount: Math.max(1, Math.ceil(toolkits.length / pageSize)),
        total: toolkits.length,
      };
    }),

  managedAccounts: staffProcedure.query(async ({ ctx }) => {
    const employeeId = requireEmployeeId(ctx.employeeId);
    await requireAllowedApp("composio");
    const db = requireDb();
    const remote =
      await requireSystemComposio().listUserConnectedAccounts(employeeId);
    await reconcileComposioManagedStatus(db, employeeId, remote);
    const local = await db
      .select({
        connectionAccountId: connectionAccount.connectionAccountId,
        toolkit: connectionAccount.toolkit,
        externalConnectionId: connectionAccount.externalConnectionId,
        status: connectionAccount.status,
      })
      .from(connectionAccount)
      .where(
        and(
          eq(connectionAccount.ownerEmployeeId, employeeId),
          eq(connectionAccount.scope, "staff"),
          sql`${connectionAccount.toolkit} like 'composio:%'`,
        ),
      );
    return local.map((account) => {
      const slug = account.toolkit.slice("composio:".length);
      const current = pickActiveComposioAccount({
        externalConnectionId: account.externalConnectionId,
        toolkitSlug: slug,
        remote,
      });
      return {
        connectionAccountId: account.connectionAccountId,
        connectedAccountId: current?.id ?? account.externalConnectionId,
        toolkit: slug,
        status: current?.status ?? account.status,
        statusReason: current?.status_reason ?? null,
      };
    });
  }),

  authorizeManaged: staffProcedure
    .input(
      z.object({
        toolkit: z
          .string()
          .trim()
          .min(1)
          .max(120)
          .regex(/^[a-z0-9_-]+$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      await requireAllowedApp("composio");
      await requireAllowedApp(input.toolkit);
      if (workAppToolkits.some((toolkit) => toolkit === input.toolkit)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Use the governed Work app connection",
        });
      }
      const client = requireSystemComposio();
      const toolkits = await client.listManagedToolkits();
      if (!toolkits.some((toolkit) => toolkit.slug === input.toolkit)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This toolkit does not support Composio-managed authorization",
        });
      }
      const db = requireDb();
      const toolkitKey = `composio:${input.toolkit}`;
      // Re-auth / reconnect: everyone can connect their own accounts.
      // If a row already exists, refresh the managed auth request instead of CONFLICT.
      const [existing] = await db
        .select({
          id: connectionAccount.connectionAccountId,
          externalConnectionId: connectionAccount.externalConnectionId,
          status: connectionAccount.status,
        })
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.ownerEmployeeId, employeeId),
            eq(connectionAccount.scope, "staff"),
            eq(connectionAccount.toolkit, toolkitKey),
          ),
        )
        .limit(1);

      const request = await client.authorize(employeeId, input.toolkit, {
        callbackUrl: composioConnectionsCallbackUrl(),
      });
      try {
        if (existing) {
          if (existing.externalConnectionId) {
            await client
              .disconnect(existing.externalConnectionId)
              .catch(() => undefined);
          }
          const [saved] = await db.transaction(async (tx) => {
            const updated = await tx
              .update(connectionAccount)
              .set({
                externalConnectionId: request.id,
                status: "pending",
                authType: "composio_managed",
                label: input.toolkit,
                updatedAt: new Date(),
              })
              .where(eq(connectionAccount.connectionAccountId, existing.id))
              .returning();
            await tx.insert(auditEvent).values({
              actorEmployeeId: employeeId,
              action: "connections.composio.reauthorize",
              entityType: "connection_account",
              entityId: existing.id,
              after: {
                toolkit: input.toolkit,
                status: "pending",
                previousStatus: existing.status,
              },
            });
            return updated;
          });
          return {
            connectionAccountId: saved!.connectionAccountId,
            redirectUrl: request.redirectUrl,
            reconnected: true as const,
          };
        }

        const [saved] = await db.transaction(async (tx) => {
          const created = await tx
            .insert(connectionAccount)
            .values({
              ownerEmployeeId: employeeId,
              toolkit: toolkitKey,
              scope: "staff",
              authType: "composio_managed",
              label: input.toolkit,
              externalConnectionId: request.id,
              status: "pending",
            })
            .returning();
          await tx.insert(auditEvent).values({
            actorEmployeeId: employeeId,
            action: "connections.composio.authorize",
            entityType: "connection_account",
            entityId: created[0]!.connectionAccountId,
            after: { toolkit: input.toolkit, status: "pending" },
          });
          return created;
        });
        return {
          connectionAccountId: saved!.connectionAccountId,
          redirectUrl: request.redirectUrl,
          reconnected: false as const,
        };
      } catch (error) {
        await client.disconnect(request.id).catch(() => undefined);
        throw error;
      }
    }),

  disconnectManaged: staffProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      await requireAllowedApp("composio");
      const db = requireDb();
      const [existing] = await db
        .select()
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.connectionAccountId, input.id),
            eq(connectionAccount.ownerEmployeeId, employeeId),
            eq(connectionAccount.scope, "staff"),
            sql`${connectionAccount.toolkit} like 'composio:%'`,
          ),
        )
        .limit(1);
      if (!existing?.externalConnectionId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      await requireAllowedApp(existing.toolkit.slice("composio:".length));
      await requireSystemComposio().disconnect(existing.externalConnectionId);
      await db.transaction(async (tx) => {
        await tx
          .delete(connectionAccount)
          .where(
            eq(
              connectionAccount.connectionAccountId,
              existing.connectionAccountId,
            ),
          );
        await tx.insert(auditEvent).values({
          actorEmployeeId: employeeId,
          action: "connections.composio.disconnect",
          entityType: "connection_account",
          entityId: existing.connectionAccountId,
          before: { toolkit: existing.toolkit, status: existing.status },
          after: { status: "disconnected" },
        });
      });
      return { ok: true as const };
    }),

  saveGoogleWorkspace: staffProcedure
    .input(
      z.object({
        accessToken: z.string().min(20).max(8192),
        refreshToken: z.string().min(20).max(8192),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      await requireAllowedApp("google_workspace");
      const profileResponse = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        { headers: { authorization: `Bearer ${input.accessToken}` } },
      );
      if (!profileResponse.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Google rejected the connection token",
        });
      }
      const profile = GoogleProfileSchema.parse(await profileResponse.json());
      const db = requireDb();
      const [existing] = await db
        .select()
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.ownerEmployeeId, employeeId),
            eq(connectionAccount.toolkit, "google_workspace"),
            eq(connectionAccount.scope, "staff"),
          ),
        )
        .limit(1);
      const expiresAt = new Date(Date.now() + 55 * 60 * 1000);
      const secret = JSON.stringify({
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: expiresAt.toISOString(),
      });

      const saved = await db.transaction(async (tx) => {
        let secretId = existing?.secretId ?? null;
        if (secretId) {
          await tx.execute(
            sql`select vault.update_secret(${secretId}::uuid, ${secret})`,
          );
        } else {
          const created = await tx.execute(
            sql<{ id: string }>`
              select vault.create_secret(
                ${secret},
                ${`hrmny:${employeeId}:google_workspace`},
                'Google Workspace OAuth tokens managed by hrmny OS'
              ) as id
            `,
          );
          const createdId = created[0]?.id;
          secretId = typeof createdId === "string" ? createdId : null;
        }
        if (!secretId) throw new Error("Vault did not return a secret id");

        const values = {
          ownerEmployeeId: employeeId,
          toolkit: "google_workspace",
          scope: "staff",
          authType: "oauth",
          label: "Google Workspace",
          secretId,
          externalConnectionId: profile.email.toLowerCase(),
          status: "connected",
          expiresAt,
          lastTestedAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        };
        const [row] = existing
          ? await tx
              .update(connectionAccount)
              .set(values)
              .where(
                eq(
                  connectionAccount.connectionAccountId,
                  existing.connectionAccountId,
                ),
              )
              .returning()
          : await tx.insert(connectionAccount).values(values).returning();
        await tx.insert(auditEvent).values({
          actorEmployeeId: employeeId,
          action: existing
            ? "connections.replaceOAuth"
            : "connections.connectOAuth",
          entityType: "connection_account",
          entityId: row!.connectionAccountId,
          before: existing ? { status: existing.status } : null,
          after: {
            toolkit: "google_workspace",
            status: "connected",
            account: profile.email.toLowerCase(),
          },
        });
        return row!;
      });

      return {
        connectionAccountId: saved.connectionAccountId,
        toolkit: saved.toolkit,
        status: saved.status,
        account: profile.email.toLowerCase(),
      };
    }),

  /**
   * Refresh / validate the staff Google Workspace token without sending mail.
   * Self-heals `error` → `connected` when refresh succeeds; returns the failure
   * reason when the refresh token is revoked (operator must Reconnect).
   */
  probeGoogleWorkspace: staffProcedure.mutation(async ({ ctx }) => {
    const employeeId = requireEmployeeId(ctx.employeeId);
    await requireAllowedApp("google_workspace");
    try {
      const token = await getGoogleWorkspaceAccessToken(employeeId);
      if (!token) {
        return {
          ok: false as const,
          status: "missing" as const,
          reason: "No Google Workspace connection found — connect first",
        };
      }
      const db = getDb();
      let status: string = "connected";
      let account: string | null = null;
      let lastError: string | null = null;
      if (db) {
        const [row] = await db
          .select({
            status: connectionAccount.status,
            externalConnectionId: connectionAccount.externalConnectionId,
            lastError: connectionAccount.lastError,
          })
          .from(connectionAccount)
          .where(
            and(
              eq(connectionAccount.ownerEmployeeId, employeeId),
              eq(connectionAccount.toolkit, "google_workspace"),
              eq(connectionAccount.scope, "staff"),
            ),
          )
          .limit(1);
        status = row?.status ?? "connected";
        account = row?.externalConnectionId ?? null;
        lastError = row?.lastError ?? null;
        await db
          .update(connectionAccount)
          .set({ lastTestedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(connectionAccount.ownerEmployeeId, employeeId),
              eq(connectionAccount.toolkit, "google_workspace"),
              eq(connectionAccount.scope, "staff"),
            ),
          );
      }
      return {
        ok: true as const,
        status,
        account,
        lastError,
      };
    } catch (err) {
      return {
        ok: false as const,
        status: "error" as const,
        reason: err instanceof Error ? err.message : "probe_failed",
      };
    }
  }),

  startOAuth: staffProcedure
    .input(
      z.object({
        toolkit: oauthToolkit,
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireAllowedApp(input.toolkit);
      const employeeId = requireEmployeeId(ctx.employeeId);
      if (process.env.COMPOSIO_API_KEY?.trim()) {
        const request = await requireSystemComposio().authorize(
          employeeId,
          input.toolkit,
          { callbackUrl: composioConnectionsCallbackUrl() },
        );
        return { redirectUrl: request.redirectUrl };
      }
      const redirectUri =
        input.redirectUri ??
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/settings/connections/callback`;
      const result = await composioStub.startOAuth(input.toolkit, redirectUri);
      if (!getDb()) {
        const store = getDemoStore();
        store.connections.push({
          connectionAccountId: randomUUID(),
          toolkit: input.toolkit,
          scope: "staff",
          status: "pending",
          externalConnectionId: null,
        });
        store.appendAudit({
          actorEmployeeId: employeeId,
          action: "connections.startOAuth",
          entityType: "connection_account",
          entityId: "00000000-0000-4000-8000-000000000000",
          before: null,
          after: { toolkit: input.toolkit, status: "pending" },
          reason: null,
        });
      }
      return result;
    }),

  /** Native Xero OAuth (not Composio) — tokens land in Vault. */
  startXeroOAuth: staffProcedure.mutation(async ({ ctx }) => {
    await requireAllowedApp("xero");
    const employeeId = requireEmployeeId(ctx.employeeId);
    const { buildXeroAuthorizeUrl } = await import("../finance/xero-tokens");
    return buildXeroAuthorizeUrl(employeeId);
  }),

  disconnect: staffProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      const db = getDb();
      if (!db) {
        await composioStub.disconnect(input.id);
        const store = getDemoStore();
        store.connections = store.connections.filter(
          (row) => row.connectionAccountId !== input.id,
        );
        return { ok: true as const };
      }
      const id = z.string().uuid().parse(input.id);
      const [existing] = await db
        .select()
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.connectionAccountId, id),
            eq(connectionAccount.ownerEmployeeId, employeeId),
          ),
        )
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });

      await db.transaction(async (tx) => {
        if (existing.secretId) {
          await tx.execute(
            sql`delete from vault.secrets where id = ${existing.secretId}::uuid`,
          );
        }
        await tx
          .delete(connectionAccount)
          .where(
            eq(
              connectionAccount.connectionAccountId,
              existing.connectionAccountId,
            ),
          );
        await tx.insert(auditEvent).values({
          actorEmployeeId: employeeId,
          action: "connections.disconnect",
          entityType: "connection_account",
          entityId: existing.connectionAccountId,
          before: { toolkit: existing.toolkit, status: existing.status },
          after: { status: "disconnected" },
        });
      });
      return { ok: true as const };
    }),

  status: staffProcedure
    .input(z.object({ toolkit: z.string() }))
    .query(async ({ input, ctx }) => {
      await requireAllowedApp(input.toolkit);
      const employeeId = requireEmployeeId(ctx.employeeId);
      if (process.env.COMPOSIO_API_KEY?.trim()) {
        const accounts = await requireSystemComposio().listUserConnectedAccounts(
          employeeId,
        );
        const connected = accounts.some(
          (account) =>
            account.toolkit.slug === input.toolkit &&
            !account.is_disabled &&
            ACTIVE_COMPOSIO_STATUSES.has(account.status.toUpperCase()),
        );
        return { connected, expiresAt: null };
      }
      return composioStub.status(input.toolkit, employeeId);
    }),

  /** Local/demo OAuth callback. Production callbacks must exchange real provider tokens. */
  completeOAuth: staffProcedure
    .input(z.object({ toolkit: oauthToolkit }))
    .mutation(async ({ input, ctx }) => {
      await requireAllowedApp(input.toolkit);
      if (getDb()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Complete authorization in the provider window",
        });
      }
      const store = getDemoStore();
      let row = store.connections.find(
        (candidate) =>
          candidate.toolkit === input.toolkit && candidate.scope === "staff",
      );
      if (!row) {
        row = {
          connectionAccountId: randomUUID(),
          toolkit: input.toolkit,
          scope: "staff",
          status: "connected",
          externalConnectionId: `stub-${input.toolkit}-${Date.now()}`,
        };
        store.connections.push(row);
      } else {
        row.status = "connected";
        row.externalConnectionId = `stub-${input.toolkit}-${Date.now()}`;
      }
      store.appendAudit({
        actorEmployeeId: requireEmployeeId(ctx.employeeId),
        action: "connections.completeOAuth",
        entityType: "connection_account",
        entityId: row.connectionAccountId,
        before: null,
        after: { toolkit: input.toolkit, status: "connected" },
        reason: null,
      });
      return row;
    }),

  canvaListDesigns: staffProcedure.query(async ({ ctx }) => {
    await requireAllowedApp("canva");
    const employeeId = requireEmployeeId(ctx.employeeId);

    const stubDesigns = () =>
      [
        { id: "stub-design-1", title: "Brand kit cover (Canva stub)" },
        { id: "stub-design-2", title: "Social template pack (Canva stub)" },
      ] as const;

    if (process.env.COMPOSIO_API_KEY?.trim()) {
      try {
        const client = requireSystemComposio();
        const accounts = await client.listUserConnectedAccounts(employeeId);
        const account = accounts.find(
          (candidate) =>
            candidate.toolkit.slug.toLowerCase() === "canva" &&
            !candidate.is_disabled &&
            ACTIVE_COMPOSIO_STATUSES.has(candidate.status.toUpperCase()),
        );
        if (account) {
          const { listCanvaUserDesigns } = await import("@hrmny/integrations");
          const designs = await listCanvaUserDesigns({
            client,
            connectedAccountId: account.id,
          });
          const db = getDb();
          if (db) {
            const { writeAudit } = await import("../m1-persistence");
            await writeAudit({
              actorEmployeeId: employeeId,
              action: "connections.canvaListDesigns",
              entityType: "connection_account",
              entityId: account.id,
              before: null,
              after: { count: designs.length, mode: "live" },
              reason: null,
            });
          }
          return {
            ok: true as const,
            designs: designs.map((d) => ({ id: d.id, title: d.title })),
            mode: "live" as const,
          };
        }
        // Composio configured but Canva OAuth missing — fall through to stub
        // so Creative→portal demos still work until staff reconnects Canva.
      } catch (err) {
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message:
            err instanceof Error
              ? `Canva list failed: ${err.message}`
              : "Canva list failed",
        });
      }
    }

    // Stub path: no COMPOSIO_API_KEY, or key present but Canva not connected.
    const store = getDemoStore();
    const canva = store.connections.find(
      (row) => row.toolkit === "canva" && row.status === "connected",
    );
    // Memory mode without a local Canva row still requires Connect canva.
    if (!process.env.COMPOSIO_API_KEY?.trim() && !canva) {
      return {
        ok: false as const,
        reason: "Canva not connected — use Connections → Connect canva",
        designs: [] as { id: string; title: string }[],
      };
    }
    store.appendAudit({
      actorEmployeeId: employeeId,
      action: "connections.canvaListDesigns",
      entityType: "connection_account",
      entityId: canva?.connectionAccountId ?? "canva-stub",
      before: null,
      after: {
        smoke: true,
        mode: "stub",
        reason: process.env.COMPOSIO_API_KEY?.trim()
          ? "composio_without_canva_account"
          : "no_composio",
      },
      reason: null,
    });
    return {
      ok: true as const,
      designs: [...stubDesigns()],
      mode: "stub" as const,
    };
  }),

  /**
   * Export a Canva design (PNG) into DAM and place it in client_review for
   * the portal — mirrors creativeGen.sendToPortal for the Canva creative loop.
   */
  canvaAttachToPortal: staffProcedure
    .input(
      z.object({
        designId: z.string().trim().min(1).max(120),
        clientId: z.string().uuid(),
        title: z.string().trim().min(1).max(180).optional(),
        advanceTask: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireAllowedApp("canva");
      const employeeId = requireEmployeeId(ctx.employeeId);
      const title =
        input.title?.trim() || `Canva · ${input.designId.slice(0, 40)}`;

      let bytes: Uint8Array;
      let contentType = "image/png";
      let mode: "live" | "stub" = "stub";
      let exportMeta: {
        designId: string;
        exportId?: string;
        downloadUrl?: string;
      } = { designId: input.designId };

      const stubPngBytes = () =>
        new Uint8Array(
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
            "base64",
          ),
        );

      if (process.env.COMPOSIO_API_KEY?.trim()) {
        try {
          const client = requireSystemComposio();
          const accounts = await client.listUserConnectedAccounts(employeeId);
          const account = accounts.find(
            (candidate) =>
              candidate.toolkit.slug.toLowerCase() === "canva" &&
              !candidate.is_disabled &&
              ACTIVE_COMPOSIO_STATUSES.has(candidate.status.toUpperCase()),
          );
          if (account && !input.designId.startsWith("stub-")) {
            const { exportCanvaDesign } = await import("@hrmny/integrations");
            const exported = await exportCanvaDesign({
              client,
              connectedAccountId: account.id,
              designId: input.designId,
              format: "png",
            });
            const res = await fetch(exported.downloadUrl);
            if (!res.ok) {
              throw new Error(
                `Canva download failed (${res.status}) for export ${exported.exportId}`,
              );
            }
            bytes = new Uint8Array(await res.arrayBuffer());
            contentType =
              res.headers.get("content-type")?.split(";")[0]?.trim() ||
              "image/png";
            mode = "live";
            exportMeta = {
              designId: exported.designId,
              exportId: exported.exportId,
              downloadUrl: exported.downloadUrl,
            };
          } else {
            // No Canva account (or explicit stub design id) — 1×1 PNG stub.
            bytes = stubPngBytes();
            exportMeta = {
              designId: input.designId,
              exportId: "stub-export",
            };
            mode = "stub";
          }
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "BAD_GATEWAY",
            message:
              err instanceof Error
                ? `Canva attach failed: ${err.message}`
                : "Canva attach failed",
          });
        }
      } else {
        // 1×1 PNG stub when Composio is not configured (unit / memory demos).
        bytes = stubPngBytes();
        exportMeta = { designId: input.designId, exportId: "stub-export" };
      }

      const ext =
        contentType.includes("jpeg") || contentType.includes("jpg")
          ? "jpg"
          : "png";

      const db = getDb();
      if (!db) {
        const store = getDemoStore();
        let taskId: string | null = null;
        if (input.advanceTask !== false) {
          const task = [...store.tasks.values()].find(
            (t) =>
              t.clientId === input.clientId && t.taskType === "social_cutdowns",
          );
          if (task) {
            task.status = "client_review";
            taskId = task.taskId;
          }
        }
        const asset = store.createAsset(title, input.clientId, taskId);
        asset.status = "client_review";
        const storagePath = `dam/${asset.assetId}/v1-canva.${ext}`;
        const { getObjectStore } = await import("../storage/object-store");
        await getObjectStore().put({
          path: storagePath,
          body: bytes,
          contentType,
        });
        asset.versions.push({
          assetVersionId: randomUUID(),
          assetId: asset.assetId,
          storagePath,
          versionNumber: 1,
          isClientRevision: false,
          uploadedByEmployeeId: employeeId,
          createdAt: new Date().toISOString(),
        });
        store.appendAudit({
          actorEmployeeId: employeeId,
          action: "connections.canvaAttachToPortal",
          entityType: "asset",
          entityId: asset.assetId,
          before: null,
          after: { ...exportMeta, mode, clientId: input.clientId },
          reason: null,
        });
        if (taskId) {
          store.portalApprovals.set(taskId, {
            approvalId: taskId,
            clientId: input.clientId,
            title,
            kind: "asset",
            status: "pending",
            entityId: asset.assetId,
            slaHours: 48,
            createdAt: new Date().toISOString(),
          });
        }
        return {
          ok: true as const,
          assetId: asset.assetId,
          taskId,
          clientId: input.clientId,
          portalHref: await (
            await import("../auth/portal-review-href")
          ).portalReviewHref(input.clientId),
          mode,
        };
      }

      let taskId: string | null = null;
      if (input.advanceTask !== false) {
        const {
          seedClientCreativeTask,
          updateDeliveryTaskStatus,
        } = await import("../tasks/delivery-tasks");
        const seeded = await seedClientCreativeTask({
          clientId: input.clientId,
          title: `Portal Canva — ${title.slice(0, 80)}`,
          status: "qc",
        });
        if (seeded) {
          await updateDeliveryTaskStatus({
            taskId: seeded.taskId,
            status: "client_review",
            qcPassed: true,
            qcNotes: "Auto-QC for Canva design sent to portal",
          });
          taskId = seeded.taskId;
        }
      }

      const assets = await db.execute<{ assetId: string }>(sql`
        insert into public.asset (title, client_id, status, task_id)
        values (
          ${title},
          ${input.clientId}::uuid,
          'client_review',
          ${taskId}::uuid
        )
        returning asset_id as "assetId"
      `);
      const assetId = assets[0]!.assetId;
      const storagePath = `dam/${assetId}/v1-canva.${ext}`;
      const { getObjectStore } = await import("../storage/object-store");
      await getObjectStore().put({
        path: storagePath,
        body: bytes,
        contentType,
      });
      await db.execute(sql`
        insert into public.asset_version (
          asset_id, storage_path, version_number, is_client_revision,
          uploaded_by_employee_id
        ) values (
          ${assetId}::uuid,
          ${storagePath},
          1,
          false,
          ${employeeId}::uuid
        )
      `);

      const { writeAudit } = await import("../m1-persistence");
      await writeAudit({
        actorEmployeeId: employeeId,
        action: "connections.canvaAttachToPortal",
        entityType: "asset",
        entityId: assetId,
        before: null,
        after: { ...exportMeta, mode, clientId: input.clientId },
        reason: null,
      });

      return {
        ok: true as const,
        assetId,
        taskId,
        clientId: input.clientId,
        portalHref: await (
          await import("../auth/portal-review-href")
        ).portalReviewHref(input.clientId),
        mode,
      };
    }),
});

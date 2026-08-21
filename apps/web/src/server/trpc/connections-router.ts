import { TRPCError } from "@trpc/server";
import { and, auditEvent, connectionAccount, eq, sql } from "@hrmny/db";
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

const composio = createComposioStub();
const apiKeyToolkit = z.enum(["apollo", "hunter", "bayzat"]);
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
    ready: false,
    note: "Needs Canva OAuth app or Composio access.",
  },
  {
    toolkit: "linkedin",
    label: "LinkedIn",
    authType: "manual",
    ready: false,
    note: "Copy-draft only in V1 to protect the account.",
  },
  {
    toolkit: "xero",
    label: "Xero",
    authType: "oauth",
    ready: true,
    note: "Read/mirror only — OS never writes unless XERO_WRITE_ENABLED=true.",
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
  toolkit: "apollo" | "hunter" | "bayzat",
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
  const [row] = await db
    .select({
      connectionAccountId: connectionAccount.connectionAccountId,
      secretId: connectionAccount.secretId,
    })
    .from(connectionAccount)
    .where(
      and(
        eq(connectionAccount.ownerEmployeeId, employeeId),
        eq(connectionAccount.toolkit, "google_workspace"),
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
  if (typeof decrypted !== "string") {
    throw new Error("Google Workspace connection secret is unavailable");
  }
  const stored = GoogleWorkspaceSecretSchema.parse(JSON.parse(decrypted));
  if (Date.parse(stored.expiresAt) > Date.now() + 60_000) {
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
    await db
      .update(connectionAccount)
      .set({
        status: "error",
        lastError: `Google token refresh failed (${response.status})`,
        updatedAt: new Date(),
      })
      .where(
        eq(connectionAccount.connectionAccountId, row.connectionAccountId),
      );
    throw new Error(`Google token refresh failed (${response.status})`);
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
        const row = rows.find(
          (candidate) => candidate.toolkit === item.toolkit,
        );
        return {
          ...item,
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
          after: { toolkit: input.toolkit, status: "connected" },
        });
        return saved!;
      });

      return {
        connectionAccountId: row.connectionAccountId,
        toolkit: row.toolkit,
        status: row.status,
        hasSecret: true,
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
    const [remote, local] = await Promise.all([
      requireSystemComposio().listUserConnectedAccounts(employeeId),
      db
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
        ),
    ]);
    return local.map((account) => {
      const current = remote.find(
        (candidate) => candidate.id === account.externalConnectionId,
      );
      return {
        connectionAccountId: account.connectionAccountId,
        connectedAccountId: account.externalConnectionId,
        toolkit: account.toolkit.slice("composio:".length),
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
      const [existing] = await db
        .select({ id: connectionAccount.connectionAccountId })
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.ownerEmployeeId, employeeId),
            eq(connectionAccount.scope, "staff"),
            eq(connectionAccount.toolkit, toolkitKey),
          ),
        )
        .limit(1);
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This toolkit is already connected or awaiting authorization",
        });
      }

      const request = await client.authorize(employeeId, input.toolkit);
      try {
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

  startOAuth: staffProcedure
    .input(
      z.object({
        toolkit: oauthToolkit,
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await requireAllowedApp(input.toolkit);
      const redirectUri =
        input.redirectUri ??
        `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/settings/connections/callback`;
      const result = await composio.startOAuth(input.toolkit, redirectUri);
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
          actorEmployeeId: requireEmployeeId(ctx.employeeId),
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

  disconnect: staffProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      const db = getDb();
      if (!db) {
        await composio.disconnect(input.id);
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
      return composio.status(input.toolkit, requireEmployeeId(ctx.employeeId));
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
    const store = getDemoStore();
    const canva = store.connections.find(
      (row) => row.toolkit === "canva" && row.status === "connected",
    );
    if (!canva) {
      return {
        ok: false as const,
        reason: "Canva not connected — use Connections → Connect canva",
        designs: [] as { id: string; title: string }[],
      };
    }
    store.appendAudit({
      actorEmployeeId: requireEmployeeId(ctx.employeeId),
      action: "connections.canvaListDesigns",
      entityType: "connection_account",
      entityId: canva.connectionAccountId,
      before: null,
      after: { smoke: true },
      reason: null,
    });
    return {
      ok: true as const,
      designs: [
        { id: "stub-design-1", title: "Brand kit cover (Canva stub)" },
        { id: "stub-design-2", title: "Social template pack (Canva stub)" },
      ],
    };
  }),
});

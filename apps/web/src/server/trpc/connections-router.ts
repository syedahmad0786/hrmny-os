import { TRPCError } from "@trpc/server";
import { and, auditEvent, connectionAccount, eq, sql } from "@hrmny/db";
import {
  createAsanaViaComposio,
  createComposioLive,
  createComposioStub,
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

const composio = createComposioStub();
const apiKeyToolkit = z.enum(["apollo", "hunter", "bayzat"]);
const oauthToolkit = z.enum([
  "gmail",
  "calendar",
  "canva",
  "linkedin",
]);

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
] as const;

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
      const toolkits = (await requireSystemComposio().listManagedToolkits()).filter(
        (toolkit) =>
          !search ||
          toolkit.name.toLowerCase().includes(search) ||
          toolkit.slug.toLowerCase().includes(search) ||
          toolkit.description?.toLowerCase().includes(search),
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
        toolkit: z.string().trim().min(1).max(120).regex(/^[a-z0-9_-]+$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      await requireAllowedApp("composio");
      await requireAllowedApp(input.toolkit);
      const client = requireSystemComposio();
      const toolkits = await client.listManagedToolkits();
      if (!toolkits.some((toolkit) => toolkit.slug === input.toolkit)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This toolkit does not support Composio-managed authorization",
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
          message: "This toolkit is already connected or awaiting authorization",
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
      await requireSystemComposio().disconnect(existing.externalConnectionId);
      await db.transaction(async (tx) => {
        await tx
          .delete(connectionAccount)
          .where(eq(connectionAccount.connectionAccountId, existing.connectionAccountId));
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

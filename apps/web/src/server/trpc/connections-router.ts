import { TRPCError } from "@trpc/server";
import { and, auditEvent, connectionAccount, eq, sql } from "@hrmny/db";
import { createComposioStub } from "@hrmny/integrations";
import { z } from "zod";
import { getDb } from "../db";
import { getDemoStore } from "../demo-store";
import { router, staffProcedure } from "./trpc";
import { randomUUID } from "node:crypto";

const composio = createComposioStub();
const apiKeyToolkit = z.enum(["apollo", "hunter", "bayzat"]);
const oauthToolkit = z.enum(["gmail", "calendar", "canva", "linkedin"]);

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
    toolkit: "gmail",
    label: "Gmail",
    authType: "oauth",
    ready: false,
    note: "Needs one-time Google/Composio provider registration.",
  },
  {
    toolkit: "calendar",
    label: "Google Calendar",
    authType: "oauth",
    ready: false,
    note: "Needs one-time Google/Composio provider registration.",
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

export async function getEmployeeIntegrationSecret(
  employeeId: string,
  toolkit: "apollo" | "hunter" | "bayzat",
): Promise<string | null> {
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

export const connectionsRouter = router({
  list: staffProcedure
    .input(
      z.object({ scope: z.enum(["staff", "portal"]).optional() }).optional(),
    )
    .query(async ({ ctx }) => {
      const employeeId = requireEmployeeId(ctx.employeeId);
      const db = getDb();
      if (!db) {
        const existing = getDemoStore().connections;
        return CONNECTION_CATALOG.map((item) => {
          const row = existing.find(
            (candidate) => candidate.toolkit === item.toolkit,
          );
          return {
            ...item,
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
          connectionAccountId: row?.connectionAccountId ?? null,
          scope: "staff" as const,
          status: row?.status ?? "disconnected",
          externalConnectionId: null as string | null,
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

  startOAuth: staffProcedure
    .input(
      z.object({
        toolkit: oauthToolkit,
        redirectUri: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
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
    .query(({ input, ctx }) =>
      composio.status(input.toolkit, requireEmployeeId(ctx.employeeId)),
    ),

  /** Local/demo OAuth callback. Production callbacks must exchange real provider tokens. */
  completeOAuth: staffProcedure
    .input(z.object({ toolkit: oauthToolkit }))
    .mutation(({ input, ctx }) => {
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

  canvaListDesigns: staffProcedure.query(({ ctx }) => {
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

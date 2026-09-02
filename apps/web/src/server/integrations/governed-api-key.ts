import {
  and,
  auditEvent,
  connectionAccount,
  eq,
  sql,
  type Db,
} from "@hrmny/db";
import type { ApiKeyToolkit } from "./resolve-keys";
import {
  APOLLO_PROVIDER_CONCURRENCY_KEY,
  ApolloProviderMutationBusyError,
  ProviderCredentialMutationBusyError,
} from "./apollo-provider-slot";

export type GovernedApiKeyInput = {
  database: Db;
  employeeId: string;
  toolkit: ApiKeyToolkit;
  apiKey: string;
  probed: boolean;
  /** PostgreSQL rollback proof hook after Vault and connection writes. */
  afterConnectionWrite?: (backendPid: number) => Promise<void>;
};

function isPostgresLockTimeout(error: unknown): boolean {
  const visited = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    if ((current as { code?: unknown }).code === "55P03") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function unsettledApolloProviderDispatchQuery() {
  return sql`
    select exists (
      select 1
      from public.scheduled_job job
      join public.integration_inbox inbox
        on inbox.integration_inbox_id = job.integration_inbox_id
      where job.status = 'running'
        and job.concurrency_key = ${APOLLO_PROVIDER_CONCURRENCY_KEY}
        and (
          inbox.result ->> 'providerDispatchState'
            in ('authorized', 'ambiguous')
          or inbox.result ->> 'providerOutcomeAmbiguous' = 'true'
          or inbox.result ->> 'providerMaySettle' = 'true'
          or (
            inbox.status = 'processing'
            and inbox.result ->> 'bridgeStatus' = 'processing'
            and (
              job.lease_expires_at is null
              or inbox.attempt_lease_expires_at is null
            )
          )
        )
    ) as active
  `;
}

/**
 * Persist a provider key, its connected state, and its audit receipt as one
 * transaction. Apollo additionally owns the same provider advisory lane used
 * by queued discovery, so a supported rotation cannot cross a healthy provider
 * call. A running dispatch that is durably authorized, ambiguous, or missing
 * a required processing lease also keeps the lane closed after provider-lock
 * backend loss until worker recovery makes the outcome terminal or retryable.
 */
export async function persistGovernedApiKeyConnection(
  input: GovernedApiKeyInput,
) {
  try {
    return await input.database.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(
        sql`set local idle_in_transaction_session_timeout = '30s'`,
      );

      let providerBackendPid: number | null = null;
      if (input.toolkit === "apollo") {
        const [providerLock] = await tx.execute<{
          acquired: boolean;
          backend_pid: number;
        }>(sql`
          select pg_try_advisory_xact_lock(
                   hashtextextended(${APOLLO_PROVIDER_CONCURRENCY_KEY}, 0)
                 ) as acquired,
                 pg_backend_pid()::int as backend_pid
        `);
        if (providerLock?.acquired !== true) {
          throw new ApolloProviderMutationBusyError();
        }
        const [unsettledProviderDispatch] = await tx.execute<{
          active: boolean;
        }>(unsettledApolloProviderDispatchQuery());
        if (unsettledProviderDispatch?.active === true) {
          throw new ApolloProviderMutationBusyError();
        }
        providerBackendPid = Number(providerLock.backend_pid);
      }

      const [existing] = await tx
        .select()
        .from(connectionAccount)
        .where(
          and(
            eq(connectionAccount.ownerEmployeeId, input.employeeId),
            eq(connectionAccount.toolkit, input.toolkit),
            eq(connectionAccount.scope, "staff"),
          ),
        )
        .limit(1)
        .for("update");

      let secretId = existing?.secretId ?? null;
      if (secretId) {
        await tx.execute(
          sql`select vault.update_secret(${secretId}::uuid, ${input.apiKey})`,
        );
        const [persistedSecret] = await tx.execute<{ exists: boolean }>(sql`
          select exists (
            select 1
            from vault.decrypted_secrets
            where id = ${secretId}::uuid
          ) as exists
        `);
        if (persistedSecret?.exists !== true) {
          throw new Error("Vault secret was not found during key replacement");
        }
      } else {
        const created = await tx.execute(
          sql<{ id: string }>`
            select vault.create_secret(
              ${input.apiKey},
              ${`hrmny:${input.employeeId}:${input.toolkit}`},
              ${`${input.toolkit} API key managed by hrmny OS`}
            ) as id
          `,
        );
        const createdId = created[0]?.id;
        secretId = typeof createdId === "string" ? createdId : null;
      }
      if (!secretId) throw new Error("Vault did not return a secret id");

      const values = {
        ownerEmployeeId: input.employeeId,
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
      if (!saved) throw new Error("Connection account was not persisted");
      if (providerBackendPid !== null) {
        await input.afterConnectionWrite?.(providerBackendPid);
      }

      await tx.insert(auditEvent).values({
        actorEmployeeId: input.employeeId,
        action: existing ? "connections.replaceKey" : "connections.connectKey",
        entityType: "connection_account",
        entityId: saved.connectionAccountId,
        before: existing ? { status: existing.status } : null,
        after: {
          toolkit: input.toolkit,
          status: "connected",
          probed: input.probed,
        },
      });
      return saved;
    });
  } catch (error) {
    if (isPostgresLockTimeout(error)) {
      if (input.toolkit === "apollo") {
        throw new ApolloProviderMutationBusyError();
      }
      throw new ProviderCredentialMutationBusyError(input.toolkit);
    }
    throw error;
  }
}

export async function disconnectGovernedApiKeyConnection(input: {
  database: Db;
  employeeId: string;
  connectionAccountId: string;
  expectedToolkit: string;
  /** PostgreSQL rollback proof hook after the Vault credential is tombstoned. */
  afterSecretTombstone?: (backendPid: number) => Promise<void>;
}) {
  try {
    return await input.database.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      await tx.execute(
        sql`set local idle_in_transaction_session_timeout = '30s'`,
      );

      let providerBackendPid: number | null = null;
      if (input.expectedToolkit === "apollo") {
        const [providerLock] = await tx.execute<{
          acquired: boolean;
          backend_pid: number;
        }>(sql`
        select pg_try_advisory_xact_lock(
          hashtextextended(${APOLLO_PROVIDER_CONCURRENCY_KEY}, 0)
        ) as acquired,
        pg_backend_pid()::int as backend_pid
      `);
        if (providerLock?.acquired !== true) {
          throw new ApolloProviderMutationBusyError();
        }
        const [unsettledProviderDispatch] = await tx.execute<{
          active: boolean;
        }>(unsettledApolloProviderDispatchQuery());
        if (unsettledProviderDispatch?.active === true) {
          throw new ApolloProviderMutationBusyError();
        }
        providerBackendPid = Number(providerLock.backend_pid);
      }

      const [existing] = await tx
        .select()
        .from(connectionAccount)
        .where(
          and(
            eq(
              connectionAccount.connectionAccountId,
              input.connectionAccountId,
            ),
            eq(connectionAccount.ownerEmployeeId, input.employeeId),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing) return null;
      if (existing.toolkit !== input.expectedToolkit) {
        throw new Error("Connection toolkit changed during disconnect");
      }

      if (existing.secretId) {
        await tx.execute(sql`
        select vault.update_secret(
          ${existing.secretId}::uuid,
          gen_random_uuid()::text || gen_random_uuid()::text,
          ${`hrmny:revoked:${existing.secretId}`},
          'Revoked by HRMNY connection disconnect'
        )
      `);
        if (providerBackendPid !== null) {
          await input.afterSecretTombstone?.(providerBackendPid);
        }
      }
      const deleted = await tx
        .delete(connectionAccount)
        .where(
          eq(
            connectionAccount.connectionAccountId,
            existing.connectionAccountId,
          ),
        )
        .returning({ id: connectionAccount.connectionAccountId });
      if (deleted.length !== 1) {
        throw new Error("Connection account was not deleted during disconnect");
      }

      await tx.insert(auditEvent).values({
        actorEmployeeId: input.employeeId,
        action: "connections.disconnect",
        entityType: "connection_account",
        entityId: existing.connectionAccountId,
        before: { toolkit: existing.toolkit, status: existing.status },
        after: { status: "disconnected" },
      });
      return existing;
    });
  } catch (error) {
    if (isPostgresLockTimeout(error)) {
      if (input.expectedToolkit === "apollo") {
        throw new ApolloProviderMutationBusyError();
      }
      throw new ProviderCredentialMutationBusyError(input.expectedToolkit);
    }
    throw error;
  }
}

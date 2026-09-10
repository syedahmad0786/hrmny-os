import { randomUUID } from "node:crypto";
import { sql, employee } from "@hrmny/db";
import { expect, it, vi } from "vitest";
import { getDb } from "../db";
import {
  GoogleWorkspaceSecretSchema,
  persistGoogleWorkspaceTokens,
} from "../google-workspace-oauth";
import { disconnectGovernedApiKeyConnection } from "../integrations/governed-api-key";
import { getOwnedGoogleWorkspaceCredentials } from "../trpc/connections-router";
import { createCaller } from "../trpc/root";
import { resolveDevUser } from "../auth/session";
import { mutateSalesOsSettings, recordEmailEvent } from "../sales-os/store";
import { recordIntegrationReceipt } from "../integrations/inbox";
import { patchOutreach, withOutreachDecision } from "./store";

it("serializes outreach decisions and preserves reviewed content after an uncertain send", async () => {
  const db = getDb()!;
  const outreachId = randomUUID();
  const receiptEventId = `outreach-send:${outreachId}`;
  let releaseLock!: () => void;
  let enteredLock!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enteredLock = resolve;
  });

  try {
    await db.execute(sql`
      insert into public.outreach_items
        (outreach_item_id, channel, state, recipient, subject, body)
      values
        (${outreachId}::uuid, 'gmail', 'approved', 'buyer@example.test',
         'Reviewed subject', 'Reviewed body')
    `);

    const holder = withOutreachDecision(outreachId, async () => {
      enteredLock();
      await release;
    });
    await entered;
    await expect(
      withOutreachDecision(outreachId, async () => undefined),
    ).rejects.toThrow("action in progress");
    releaseLock();
    await holder;

    await db.execute(sql`
      update public.outreach_items
      set body = 'Edited after approval'
      where outreach_item_id = ${outreachId}::uuid
    `);
    const [invalidated] = await db.execute<{
      state: string;
      approved_by: string | null;
    }>(sql`
      select state, approved_by
      from public.outreach_items
      where outreach_item_id = ${outreachId}::uuid
    `);
    expect(invalidated).toMatchObject({ state: "draft", approved_by: null });

    await db.execute(sql`
      update public.outreach_items
      set state = 'approved'
      where outreach_item_id = ${outreachId}::uuid
    `);
    await recordIntegrationReceipt({
      provider: "gmail",
      externalEventId: receiptEventId,
      operation: "messages.send",
      rawBody: JSON.stringify({ outreachItemId: outreachId }),
      status: "processing",
      payload: { outreachItemId: outreachId },
      result: { bridgeStatus: "reconcile_required" },
    });
    await expect(
      patchOutreach(outreachId, { body: "Replacement body" }),
    ).rejects.toThrow("awaiting reconciliation");
    const [preserved] = await db.execute<{ state: string; body: string }>(sql`
      select state, body
      from public.outreach_items
      where outreach_item_id = ${outreachId}::uuid
    `);
    expect(preserved).toMatchObject({
      state: "approved",
      body: "Edited after approval",
    });
  } finally {
    releaseLock?.();
    await db.execute(sql`
      delete from public.integration_inbox
      where provider = 'gmail' and external_event_id = ${receiptEventId}
    `);
    await db.execute(sql`
      delete from public.outreach_items
      where outreach_item_id = ${outreachId}::uuid
    `);
  }
});

it("retains multiple domains, reconnects exactly one mailbox, and denies another employee's private mail", async () => {
  const db = getDb()!;
  const employeeId = randomUUID();
  await db.insert(employee).values({
    employeeId,
    email: `${employeeId}@example.test`,
    displayName: "CI mailbox owner",
  });
  const base = {
    employeeId,
    accessToken: "test-access-token-not-real-12345",
    refreshToken: "test-refresh-token-not-real-12345",
  };
  const first = await persistGoogleWorkspaceTokens({
    ...base,
    email: "first@domain-one.test",
    grantedScopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  });
  const readStoredScopes = async (connectionAccountId: string) => {
    const [secret] = await db.execute<{ decrypted_secret: string }>(sql`
      select vault.decrypted_secrets.decrypted_secret
      from public.connection_account
      join vault.decrypted_secrets
        on vault.decrypted_secrets.id = public.connection_account.secret_id
      where public.connection_account.connection_account_id = ${connectionAccountId}::uuid
      limit 1
    `);
    return GoogleWorkspaceSecretSchema.parse(
      JSON.parse(secret!.decrypted_secret),
    ).grantedScopes;
  };
  expect(await readStoredScopes(first.connectionAccountId)).toEqual([
    "https://www.googleapis.com/auth/gmail.readonly",
  ]);
  await persistGoogleWorkspaceTokens({
    ...base,
    email: "first@domain-one.test",
  });
  expect(await readStoredScopes(first.connectionAccountId)).toEqual([]);
  const second = await persistGoogleWorkspaceTokens({
    ...base,
    email: "second@domain-two.test",
  });
  expect(second.connectionAccountId).not.toBe(first.connectionAccountId);
  const replay = await Promise.all(
    [1, 2].map(() =>
      persistGoogleWorkspaceTokens({
        ...base,
        email: "second@domain-two.test",
      }),
    ),
  );
  expect(replay.map((item) => item.connectionAccountId)).toEqual([
    second.connectionAccountId,
    second.connectionAccountId,
  ]);
  await expect(
    persistGoogleWorkspaceTokens({
      employeeId,
      accessToken: base.accessToken,
      email: "third@domain-three.test",
    }),
  ).rejects.toThrow("refresh token");
  await db.execute(
    sql`update public.connection_account set external_connection_id = ' FIRST@DOMAIN-ONE.TEST ' where connection_account_id = ${first.connectionAccountId}::uuid`,
  );
  expect(
    (
      await persistGoogleWorkspaceTokens({
        employeeId,
        accessToken: base.accessToken,
        email: "first@domain-one.test",
      })
    ).connectionAccountId,
  ).toBe(first.connectionAccountId);
  const [row] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from public.connection_account where owner_employee_id = ${employeeId}::uuid and toolkit = 'google_workspace'`,
  );
  expect(row?.count).toBe(2);
  const user = { ...resolveDevUser("partner"), employeeId: randomUUID() };
  const caller = createCaller({
    user,
    employeeId: user.employeeId,
    roles: user.roles,
    canViewMargin: true,
  });
  expect(await caller.connections.myMailboxes()).toEqual([]);
  await expect(
    caller.connections.mailboxPage({
      connectionAccountId: first.connectionAccountId,
      folder: "INBOX",
    }),
  ).rejects.toThrow("Only the mailbox owner");
  await expect(
    caller.connections.mailboxPage({
      connectionAccountId: first.connectionAccountId,
      folder: "SENT",
    }),
  ).rejects.toThrow("Only the mailbox owner");
  await expect(
    caller.connections.mailboxMessage({
      connectionAccountId: first.connectionAccountId,
      id: "private-message",
    }),
  ).rejects.toThrow("Only the mailbox owner");

  await mutateSalesOsSettings((settings) => ({
    settings: {
      ...settings,
      outreach: {
        ...settings.outreach,
        senderMailboxes: [
          ...(settings.outreach.senderMailboxes ?? []),
          {
            connectionAccountId: first.connectionAccountId,
            label: "Approved private sender",
            dailyCap: 10,
            enabled: true,
          },
        ],
      },
    },
    result: null,
  }));
  const ownUser = { ...user, employeeId };
  const ownCaller = createCaller({
    user: ownUser,
    employeeId,
    roles: ownUser.roles,
    canViewMargin: true,
  });
  expect(
    (await ownCaller.connections.salesMailboxes()).items.map(
      (item) => item.connectionAccountId,
    ),
  ).toContain(first.connectionAccountId);
  expect(
    (await caller.connections.salesMailboxes()).items.map(
      (item) => item.connectionAccountId,
    ),
  ).not.toContain(first.connectionAccountId);
  await expect(
    caller.connections.gmailIdentities({
      connectionAccountId: first.connectionAccountId,
    }),
  ).rejects.toThrow();

  // A legacy event with no employee field still belongs to its proven mailbox owner.
  const privateBody = `private-db-message-${randomUUID()}`;
  await recordEmailEvent({
    provider: "gmail",
    kind: "replied",
    payload: {
      senderConnectionAccountId: first.connectionAccountId,
      body: privateBody,
    },
  });
  expect(
    JSON.stringify(await ownCaller.leadgen.outreach.conversations()),
  ).toContain(privateBody);
  expect(
    JSON.stringify(await caller.leadgen.outreach.conversations()),
  ).not.toContain(privateBody);
});

it("returns only an exact owned Google credential and cannot commit a stale refresh over replacement or disconnect", async () => {
  const db = getDb()!;
  const employeeId = randomUUID();
  const otherEmployeeId = randomUUID();
  await db.insert(employee).values([
    { employeeId, email: `${employeeId}@example.test`, displayName: "Refresh owner" },
    { employeeId: otherEmployeeId, email: `${otherEmployeeId}@example.test`, displayName: "Other owner" },
  ]);
  const email = `refresh-${randomUUID()}@example.test`;
  const initial = await persistGoogleWorkspaceTokens({
    employeeId,
    email,
    accessToken: "expired-access-token-not-real-12345",
    refreshToken: "refresh-token-not-real-123456789",
    expiresAt: new Date(0),
    grantedScopes: ["scope.initial"],
  });
  await expect(
    getOwnedGoogleWorkspaceCredentials(otherEmployeeId, initial.connectionAccountId),
  ).resolves.toBeNull();

  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "test-client.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "test-secret");
  let releaseFetch!: (response: Response) => void;
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => (fetchStarted = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      fetchStarted();
      return new Promise<Response>((resolve) => (releaseFetch = resolve));
    }),
  );
  const staleRefresh = getOwnedGoogleWorkspaceCredentials(
    employeeId,
    initial.connectionAccountId,
  );
  await started;
  await persistGoogleWorkspaceTokens({
    employeeId,
    email,
    accessToken: "replacement-access-token-not-real-12345",
    refreshToken: "replacement-refresh-token-not-real-12345",
    grantedScopes: ["scope.replacement"],
  });
  releaseFetch(
    Response.json({
      access_token: "stale-refreshed-access-token-not-real",
      expires_in: 3600,
      scope: "scope.stale",
    }),
  );
  await expect(staleRefresh).resolves.toBeNull();
  await expect(
    getOwnedGoogleWorkspaceCredentials(employeeId, initial.connectionAccountId),
  ).resolves.toMatchObject({
    accessToken: "replacement-access-token-not-real-12345",
    grantedScopes: ["scope.replacement"],
    accountEmail: email,
    connectionAccountId: initial.connectionAccountId,
  });

  const disconnectedDuringRefresh = await persistGoogleWorkspaceTokens({
    employeeId,
    email: `disconnect-${randomUUID()}@example.test`,
    accessToken: "expired-disconnect-token-not-real-12345",
    refreshToken: "disconnect-refresh-token-not-real-12345",
    expiresAt: new Date(0),
  });
  let releaseDisconnectFetch!: (response: Response) => void;
  let disconnectFetchStarted!: () => void;
  const disconnectStarted = new Promise<void>(
    (resolve) => (disconnectFetchStarted = resolve),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      disconnectFetchStarted();
      return new Promise<Response>(
        (resolve) => (releaseDisconnectFetch = resolve),
      );
    }),
  );
  const disconnectedRefresh = getOwnedGoogleWorkspaceCredentials(
    employeeId,
    disconnectedDuringRefresh.connectionAccountId,
  );
  await disconnectStarted;
  await disconnectGovernedApiKeyConnection({
    database: db,
    employeeId,
    connectionAccountId: disconnectedDuringRefresh.connectionAccountId,
    expectedToolkit: "google_workspace",
  });
  releaseDisconnectFetch(
    Response.json({
      access_token: "stale-after-disconnect-token-not-real",
      expires_in: 3600,
    }),
  );
  await expect(disconnectedRefresh).resolves.toBeNull();
  await expect(
    getOwnedGoogleWorkspaceCredentials(
      employeeId,
      disconnectedDuringRefresh.connectionAccountId,
    ),
  ).resolves.toBeNull();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

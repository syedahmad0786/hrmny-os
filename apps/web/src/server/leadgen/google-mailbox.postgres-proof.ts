import { randomUUID } from "node:crypto";
import { sql, employee } from "@hrmny/db";
import { expect, it } from "vitest";
import { getDb } from "../db";
import { persistGoogleWorkspaceTokens } from "../google-workspace-oauth";
import { createCaller } from "../trpc/root";
import { resolveDevUser } from "../auth/session";

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
  });
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
});

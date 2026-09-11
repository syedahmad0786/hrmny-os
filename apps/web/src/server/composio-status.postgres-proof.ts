import { randomUUID } from "node:crypto";
import { connectionAccount, employee, eq } from "@hrmny/db";
import { expect, it } from "vitest";
import { getDb } from "./db";
import { reconcileComposioManagedStatus } from "./trpc/connections-router";

it("corrects a mismatched live toolkit, recovers a real connection, and preserves other owners and pending OAuth", async () => {
  const db = getDb()!;
  const owner = randomUUID(),
    other = randomUUID();
  await db.insert(employee).values(
    [owner, other].map((employeeId) => ({
      employeeId,
      email: `${employeeId}@example.test`,
      displayName: "CI Composio owner",
    })),
  );
  const [wrong, pending, privateOther, correct] = await db
    .insert(connectionAccount)
    .values([
      {
        ownerEmployeeId: owner,
        toolkit: "composio:canva",
        scope: "staff",
        status: "connected",
        externalConnectionId: "synthetic-gmail",
      },
      {
        ownerEmployeeId: owner,
        toolkit: "composio:jira",
        scope: "staff",
        status: "pending",
        externalConnectionId: "synthetic-pending",
      },
      {
        ownerEmployeeId: other,
        toolkit: "composio:canva",
        scope: "staff",
        status: "connected",
        externalConnectionId: "synthetic-other",
      },
      {
        ownerEmployeeId: owner,
        toolkit: "composio:canva",
        scope: "staff",
        status: "pending",
        externalConnectionId: "synthetic-canva",
      },
    ])
    .returning();
  const read = async (id: string) =>
    (
      await db
        .select()
        .from(connectionAccount)
        .where(eq(connectionAccount.connectionAccountId, id))
    )[0]!;
  const gmail = {
    id: "synthetic-gmail",
    status: "ACTIVE",
    toolkit: { slug: "gmail" },
    user_id: owner,
  };
  await reconcileComposioManagedStatus(db, owner, [gmail]);
  expect(await read(wrong!.connectionAccountId)).toMatchObject({
    status: "error",
    externalConnectionId: gmail.id,
    lastError: "COMPOSIO_ACCOUNT_NOT_ACTIVE_FOR_TOOLKIT",
  });
  expect(await read(pending!.connectionAccountId)).toMatchObject({
    status: "pending",
    externalConnectionId: "synthetic-pending",
  });
  expect(await read(privateOther!.connectionAccountId)).toMatchObject({
    status: "connected",
    externalConnectionId: "synthetic-other",
  });

  const canva = {
    id: "synthetic-canva",
    status: "ACTIVE",
    toolkit: { slug: "canva" },
    user_id: owner,
  };
  await reconcileComposioManagedStatus(db, owner, [gmail, canva]);
  expect(await read(wrong!.connectionAccountId)).toMatchObject({
    status: "error",
    externalConnectionId: gmail.id,
    lastError: "COMPOSIO_ACCOUNT_NOT_ACTIVE_FOR_TOOLKIT",
  });
  expect(await read(correct!.connectionAccountId)).toMatchObject({
    status: "connected",
    externalConnectionId: canva.id,
    lastError: null,
  });
  await reconcileComposioManagedStatus(db, owner, [
    { ...canva, is_disabled: true },
  ]);
  expect(await read(correct!.connectionAccountId)).toMatchObject({
    status: "error",
    externalConnectionId: canva.id,
  });
});

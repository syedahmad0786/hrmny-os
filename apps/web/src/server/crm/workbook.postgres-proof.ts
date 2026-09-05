import { randomUUID } from "node:crypto";
import { employee, sql } from "@hrmny/db";
import { expect, it } from "vitest";
import { getDb } from "../db";
import {
  importAsanaRoster,
  clientSourceProjects,
} from "../clients/asana-roster";
import {
  editWorkbook,
  saveWorkbookView,
  savedWorkbookViews,
  workbookSnapshot,
} from "./workbook";
import { defaultWorkbookConfig } from "@/lib/crm-workbook";

it("persists a replay-safe roster, exact ownership and private views without dating legacy sales", async () => {
  const db = getDb()!;
  const owner = randomUUID(),
    other = randomUUID();
  await db
    .insert(employee)
    .values(
      [owner, other].map((id) => ({
        employeeId: id,
        displayName: `CI workbook ${id}`,
        email: `${id}@example.test`,
      })),
    );
  const name = `CI roster ${randomUUID()}`;
  const rows = [1, 2].map((n) => ({
    clientName: name,
    projectName: `CI project ${n}`,
    projectId: `${Date.now()}${n}`,
    workspaceId: "1148006162435561",
    observedAt: "2026-01-01T00:00:00Z",
  }));
  expect(await importAsanaRoster(owner, { rows })).toEqual({
    created: 1,
    linked: 2,
    skipped: 0,
  });
  expect(await importAsanaRoster(owner, { rows })).toEqual({
    created: 0,
    linked: 0,
    skipped: 2,
  });
  const client = (await workbookSnapshot()).rows.find(
    (r) => r.kind === "clients" && r.name === name,
  )!;
  expect(await clientSourceProjects(client.id)).toHaveLength(2);
  const [deal] = await db.execute<{
    closed: string | null;
    value: string | null;
  }>(
    sql`select d.closed_at as closed, d.quote_value as value from public.deal d join public.client c on c.deal_id = d.deal_id where c.client_id = ${client.id}::uuid`,
  );
  expect(deal).toEqual({ closed: null, value: null });
  await editWorkbook(owner, {
    kind: "clients",
    field: "ownerId",
    value: other,
    records: [{ id: client.id, updatedAt: client.updatedAt }],
  });
  expect(
    (await workbookSnapshot()).rows.find((r) => r.id === client.id)?.ownerId,
  ).toBe(other);
  await expect(
    editWorkbook(owner, {
      kind: "clients",
      field: "status",
      value: "closed",
      records: [{ id: client.id, updatedAt: client.updatedAt }],
    }),
  ).rejects.toThrow(/changed/);
  const view = await saveWorkbookView(owner, {
    name: "Private source review",
    visibility: "personal",
    config: defaultWorkbookConfig("clients"),
  });
  expect((await savedWorkbookViews(other)).some((v) => v.id === view.id)).toBe(
    false,
  );
});

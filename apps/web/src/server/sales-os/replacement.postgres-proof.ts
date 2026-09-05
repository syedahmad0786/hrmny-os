import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { sql } from "@hrmny/db";
import { salesgrowth } from "@hrmny/integrations";
const { parseSalesGrowthExport } = salesgrowth;
import { getDb } from "../db";
import { runSalesGrowthImport } from "../crm/salesgrowth-import";
import { listActivities } from "../crm/repository";

it("imports history atomically, preserves two-person privacy and replays without a new live opportunity", async () => {
  const db = getDb()!;
  const a = randomUUID(),
    b = randomUUID(),
    outsider = randomUUID();
  for (const id of [a, b, outsider])
    await db.execute(
      sql`insert into employee(employee_id,display_name,email) values (${id},'CI archive reader',${`${id}@example.invalid`})`,
    );
  const companyName = `CI archive ${randomUUID()}`;
  const id = 90000000 + Math.floor(Math.random() * 10000000);
  const data = parseSalesGrowthExport({
    intel_companies: [
      {
        id,
        canonical_name: companyName,
        notes: "Private relationship context",
      },
    ],
    intel_deals: [
      {
        id,
        company_id: id,
        deal_name: "Historical pitch",
        year: 2024,
        outcome: "won",
        value_aed: 50000,
      },
    ],
    intel_communications: [
      {
        id,
        company_id: id,
        subject: "Private archive message",
        summary: "Only named readers can read this",
        date: "2024-02-01",
      },
    ],
  });
  const result = await runSalesGrowthImport(data, {
    apply: true,
    privateAuthorizedEmployeeIds: [a, b],
  });
  expect(result.plan.deals).toHaveLength(0);
  const [company] = await db.execute<{ id: string }>(
    sql`select company_id as id from company where name = ${companyName}`,
  );
  expect(company).toBeTruthy();
  for (const reader of [a, b]) {
    const history = await listActivities({
      companyId: company!.id,
      viewerEmployeeId: reader,
    });
    expect(
      history.some((row) => row.body?.includes("Only named readers")),
    ).toBe(true);
  }
  expect(
    await listActivities({
      companyId: company!.id,
      viewerEmployeeId: outsider,
    }),
  ).toEqual([]);
  const replay = await runSalesGrowthImport(data, {
    apply: true,
    privateAuthorizedEmployeeIds: [a, b],
  });
  expect(replay.report.totals.imported).toBe(0);
  const [forecast] = await db.execute<{ count: number }>(
    sql`select count(*)::int as count from deal where company_id = ${company!.id}`,
  );
  expect(forecast?.count).toBe(0);
});

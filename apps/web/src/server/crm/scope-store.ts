import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import {
  getDemoStore,
  type DemoQuoteLine,
  type DemoScope,
} from "../demo-store";
import { getDb } from "../db";

type ScopeRow = {
  scope_id: string;
  client_id: string;
  deal_id: string | null;
  title: string;
  value: string | null;
  terms: string | null;
  period_start: string;
  period_end: string | null;
  status: string;
  margin_at_sale_pct: string | null;
};

type LineRow = {
  scope_deliverable_line_id: string;
  label: string;
  quantity: string | null;
  unit_price: string | null;
  internal_cost: string | null;
};

async function loadLines(
  scopeId: string,
): Promise<DemoQuoteLine[]> {
  const db = getDb();
  if (!db) {
    return getDemoStore().scopes.get(scopeId)?.lines ?? [];
  }
  const rows = (await db.execute(sql`
    select scope_deliverable_line_id, label, quantity::text as quantity,
           unit_price::text as unit_price, internal_cost::text as internal_cost
    from public.scope_deliverable_line
    where scope_id = ${scopeId}::uuid
    order by created_at asc
  `)) as unknown as LineRow[];
  return rows.map((row) => ({
    label: row.label,
    unitSell: Number(row.unit_price ?? 0),
    unitCost: Number(row.internal_cost ?? 0),
    qty: Number(row.quantity ?? 1),
    isVendor: false,
  }));
}

function mapScope(row: ScopeRow, lines: DemoQuoteLine[]): DemoScope {
  return {
    scopeId: row.scope_id,
    clientId: row.client_id,
    dealId: row.deal_id,
    title: row.title,
    value: String(row.value ?? "0"),
    terms: row.terms,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    marginAtSalePct: row.margin_at_sale_pct,
    lines,
  };
}

export async function getScope(scopeId: string): Promise<DemoScope | null> {
  const db = getDb();
  if (!db) return getDemoStore().scopes.get(scopeId) ?? null;
  const rows = (await db.execute(sql`
    select scope_id, client_id, deal_id, title, value::text as value, terms,
           period_start::text as period_start, period_end::text as period_end,
           status, margin_at_sale_pct::text as margin_at_sale_pct
    from public.scope
    where scope_id = ${scopeId}::uuid
    limit 1
  `)) as unknown as ScopeRow[];
  if (!rows[0]) return null;
  return mapScope(rows[0], await loadLines(scopeId));
}

export async function listScopesByClient(
  clientId: string,
): Promise<DemoScope[]> {
  const db = getDb();
  if (!db) {
    return [...getDemoStore().scopes.values()].filter(
      (s) => s.clientId === clientId,
    );
  }
  const rows = (await db.execute(sql`
    select scope_id
    from public.scope
    where client_id = ${clientId}::uuid
    order by created_at desc
  `)) as unknown as Array<{ scope_id: string }>;
  const out: DemoScope[] = [];
  for (const row of rows) {
    const scope = await getScope(row.scope_id);
    if (scope) out.push(scope);
  }
  return out;
}

export async function upsertScope(scope: DemoScope): Promise<DemoScope> {
  const db = getDb();
  if (!db) {
    getDemoStore().scopes.set(scope.scopeId, scope);
    return scope;
  }

  await db.execute(sql`
    insert into public.scope (
      scope_id, client_id, deal_id, title, value, terms,
      period_start, period_end, status, margin_at_sale_pct, lanes
    ) values (
      ${scope.scopeId}::uuid,
      ${scope.clientId}::uuid,
      ${scope.dealId}::uuid,
      ${scope.title},
      ${scope.value},
      ${scope.terms},
      ${scope.periodStart}::date,
      ${scope.periodEnd}::date,
      ${scope.status}::scope_status_enum,
      ${scope.marginAtSalePct},
      '[]'::jsonb
    )
    on conflict (scope_id) do update set
      title = excluded.title,
      value = excluded.value,
      terms = excluded.terms,
      period_start = excluded.period_start,
      period_end = excluded.period_end,
      status = excluded.status,
      margin_at_sale_pct = excluded.margin_at_sale_pct,
      updated_at = now()
  `);

  await db.execute(sql`
    delete from public.scope_deliverable_line
    where scope_id = ${scope.scopeId}::uuid
  `);
  for (const line of scope.lines) {
    await db.execute(sql`
      insert into public.scope_deliverable_line (
        scope_deliverable_line_id, scope_id, label, quantity, unit_price, internal_cost
      ) values (
        ${randomUUID()}::uuid,
        ${scope.scopeId}::uuid,
        ${line.label},
        ${line.qty},
        ${line.unitSell},
        ${line.unitCost}
      )
    `);
  }
  return scope;
}

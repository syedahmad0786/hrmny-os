import { sql } from "@hrmny/db";
import { getDemoStore, type DemoImmersion } from "../demo-store";
import { getDb } from "../db";

type ImmersionRow = {
  immersion_id: string;
  client_id: string;
  swot: Record<string, unknown> | null;
  usp: string | null;
  audience: string | null;
  social_accounts: Record<string, unknown> | null;
  competitors: unknown[] | null;
  objective_priority: string | null;
  brand_assets: Record<string, unknown> | null;
  approvers: Record<string, unknown> | null;
  completed_at: Date | string | null;
};

function mapImmersion(row: ImmersionRow): DemoImmersion {
  return {
    immersionId: row.immersion_id,
    clientId: row.client_id,
    swot: row.swot,
    usp: row.usp,
    audience: row.audience,
    socialAccounts: row.social_accounts,
    competitors: row.competitors,
    objectivePriority: row.objective_priority,
    brandAssets: row.brand_assets,
    approvers: row.approvers,
    completedAt: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
  };
}

export async function listImmersionsByClient(
  clientId: string,
): Promise<DemoImmersion[]> {
  const db = getDb();
  if (!db) {
    return [...getDemoStore().immersions.values()].filter(
      (i) => i.clientId === clientId,
    );
  }
  const rows = (await db.execute(sql`
    select immersion_id, client_id, swot, usp, audience, social_accounts,
           competitors, objective_priority, brand_assets, approvers, completed_at
    from public.immersion
    where client_id = ${clientId}::uuid
    order by updated_at desc
  `)) as unknown as ImmersionRow[];
  return rows.map(mapImmersion);
}

export async function upsertImmersion(
  immersion: DemoImmersion,
): Promise<DemoImmersion> {
  const db = getDb();
  if (!db) {
    getDemoStore().immersions.set(immersion.immersionId, immersion);
    return immersion;
  }
  await db.execute(sql`
    insert into public.immersion (
      immersion_id, client_id, swot, usp, audience, social_accounts,
      competitors, objective_priority, brand_assets, approvers, completed_at
    ) values (
      ${immersion.immersionId}::uuid,
      ${immersion.clientId}::uuid,
      ${immersion.swot ? JSON.stringify(immersion.swot) : null}::jsonb,
      ${immersion.usp},
      ${immersion.audience},
      ${immersion.socialAccounts ? JSON.stringify(immersion.socialAccounts) : null}::jsonb,
      ${immersion.competitors ? JSON.stringify(immersion.competitors) : null}::jsonb,
      ${immersion.objectivePriority},
      ${immersion.brandAssets ? JSON.stringify(immersion.brandAssets) : null}::jsonb,
      ${immersion.approvers ? JSON.stringify(immersion.approvers) : null}::jsonb,
      ${immersion.completedAt}::timestamptz
    )
    on conflict (immersion_id) do update set
      swot = excluded.swot,
      usp = excluded.usp,
      audience = excluded.audience,
      social_accounts = excluded.social_accounts,
      competitors = excluded.competitors,
      objective_priority = excluded.objective_priority,
      brand_assets = excluded.brand_assets,
      approvers = excluded.approvers,
      completed_at = excluded.completed_at,
      updated_at = now()
  `);
  return immersion;
}

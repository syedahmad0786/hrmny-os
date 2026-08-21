import { randomUUID } from "node:crypto";
import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type ImmersionRow = {
  immersionId: string;
  clientId: string;
  swot: Record<string, unknown> | null;
  usp: string | null;
  audience: string | null;
  socialAccounts: Record<string, unknown> | null;
  competitors: unknown[] | null;
  objectivePriority: string | null;
  brandAssets: Record<string, unknown> | null;
  approvers: Record<string, unknown> | null;
  completedAt: string | null;
};

export async function getImmersion(
  clientId: string,
): Promise<ImmersionRow[]> {
  const db = getDb();
  if (!db) return [];
  return db.execute<ImmersionRow>(sql`
    select
      immersion_id as "immersionId",
      client_id as "clientId",
      swot, usp, audience,
      social_accounts as "socialAccounts",
      competitors,
      objective_priority as "objectivePriority",
      brand_assets as "brandAssets",
      approvers,
      completed_at::text as "completedAt"
    from public.immersion
    where client_id = ${clientId}::uuid
    order by created_at desc
  `);
}

export async function upsertImmersion(input: {
  clientId: string;
  swot?: Record<string, unknown>;
  usp?: string;
  audience?: string;
  socialAccounts?: Record<string, unknown>;
  competitors?: unknown[];
  objectivePriority?: string;
  brandAssets?: Record<string, unknown>;
  approvers?: Record<string, unknown>;
  complete?: boolean;
}): Promise<ImmersionRow | null> {
  const db = getDb();
  if (!db) return null;
  const existing = await getImmersion(input.clientId);
  const prev = existing[0];
  const immersionId = prev?.immersionId ?? randomUUID();
  const completedAt = input.complete
    ? new Date().toISOString()
    : (prev?.completedAt ?? null);
  const rows = await db.execute<ImmersionRow>(sql`
    insert into public.immersion (
      immersion_id, client_id, swot, usp, audience, social_accounts,
      competitors, objective_priority, brand_assets, approvers, completed_at
    ) values (
      ${immersionId}::uuid,
      ${input.clientId}::uuid,
      ${JSON.stringify(input.swot ?? prev?.swot ?? null)}::jsonb,
      ${input.usp ?? prev?.usp ?? null},
      ${input.audience ?? prev?.audience ?? null},
      ${JSON.stringify(input.socialAccounts ?? prev?.socialAccounts ?? null)}::jsonb,
      ${JSON.stringify(input.competitors ?? prev?.competitors ?? null)}::jsonb,
      ${input.objectivePriority ?? prev?.objectivePriority ?? null},
      ${JSON.stringify(input.brandAssets ?? prev?.brandAssets ?? null)}::jsonb,
      ${JSON.stringify(input.approvers ?? prev?.approvers ?? null)}::jsonb,
      ${completedAt}::timestamptz
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
    returning
      immersion_id as "immersionId",
      client_id as "clientId",
      swot, usp, audience,
      social_accounts as "socialAccounts",
      competitors,
      objective_priority as "objectivePriority",
      brand_assets as "brandAssets",
      approvers,
      completed_at::text as "completedAt"
  `);
  const row = rows[0] ?? null;
  if (row && (input.complete || input.usp || input.audience)) {
    const { persistMemoryChunk } = await import("../ai/memory-db");
    const parts = [
      row.usp ? `USP: ${row.usp}` : null,
      row.audience ? `Audience: ${row.audience}` : null,
      row.objectivePriority ? `Objective: ${row.objectivePriority}` : null,
      row.swot ? `SWOT: ${JSON.stringify(row.swot)}` : null,
    ].filter(Boolean);
    if (parts.length) {
      await persistMemoryChunk({
        sourceType: "note",
        sourceId: row.immersionId,
        content: `Client immersion — ${parts.join(". ")}`,
        metadata: {
          clientId: row.clientId,
          kind: input.complete ? "immersion.completed" : "immersion.upsert",
        },
      });
    }
  }
  return row;
}

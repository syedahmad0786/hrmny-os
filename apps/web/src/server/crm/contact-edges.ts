import { sql } from "@hrmny/db";
import { getDb } from "../db";

export type ContactEdge = {
  contactEdgeId: string;
  fromContact: string;
  toContact: string;
  relation: string;
  weight: number;
  createdAt: string;
  updatedAt: string;
};

type EdgeRow = {
  id: string;
  from_contact: string;
  to_contact: string;
  relation: string;
  weight: number;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapEdge(row: EdgeRow): ContactEdge {
  return {
    contactEdgeId: row.id,
    fromContact: row.from_contact,
    toContact: row.to_contact,
    relation: row.relation,
    weight: Number(row.weight),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

/** Upsert a who-knows-whom edge into `contact_edges` (0060). No-op without DB. */
export async function upsertContactEdge(input: {
  fromContact: string;
  toContact: string;
  relation: string;
  weight?: number;
}): Promise<ContactEdge | null> {
  if (input.fromContact === input.toContact) {
    throw new Error("contact edge cannot be self-referential");
  }
  const db = getDb();
  if (!db) return null;
  const weight = input.weight ?? 0.5;
  const rows = (await db.execute(sql`
    insert into public.contact_edges (
      from_contact, to_contact, relation, weight
    ) values (
      ${input.fromContact}::uuid,
      ${input.toContact}::uuid,
      ${input.relation},
      ${weight}
    )
    on conflict do nothing
    returning
      contact_edge_id as id,
      from_contact, to_contact, relation, weight::float8 as weight,
      created_at, updated_at
  `)) as unknown as EdgeRow[];

  if (rows[0]) return mapEdge(rows[0]);

  // Update weight/relation when the pair already exists (no unique constraint
  // in 0060 — match the latest same-direction pair).
  const updated = (await db.execute(sql`
    update public.contact_edges set
      relation = ${input.relation},
      weight = ${weight},
      updated_at = now()
    where from_contact = ${input.fromContact}::uuid
      and to_contact = ${input.toContact}::uuid
    returning
      contact_edge_id as id,
      from_contact, to_contact, relation, weight::float8 as weight,
      created_at, updated_at
  `)) as unknown as EdgeRow[];
  return updated[0] ? mapEdge(updated[0]) : null;
}

export async function listContactEdges(contactId: string): Promise<ContactEdge[]> {
  const db = getDb();
  if (!db) return [];
  const rows = (await db.execute(sql`
    select
      contact_edge_id as id,
      from_contact, to_contact, relation, weight::float8 as weight,
      created_at, updated_at
    from public.contact_edges
    where from_contact = ${contactId}::uuid
       or to_contact = ${contactId}::uuid
    order by updated_at desc
  `)) as unknown as EdgeRow[];
  return rows.map(mapEdge);
}

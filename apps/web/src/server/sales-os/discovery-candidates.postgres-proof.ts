import { randomUUID } from "node:crypto";
import { createDb, sql } from "@hrmny/db";
import { expect, it } from "vitest";
import {
  decideDiscoveryCandidate,
  getDiscoveryCandidate,
  submitDiscoveryCandidate,
} from "./discovery-candidates";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (
  !databaseUrl ||
  !["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)
)
  throw new Error("LOCAL_POSTGRES_PROOF_REQUIRED");

const db = createDb(databaseUrl);
const ownerId = randomUUID();
const outsiderId = randomUUID();
const adminId = randomUUID();

it("proves Discovery review accept, replay, privacy, and no later-stage rows", async () => {
  await db.execute(sql`
    insert into public.employee (employee_id, display_name, email)
    values
      (${ownerId}::uuid, 'Discovery review owner', ${`discovery-review-owner-${ownerId}@example.invalid`}),
      (${outsiderId}::uuid, 'Discovery review outsider', ${`discovery-review-outsider-${outsiderId}@example.invalid`}),
      (${adminId}::uuid, 'Discovery review admin', ${`discovery-review-admin-${adminId}@example.invalid`})
  `);

  const requestId = randomUUID();
  const eventDate = new Date().toISOString().slice(0, 10);
  const sourceUrl = `https://campaignme.com/latest/postgres-review-${requestId}`;
  const website = `https://review-${requestId.slice(0, 8)}.campaignme.com`;
  const created = await submitDiscoveryCandidate({
    actorEmployeeId: ownerId,
    isAdmin: false,
    values: {
      requestId,
      companyName: `Postgres Review ${requestId.slice(0, 8)}`,
      website,
      whyNow: "A dated publication named a relevant UAE review.",
      sourceUrl,
      excerpt: "The issuer opened a regional creative review this week.",
      eventDate,
      visibilityScope: "private",
    },
  });
  expect(created.reviewState).toBe("needs_review");
  expect(created.qualificationState).toBe("not_assessed");
  expect(created.evidence?.[0]?.excerptHidden).toBe(false);
  expect(created.evaluation?.packet.excerptIncluded).toBe(false);
  expect(created.evaluation?.packet.provider).toBe("unavailable");

  const replay = await submitDiscoveryCandidate({
    actorEmployeeId: ownerId,
    isAdmin: false,
    values: {
      requestId,
      companyName: `Postgres Review ${requestId.slice(0, 8)}`,
      website,
      whyNow: "A dated publication named a relevant UAE review.",
      sourceUrl,
      excerpt: "The issuer opened a regional creative review this week.",
      eventDate,
      visibilityScope: "private",
    },
  });
  expect(replay.id).toBe(created.id);

  await expect(
    getDiscoveryCandidate({
      candidateId: created.id,
      actorEmployeeId: outsiderId,
      isAdmin: false,
    }),
  ).rejects.toMatchObject({ message: "CANDIDATE_ACCESS_DENIED" });

  const accepted = await decideDiscoveryCandidate({
    action: "accept",
    candidateId: created.id,
    expectedVersion: created.expectedVersion,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(accepted.reviewState).toBe("accepted");
  expect(accepted.companyId).toBeTruthy();
  expect(accepted.qualificationState).toBe("not_assessed");

  const [company] = await db.execute<{ notes: string | null }>(sql`
    select notes from public.company where company_id = ${accepted.companyId}::uuid
  `);
  expect(company?.notes).toBeNull();

  const later = await db.execute<{ contacts: number; deals: number }>(sql`
    select
      (select count(*)::int from public.contact where company_id = ${accepted.companyId}::uuid) as contacts,
      (select count(*)::int from public.deal where company_id = ${accepted.companyId}::uuid) as deals
  `);
  expect(later[0]).toEqual({ contacts: 0, deals: 0 });

  const audits = await db.execute<{ action: string; after: Record<string, unknown> }>(sql`
    select action, after
    from public.audit_event
    where entity_id = ${created.id}::uuid
    order by created_at
  `);
  expect(audits.map((row) => row.action)).toEqual([
    "discovery.candidate.submitted",
    "discovery.candidate.accepted",
  ]);
  expect(JSON.stringify(audits)).not.toContain("regional creative review");

  const same = await decideDiscoveryCandidate({
    action: "accept",
    candidateId: created.id,
    expectedVersion: accepted.expectedVersion,
    actorEmployeeId: ownerId,
    isAdmin: false,
  });
  expect(same.companyId).toBe(accepted.companyId);
}, 20_000);

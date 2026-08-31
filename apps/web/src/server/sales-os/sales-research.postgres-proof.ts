import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "@hrmny/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../db";

type WorkerResult =
  { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

const workerPath = fileURLToPath(
  new URL("../../test/sales-research-postgres-worker.ts", import.meta.url),
);
const prefix = "CI Sales Runtime";

function runWorker(input: Record<string, unknown>): Promise<WorkerResult> {
  const encoded = Buffer.from(JSON.stringify(input)).toString("base64url");
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["--import", "tsx", workerPath, encoded],
      {
        cwd: process.cwd(),
        env: process.env,
        timeout: 45_000,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const raw = (error ? stderr : stdout).trim().split(/\r?\n/).at(-1);
        let parsed: Record<string, unknown>;
        try {
          parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
        } catch {
          parsed = { error: "POSTGRES_WORKER_INVALID_RESPONSE" };
        }
        resolve(
          error
            ? { ok: false, error: String(parsed.error ?? error.message) }
            : { ok: true, value: parsed },
        );
      },
    );
  });
}

async function cleanProofRows() {
  const db = getDb();
  if (!db) throw new Error("POSTGRES_PROOF_DATABASE_REQUIRED");
  await db.execute(sql`
    delete from public.audit_event
    where entity_type = 'company_research'
      and entity_id in (
        select company_research_id from public.company_research
        where name like ${`${prefix}%`}
      )
  `);
  await db.execute(sql`
    delete from public.intel_signal
    where source like 'research-proposal:ci_postgres:%'
  `);
  await db.execute(sql`
    delete from public.integration_inbox
    where provider = 'hrmny'
      and external_event_id like 'sales-research:ci-postgres-%'
  `);
  await db.execute(sql`
    delete from public.company_research where name like ${`${prefix}%`}
  `);
  await db.execute(sql`
    delete from public.company where name like ${`${prefix}%`}
  `);
}

async function counts(name: string) {
  const db = getDb();
  if (!db) throw new Error("POSTGRES_PROOF_DATABASE_REQUIRED");
  const [row] = await db.execute<{
    proposals: number;
    signals: number;
    receipts: number;
    audits: number;
    companies: number;
  }>(sql`
    select
      (select count(*)::int from public.company_research where name = ${name}) as proposals,
      (select count(*)::int from public.intel_signal where source like 'research-proposal:ci_postgres:%') as signals,
      (select count(*)::int from public.integration_inbox where provider = 'hrmny' and external_event_id like 'sales-research:ci-postgres-%') as receipts,
      (select count(*)::int from public.audit_event where entity_type = 'company_research' and entity_id in (select company_research_id from public.company_research where name = ${name})) as audits,
      (select count(*)::int from public.company where name = ${name}) as companies
  `);
  if (!row) throw new Error("POSTGRES_PROOF_COUNT_FAILED");
  return row;
}

describe("Sales research proposal PostgreSQL runtime", () => {
  beforeAll(cleanProofRows);
  afterAll(cleanProofRows);

  it("claims one durable proposal under concurrent exact replay", async () => {
    const name = `${prefix} Replay`;
    const input = {
      action: "propose",
      payload: {
        requestId: "ci-postgres-replay-v1",
        name,
        website: "https://ci-replay.example",
        evidence: "https://sources.hrmny.co/ci/postgres-replay",
      },
    };
    const results = await Promise.all([runWorker(input), runWorker(input)]);

    expect(results.every((result) => result.ok)).toBe(true);
    const values = results.flatMap((result) =>
      result.ok ? [result.value] : [],
    );
    expect(new Set(values.map((value) => value.receiptId)).size).toBe(1);
    expect(new Set(values.map((value) => value.proposalId)).size).toBe(1);
    expect(new Set(values.map((value) => value.signalId)).size).toBe(1);
    expect(await counts(name)).toMatchObject({
      proposals: 1,
      signals: 1,
      receipts: 1,
      audits: 1,
      companies: 0,
    });
  });

  it("rejects one concurrent payload mismatch without partial rows", async () => {
    await cleanProofRows();
    const name = `${prefix} Mismatch`;
    const base = {
      action: "propose",
      payload: {
        requestId: "ci-postgres-mismatch-v1",
        name,
        website: "https://ci-mismatch.example",
        evidence: "https://sources.hrmny.co/ci/postgres-mismatch-a",
      },
    };
    const results = await Promise.all([
      runWorker(base),
      runWorker({
        ...base,
        payload: {
          ...base.payload,
          evidence: "https://sources.hrmny.co/ci/postgres-mismatch-b",
        },
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)).toMatchObject({
      error: expect.stringContaining("RESEARCH_PROPOSAL_PAYLOAD_MISMATCH"),
    });
    expect(await counts(name)).toMatchObject({
      proposals: 1,
      signals: 1,
      receipts: 1,
      audits: 1,
      companies: 0,
    });
  });

  it("serializes concurrent Gate 1 approval and links its signal", async () => {
    await cleanProofRows();
    const name = `${prefix} Approval`;
    const proposal = await runWorker({
      action: "propose",
      payload: {
        requestId: "ci-postgres-approval-v1",
        name,
        website: "https://ci-approval.example",
        evidence: "https://sources.hrmny.co/ci/postgres-approval",
      },
    });
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    const proposalId = String(proposal.value.proposalId);
    const approvals = await Promise.all([
      runWorker({ action: "approve", proposalId }),
      runWorker({ action: "approve", proposalId }),
    ]);

    expect(approvals.every((result) => result.ok)).toBe(true);
    const values = approvals.flatMap((result) =>
      result.ok ? [result.value] : [],
    );
    expect(new Set(values.map((value) => value.companyId)).size).toBe(1);
    expect(await counts(name)).toMatchObject({
      proposals: 1,
      signals: 1,
      receipts: 1,
      audits: 2,
      companies: 1,
    });
    const db = getDb();
    const [linked] = await db!.execute<{ linked: boolean }>(sql`
      select company_id is not null as linked
      from public.intel_signal
      where source like 'research-proposal:ci_postgres:%'
      limit 1
    `);
    expect(linked?.linked).toBe(true);
  });
});

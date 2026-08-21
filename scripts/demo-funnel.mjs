#!/usr/bin/env node
/**
 * Demo funnel smoke — Postgres path:
 * client onboarding + immersion + memory sandbox + agent_runs.
 * Usage: node scripts/demo-funnel.mjs
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, "packages/db/package.json"));
const postgres = require("postgres");

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {
    /* optional */
  }
}

loadEnv(join(root, "apps/web/.env.local"));
loadEnv(join(root, ".env.local"));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(JSON.stringify({ ok: false, error: "NO_DATABASE_URL" }));
  process.exit(1);
}

const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 20 });

const PHASE_NAMES = [
  "Kickoff & access",
  "Immersion & discovery",
  "Strategy lock",
  "Creative foundations",
  "Channel setup",
  "First delivery sprint",
  "Steady-state handoff",
];

function seedPhases() {
  return PHASE_NAMES.map((name, i) => ({
    phaseId: randomUUID(),
    phaseIndex: i,
    name,
    status: i === 0 ? "active" : "pending",
    signedOffAt: null,
    steps: [
      {
        stepId: randomUUID(),
        title: `${name} — RACI owner confirm`,
        raci: "AM",
        done: false,
      },
    ],
  }));
}

try {
  await sql.unsafe(
    readFileSync(
      join(root, "packages/db/migrations/0067_client_onboarding.sql"),
      "utf8",
    ),
  );

  const vector = await sql`select exists(select 1 from pg_extension where extname='vector') as ok`;
  const employees = await sql`select employee_id from employee limit 1`;
  const employeeId = employees[0]?.employee_id;
  if (!employeeId) throw new Error("NO_EMPLOYEE");

  const companyName = `Demo Funnel ${Date.now()}`;
  const [company] = await sql`
    insert into company (name, market)
    values (${companyName}, 'UAE')
    returning company_id
  `;
  const [deal] = await sql`
    insert into deal (
      company_id, company_name, stage, close_outcome,
      lead_source_lane, quote_value, owner_employee_id
    ) values (
      ${company.company_id}, ${companyName}, 'close', 'won',
      'relationship_led', 50000, ${employeeId}
    ) returning deal_id
  `;
  const [client] = await sql`
    insert into client (
      deal_id, name, market, engagement_type, contract_value,
      currency, lifecycle_status, start_date
    ) values (
      ${deal.deal_id}, ${companyName}, 'UAE', 'project',
      50000, 'AED', 'onboarding', current_date
    ) returning client_id
  `;

  const phases = seedPhases();
  await sql`
    insert into client_onboarding (client_id, phases)
    values (${client.client_id}, ${sql.json(phases)})
  `;

  const [immersion] = await sql`
    insert into immersion (client_id, usp, audience, completed_at)
    values (${client.client_id}, 'Demo USP', 'UAE SMB', now())
    returning immersion_id
  `;

  // Creative QC task shared with portal (title in brief.body)
  const [task] = await sql`
    insert into task (client_id, task_type, status, priority)
    values (${client.client_id}, 'social_cutdowns', 'qc', 'high')
    returning task_id
  `;
  await sql`
    insert into brief (task_id, body, dor_complete, missing_required_count)
    values (
      ${task.task_id},
      ${sql.json({
        title: `${companyName} — first creative cutdown`,
        qcPassed: false,
        clientRevisionCount: 0,
        revisionBoundaryAck: false,
      })},
      true,
      0
    )
  `;

  // Per-client sandbox memory
  await sql`
    insert into memory_chunk (source_type, content, metadata)
    values (
      'note',
      ${`Client ${companyName} prefers short-form creative for prospecting.`},
      ${sql.json({ clientId: client.client_id, kind: "demo" })}
    )
  `;
  // Other client noise — must not leak
  const otherClient = randomUUID();
  await sql`
    insert into memory_chunk (source_type, content, metadata)
    values (
      'note',
      'Secret other-client only memory should not appear',
      ${sql.json({ clientId: otherClient, kind: "noise" })}
    )
  `;

  const scoped = await sql`
    select content from memory_chunk
    where metadata->>'clientId' = ${client.client_id}
  `;

  await sql`
    insert into agent_runs (
      agent, model, input, output, tokens_in, tokens_out, cost_aed, gate_outcome
    ) values (
      'research', 'mock',
      ${sql.json({ prompt: "demo funnel" })},
      ${sql.json({ ok: true })},
      10, 20, 0, 'not_applicable'
    )
  `;

  const onboard = await sql`
    select jsonb_array_length(phases) as n from client_onboarding
    where client_id = ${client.client_id}
  `;

  console.log(
    JSON.stringify({
      ok: true,
      vector: vector[0].ok,
      funnel: {
        companyId: company.company_id,
        dealId: deal.deal_id,
        clientId: client.client_id,
        immersionId: immersion.immersion_id,
        creativeTaskId: task.task_id,
        onboardingPhases: onboard[0].n,
        clientMemoryChunks: scoped.length,
        sandboxIsolated: scoped.every(
          (r) => !String(r.content).includes("other-client"),
        ),
      },
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: String(e.message || e) }));
  process.exit(2);
} finally {
  await sql.end({ timeout: 2 });
}

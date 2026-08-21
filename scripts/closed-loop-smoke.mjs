/**
 * Closed-loop product smoke: handover → QC → client_review → portal workspace.
 * Usage: npx tsx scripts/closed-loop-smoke.mjs
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = "/workspace";
for (const path of [join(root, ".env.local"), join(root, "apps/web/.env.local")]) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m || process.env[m[1]]) continue;
      let v = m[2].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  } catch {
    /* optional */
  }
}

const { createDeal, updateDeal, moveDealStage } = await import(
  pathToFileURL(join(root, "apps/web/src/server/crm/repository.ts")).href
);
const { closeDurableDeal, durableHandoverPack } = await import(
  pathToFileURL(join(root, "apps/web/src/server/crm/handover.ts")).href
);
const {
  setDeliveryTaskQc,
  updateDeliveryTaskStatus,
  getDeliveryTask,
} = await import(
  pathToFileURL(join(root, "apps/web/src/server/tasks/delivery-tasks.ts")).href
);
const { readPortalWorkspace } = await import(
  pathToFileURL(join(root, "apps/web/src/server/portal-data.ts")).href
);
const { syncXeroInvoiceMirror } = await import(
  pathToFileURL(join(root, "apps/web/src/server/finance/xero-mirror-sync.ts")).href
);
const { upsertImmersion } = await import(
  pathToFileURL(join(root, "apps/web/src/server/clients/immersion.ts")).href
);
const { searchMemory } = await import(
  pathToFileURL(join(root, "apps/web/src/server/ai/memory-db.ts")).href
);

const deal = await createDeal({
  companyName: `Closed Loop ${Date.now()}`,
  leadSourceLane: "apollo_intent",
  sector: "saas",
});
await updateDeal(deal.dealId, {
  emailVerified: true,
  buafBudget: true,
  buafUrgency: true,
  buafAccess: true,
  buafFit: true,
  buafTemperature: "hot",
  quoteValue: "42000",
  marginPct: "38",
});
for (const to of ["qualify", "engage", "scope", "propose", "price_cost"]) {
  const m = await moveDealStage({ dealId: deal.dealId, to });
  if (!m.ok) {
    console.log(JSON.stringify({ ok: false, step: to, m }));
    process.exit(1);
  }
}
const closed = await closeDurableDeal({ dealId: deal.dealId, outcome: "won" });
if (!closed.ok) {
  console.log(JSON.stringify(closed));
  process.exit(1);
}
const pack = await durableHandoverPack({ dealId: deal.dealId });
if (!pack.ok || !pack.task) {
  console.log(JSON.stringify(pack));
  process.exit(1);
}

await upsertImmersion({
  clientId: pack.client.clientId,
  usp: "Short-form creative for UAE SMB",
  audience: "UAE founders",
  complete: true,
});

await setDeliveryTaskQc({
  taskId: pack.task.taskId,
  decision: "pass",
  notes: "CD approve closed-loop",
});
await updateDeliveryTaskStatus({
  taskId: pack.task.taskId,
  status: "client_review",
  qcPassed: true,
});

const portal = await readPortalWorkspace(pack.client.clientId);
const memory = await searchMemory({
  query: "short-form creative UAE",
  clientId: pack.client.clientId,
  limit: 5,
});
const xero = await syncXeroInvoiceMirror();
const task = await getDeliveryTask(pack.task.taskId);

const ok =
  portal.approvals.some((a) => a.entityId === pack.task.taskId) &&
  task?.status === "client_review" &&
  memory.length > 0 &&
  xero.upserted > 0;

console.log(
  JSON.stringify(
    {
      ok,
      clientId: pack.client.clientId,
      taskStatus: task?.status,
      portalApprovals: portal.approvals.length,
      memoryHits: memory.length,
      xeroMirror: xero,
      fired: pack.pack.fired,
    },
    null,
    2,
  ),
);
process.exit(ok ? 0 : 1);

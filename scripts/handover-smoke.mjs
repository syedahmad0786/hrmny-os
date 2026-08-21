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
const { getDeliveryTask } = await import(
  pathToFileURL(join(root, "apps/web/src/server/tasks/delivery-tasks.ts")).href
);

const deal = await createDeal({
  companyName: `Handover Smoke ${Date.now()}`,
  leadSourceLane: "relationship_led",
  sector: "tech",
});
await updateDeal(deal.dealId, {
  emailVerified: true,
  buafBudget: true,
  buafUrgency: true,
  buafAccess: true,
  buafFit: true,
  buafTemperature: "hot",
  quoteValue: "25000",
  marginPct: "40",
});
for (const to of ["qualify", "engage", "scope", "propose", "price_cost"]) {
  const m = await moveDealStage({ dealId: deal.dealId, to });
  if (!m.ok) {
    console.log(JSON.stringify({ ok: false, step: to, m }));
    process.exit(1);
  }
}
const closed = await closeDurableDeal({
  dealId: deal.dealId,
  outcome: "won",
});
if (!closed.ok) {
  console.log(JSON.stringify(closed));
  process.exit(1);
}
const pack = await durableHandoverPack({ dealId: deal.dealId });
const task =
  pack.ok && pack.task ? await getDeliveryTask(pack.task.taskId) : null;
console.log(
  JSON.stringify(
    {
      ok: pack.ok,
      dealStage: closed.deal.stage,
      clientId: pack.ok ? pack.client.clientId : null,
      fired: pack.ok ? pack.pack.fired : null,
      taskId: task?.taskId ?? null,
      taskStatus: task?.status ?? null,
      taskTitle: task?.title ?? null,
      reason: pack.ok ? null : pack.reason,
    },
    null,
    2,
  ),
);
process.exit(pack.ok ? 0 : 1);

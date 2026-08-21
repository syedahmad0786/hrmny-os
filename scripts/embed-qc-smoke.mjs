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

const { persistMemoryChunk, searchMemory, embedText } = await import(
  pathToFileURL(join(root, "apps/web/src/server/ai/memory-db.ts")).href
);
const { setDeliveryTaskQc, updateDeliveryTaskStatus } = await import(
  pathToFileURL(join(root, "apps/web/src/server/tasks/delivery-tasks.ts")).href
);

const emb = await embedText(
  "Client prefers short-form creative for UAE SMB audiences",
);
console.log(JSON.stringify({ embedDims: emb?.length ?? null }));

const clientId = "12cda211-e366-44ea-a4b8-1685e06b9d3e";
await persistMemoryChunk({
  sourceType: "note",
  content:
    "Client prefers short-form creative for UAE SMB audiences and immersion USP Demo.",
  metadata: { clientId, kind: "embed_smoke" },
});
const hits = await searchMemory({
  query: "short-form creative UAE",
  clientId,
  limit: 5,
});
console.log(
  JSON.stringify({
    searchHits: hits.map((h) => ({
      score: h.score,
      snippet: h.content.slice(0, 80),
    })),
  }),
);

const taskId = "6836f4db-eb70-4b27-ac19-ff7377f92f4b";
await setDeliveryTaskQc({ taskId, decision: "pass", notes: "CD" });
const advanced = await updateDeliveryTaskStatus({
  taskId,
  status: "client_review",
  qcPassed: true,
});
console.log(
  JSON.stringify({
    portalTask: {
      status: advanced?.status ?? null,
      qcPassed: advanced?.qcPassed ?? null,
    },
  }),
);

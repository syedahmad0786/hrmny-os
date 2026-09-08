import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { projectResult } from "./access.mjs";
const root = process.env.GBRAIN_SOURCE_ROOT;
if (
  !root ||
  !process.env.GBRAIN_HOME ||
  process.env.DATABASE_URL ||
  process.env.GBRAIN_DATABASE_URL
)
  throw Error(
    "Isolated source checkout and GBRAIN_HOME required; no database URL allowed",
  );
for (const key of [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "ANTHROPIC_API_KEY",
  "VOYAGE_API_KEY",
  "GEMINI_API_KEY",
])
  if (process.env[key]) throw Error("Provider credentials must be absent");
const { PGLiteEngine } = await import(
  pathToFileURL(`${root}/src/core/pglite-engine.ts`).href
);
const { dispatchToolCall } = await import(
  pathToFileURL(`${root}/src/mcp/dispatch.ts`).href
);
const engine = new PGLiteEngine();
await engine.connect({});
try {
  await engine.initSchema();
  await engine.setConfig("search.mcp_keyword_only", "true");
  const a = "hrmny-project-c0000000-0000-4000-8000-000000000002",
    b = "hrmny-project-c0000000-0000-4000-8000-000000000003";
  for (const source of [a, b]) {
    await engine.executeRaw(
      "INSERT INTO sources (id,name,config) VALUES ($1,$2,'{}'::jsonb)",
      [source, source],
    );
    for (const slug of ["launch", "brief"]) {
      const text = `Synthetic launch plan ${source === a ? "ALLOWED" : "HIDDEN"}`;
      await engine.putPage(
        slug,
        {
          type: "note",
          title: text,
          compiled_truth: text,
          timeline: "",
          frontmatter: {},
        },
        { sourceId: source },
      );
      await engine.upsertChunks(
        slug,
        [
          {
            chunk_index: 0,
            chunk_text: text,
            chunk_source: "compiled_truth",
            token_count: 8,
          },
        ],
        { sourceId: source },
      );
    }
  }
  await engine.addLink(
    "launch",
    "brief",
    "Approved dependency",
    "depends_on",
    "manual",
    undefined,
    undefined,
    { fromSourceId: a, toSourceId: a },
  );
  await engine.addLink(
    "launch",
    "brief",
    "HIDDEN cross-project relationship",
    "depends_on",
    "manual",
    undefined,
    undefined,
    { fromSourceId: a, toSourceId: b },
  );
  const opts = {
    remote: true,
    transport: "http",
    sourceId: a,
    auth: {
      token: "synthetic",
      clientId: "synthetic",
      scopes: ["read"],
      sourceId: a,
      allowedSources: [a],
      hasSourceGrant: true,
    },
    takesHoldersAllowList: ["world"],
    logger: { info() {}, warn() {}, error() {} },
  };
  for (const [operation, args] of [
    ["search", { query: "launch", limit: 5, snippet_chars: 1200 }],
    ["get_page", { slug: "launch" }],
    ["get_links", { slug: "launch" }],
    ["get_backlinks", { slug: "brief" }],
  ]) {
    const result = await dispatchToolCall(engine, operation, args, opts);
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const projected = projectResult(
      operation,
      JSON.parse(result.content[0].text),
      [a],
    );
    assert.ok(
      projected.length > 0,
      `${operation} must return positive control`,
    );
    assert.equal(JSON.stringify(projected).includes("HIDDEN"), false);
    assert.equal(JSON.stringify(projected).includes(b), false);
  }
  console.log(
    "PASS: real GBrain keyword, page and graph reads preserve project source isolation",
  );
} finally {
  await engine.disconnect();
}

import { pathToFileURL } from "node:url";
import { authorizedRequest, projectResult } from "./access.mjs";

const root = process.env.GBRAIN_SOURCE_ROOT || "/opt/gbrain";
const { createEngine } = await import(
  pathToFileURL(`${root}/src/core/engine-factory.ts`).href
);
const { dispatchToolCall } = await import(
  pathToFileURL(`${root}/src/mcp/dispatch.ts`).href
);
const databaseUrl = process.env.GBRAIN_DATABASE_URL;
const ref = process.env.GBRAIN_DATABASE_PROJECT_REF;
const secret = process.env.GBRAIN_REQUEST_SECRET;
if (
  !databaseUrl ||
  !ref ||
  ref === "klrugedztqxlvyghyzxs" ||
  !secret ||
  secret.length < 32
)
  throw Error("Dedicated brain configuration required");
const address = new URL(databaseUrl);
if (
  address.hostname !== `db.${ref}.supabase.co` &&
  !(
    address.hostname.endsWith(".pooler.supabase.com") &&
    address.username === `postgres.${ref}`
  )
)
  throw Error("Dedicated brain database identity mismatch");
const engine = await createEngine({ engine: "postgres" });
await engine.connect({ engine: "postgres", database_url: databaseUrl });
// Schema creation/migrations are a separate operator step, never an HTTP side effect.
await engine.getConfig("search.mcp_keyword_only");
const quiet = { info() {}, warn() {}, error() {} };
Bun.serve({
  hostname: "0.0.0.0",
  port: Number(process.env.PORT || 8080),
  maxRequestBodySize: 8192,
  idleTimeout: 20,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz")
      return Response.json({ ok: true });
    if (request.method !== "POST" || url.pathname !== "/read")
      return new Response(null, { status: 404 });
    let call;
    try {
      call = authorizedRequest(
        await request.text(),
        request.headers.get("x-hrmny-signature"),
        secret,
      );
    } catch {
      return Response.json({ error: "ACCESS_DENIED" }, { status: 403 });
    }
    try {
      const result = await dispatchToolCall(engine, call.operation, call.args, {
        remote: true,
        transport: "http",
        sourceId: call.sources[0],
        auth: {
          token: "server-verified-request",
          clientId: call.employeeId,
          scopes: ["read"],
          sourceId: call.sources[0],
          allowedSources: call.sources,
          hasSourceGrant: true,
        },
        takesHoldersAllowList: ["world"],
        logger: quiet,
      });
      if (result.isError)
        return Response.json({ error: "BRAIN_READ_FAILED" }, { status: 502 });
      const value = JSON.parse(result.content[0].text);
      return Response.json(
        {
          requestId: call.requestId,
          results: projectResult(call.operation, value, call.sources),
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return Response.json({ error: "BRAIN_READ_FAILED" }, { status: 502 });
    }
  },
});
console.log("hrmny brain retrieval listening");

import { sql } from "@hrmny/db";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { toolConfiguredStatus } from "@/server/integrations/resolve-keys";

/** Lightweight deploy smoke — no secrets, no business data. */
export async function GET() {
  const db = getDb();
  let database: "up" | "down" = "down";
  let pgvector = false;
  if (db) {
    try {
      await db.execute(sql`select 1`);
      database = "up";
      const rows = await db.execute<{ ok: boolean }>(sql`
        select exists(select 1 from pg_extension where extname = 'vector') as ok
      `);
      pgvector = Boolean(rows[0]?.ok);
    } catch {
      database = "down";
    }
  }
  const has = (k: string) => Boolean(process.env[k]?.trim());
  const [apollo, hunter, xero] = await Promise.all([
    toolConfiguredStatus("apollo"),
    toolConfiguredStatus("hunter"),
    toolConfiguredStatus("xero"),
  ]);
  const body = {
    ok: database === "up",
    authMode: process.env.AUTH_MODE ?? "dev",
    llmProvider: process.env.LLM_PROVIDER ?? "mock",
    xeroWriteEnabled: process.env.XERO_WRITE_ENABLED === "true",
    database,
    pgvector,
    tools: {
      composio: has("COMPOSIO_API_KEY") ? "configured" : "missing",
      apollo,
      hunter,
      n8n:
        has("N8N_API_KEY") && process.env.N8N_MODE?.toLowerCase() !== "mock"
          ? "configured"
          : "mock",
      openrouter: has("OPENROUTER_API_KEY") ? "configured" : "mock",
      googleOAuth: has("GOOGLE_OAUTH_CLIENT_ID") ? "configured" : "missing",
      xero,
    },
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

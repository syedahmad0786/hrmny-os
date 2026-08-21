import { sql } from "@hrmny/db";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { featureEnabled } from "@/server/features";
import { toolConfiguredStatus } from "@/server/integrations/resolve-keys";

async function connectionSmoke(): Promise<{
  googleWorkspace: number;
  canva: number;
  linkedin: number;
  xero: number;
}> {
  const empty = {
    googleWorkspace: 0,
    canva: 0,
    linkedin: 0,
    xero: 0,
  };
  const db = getDb();
  if (!db) return empty;
  try {
    const rows = await db.execute<{ toolkit: string; n: number }>(sql`
      select toolkit, count(*)::int as n
      from public.connection_account
      where status in ('connected', 'ACTIVE', 'active')
        and toolkit in (
          'google_workspace',
          'canva',
          'linkedin',
          'xero',
          'composio:canva',
          'composio:linkedin'
        )
      group by toolkit
    `);
    const counts = { ...empty };
    for (const row of rows) {
      const n = Number(row.n) || 0;
      if (row.toolkit === "google_workspace") counts.googleWorkspace += n;
      else if (row.toolkit === "xero") counts.xero += n;
      else if (
        row.toolkit === "canva" ||
        row.toolkit === "composio:canva"
      ) {
        counts.canva += n;
      } else if (
        row.toolkit === "linkedin" ||
        row.toolkit === "composio:linkedin"
      ) {
        counts.linkedin += n;
      }
    }
    return counts;
  } catch {
    return empty;
  }
}

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
  const [apollo, hunter, xero, n8n, connections, portalMagicLink] =
    await Promise.all([
      toolConfiguredStatus("apollo"),
      toolConfiguredStatus("hunter"),
      toolConfiguredStatus("xero"),
      toolConfiguredStatus("n8n"),
      connectionSmoke(),
      featureEnabled("portal.magic_link", {}),
    ]);

  const resendMode =
    process.env.RESEND_MODE?.toLowerCase() === "live" && has("RESEND_API_KEY")
      ? "live"
      : has("RESEND_API_KEY")
        ? "configured"
        : "mock";

  const body = {
    ok: database === "up",
    authMode: process.env.AUTH_MODE ?? "dev",
    llmProvider: process.env.LLM_PROVIDER ?? "mock",
    xeroWriteEnabled: process.env.XERO_WRITE_ENABLED === "true",
    database,
    pgvector,
    portalMagicLink: portalMagicLink ? "enabled" : "disabled",
    tools: {
      composio: has("COMPOSIO_API_KEY") ? "configured" : "missing",
      apollo,
      hunter,
      n8n,
      openrouter: has("OPENROUTER_API_KEY") ? "configured" : "mock",
      googleOAuth: has("GOOGLE_OAUTH_CLIENT_ID") ? "configured" : "missing",
      xero,
      resend: resendMode,
      dam:
        has("NEXT_PUBLIC_SUPABASE_URL") &&
        (process.env.DAM_STORAGE ?? "memory").toLowerCase() === "supabase"
          ? "supabase"
          : "memory",
      inboundWebhook:
        has("N8N_WEBHOOK_SECRET") ||
        has("HRMNY_N8N_WEBHOOK_SECRET") ||
        has("CRON_SECRET")
          ? "configured"
          : "missing",
    },
    /** Connected staff accounts (counts only — no secrets). */
    connections,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

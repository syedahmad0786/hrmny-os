import { runtimeLlmSnapshot } from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { featureEnabled } from "@/server/features";
import { toolConfiguredStatus } from "@/server/integrations/resolve-keys";
import { buildDemoBlockers, connectionSmoke } from "@/server/ready/smoke";
import { googleWorkspaceRedirectUri } from "@/server/google-workspace-oauth";
import { healDisabledConnectedAppPolicy } from "@/server/work-governance";

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
  const [apollo, hunter, xero, n8n, connections, portalMagicLink, orgHeal] =
    await Promise.all([
      toolConfiguredStatus("apollo"),
      toolConfiguredStatus("hunter"),
      toolConfiguredStatus("xero"),
      toolConfiguredStatus("n8n"),
      connectionSmoke(),
      featureEnabled("portal.magic_link", {}),
      healDisabledConnectedAppPolicy(),
    ]);

  const resendMode =
    process.env.RESEND_MODE?.toLowerCase() === "live" &&
    has("RESEND_API_KEY") &&
    has("RESEND_FROM")
      ? "live"
      : has("RESEND_API_KEY")
        ? "configured"
        : "mock";

  const tools = {
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
  };

  const blockers = buildDemoBlockers({ tools, connections });
  const llm = runtimeLlmSnapshot();

  const body = {
    ok: database === "up",
    authMode: process.env.AUTH_MODE ?? "dev",
    llmProvider: llm.provider,
    llmDefaultModel: llm.defaultModel,
    llmFreeOnly: llm.freeOnly,
    xeroWriteEnabled: process.env.XERO_WRITE_ENABLED === "true",
    database,
    keyStore: database === "up" ? "vault" : "memory",
    pgvector,
    portalMagicLink: portalMagicLink ? "enabled" : "disabled",
    connectedAppPolicy: orgHeal.policy.appPolicy,
    googleOAuthRedirectUri: googleWorkspaceRedirectUri(),
    tools,
    /** Connected staff accounts (counts + lastError snippets — no secrets). */
    connections,
    /** Human-actionable live-demo gaps (same list Hunt / Connections show). */
    blockers,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

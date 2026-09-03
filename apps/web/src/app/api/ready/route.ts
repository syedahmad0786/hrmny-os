import { runtimeLlmSnapshot } from "@hrmny/ai";
import { sql } from "@hrmny/db";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { featureEnabled } from "@/server/features";
import { toolConfiguredStatus } from "@/server/integrations/resolve-keys";
import { buildDemoBlockers, connectionSmoke } from "@/server/ready/smoke";
import { legacySalesSyntheticRuntimeEnabled } from "@/server/sales-os/legacy-effect-policy";
import { googleWorkspaceRedirectUri } from "@/server/google-workspace-oauth";
import { getWorkOrganizationPolicy } from "@/server/work-governance";

/** Lightweight deploy smoke — no secrets, no business data, no writes. */
export async function GET() {
  const db = getDb();
  let database: "up" | "down" = "down";
  let pgvector = false;
  let integrationInbox = false;
  if (db) {
    try {
      await db.execute(sql`select 1`);
      database = "up";
      const rows = await db.execute<{
        pgvector: boolean;
        integration_inbox: boolean;
      }>(sql`
        select
          exists(select 1 from pg_extension where extname = 'vector') as pgvector,
          to_regclass('public.integration_inbox') is not null as integration_inbox
      `);
      pgvector = Boolean(rows[0]?.pgvector);
      integrationInbox = Boolean(rows[0]?.integration_inbox);
    } catch {
      database = "down";
    }
  }
  const has = (k: string) => Boolean(process.env[k]?.trim());
  const [apollo, hunter, xero, n8n, connections, portalMagicLink, orgPolicy] =
    await Promise.all([
      toolConfiguredStatus("apollo"),
      toolConfiguredStatus("hunter"),
      toolConfiguredStatus("xero"),
      toolConfiguredStatus("n8n"),
      connectionSmoke(),
      featureEnabled("portal.magic_link", {}),
      getWorkOrganizationPolicy(),
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
  const appOrigin = (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "https://hrmny-os.vercel.app"
  ).replace(/\/$/, "");
  const qmUrl = (
    process.env.QM_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_QM_URL?.trim() ||
    ""
  ).replace(/\/$/, "");

  const body = {
    ok: database === "up",
    authMode: process.env.AUTH_MODE ?? "dev",
    llmProvider: llm.provider,
    llmDefaultModel: llm.defaultModel,
    llmFreeOnly: llm.freeOnly,
    syntheticSalesFixtures: legacySalesSyntheticRuntimeEnabled(),
    xeroWriteEnabled: process.env.XERO_WRITE_ENABLED === "true",
    database,
    keyStore: database === "up" ? "vault" : "memory",
    pgvector,
    integrationInbox,
    portalMagicLink: portalMagicLink ? "enabled" : "disabled",
    connectedAppPolicy: orgPolicy.appPolicy,
    googleOAuthRedirectUri: googleWorkspaceRedirectUri(),
    surfaces: {
      googleChat: {
        status: "endpoint_ready",
        eventUrl: `${appOrigin}/api/integrations/google-chat/events`,
        openUrl: `${appOrigin}/chat`,
      },
      qm: {
        status: qmUrl ? "configured" : "deployment_ready",
        publicUrl: qmUrl || null,
        plannedUrl: "https://hrmny-qm-portal.fly.dev",
      },
    },
    tools,
    /** Connected staff accounts (counts + lastError snippets — no secrets). */
    connections,
    /** Human-actionable live-demo gaps (same list Hunt / Connections show). */
    blockers,
  };
  return NextResponse.json(body, { status: body.ok ? 200 : 503 });
}

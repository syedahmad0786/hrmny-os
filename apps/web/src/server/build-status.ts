import { pingDatabase } from "@hrmny/db";
import { getSupabasePublicConfig } from "@/lib/supabase-config";
import { GBRAIN_UPSTREAM_VERSION, gbrainConfigured } from "@/server/gbrain";

export type MilestoneStatus = "done" | "live_pending" | "blocked" | "next";

export type MilestoneCard = {
  id: string;
  title: string;
  fee: string;
  status: MilestoneStatus;
  summary: string;
  href: string;
  demoReady: boolean;
};

export type ConnectionCard = {
  id: string;
  label: string;
  status: "active" | "endpoint_ready" | "missing" | "mock";
  detail: string;
};

export async function getBuildStatus() {
  const supabase = getSupabasePublicConfig();
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const composioKey = process.env.COMPOSIO_API_KEY?.trim() ?? "";
  const xeroMode = process.env.XERO_MODE ?? "mock";
  const apolloMode = process.env.APOLLO_MODE ?? "mock";
  const hunterMode = process.env.HUNTER_MODE ?? "mock";
  const authMode = process.env.AUTH_MODE ?? "dev";
  const googleOAuthConfigured = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID?.trim(),
  );
  const googleChatConfigured = Boolean(
    process.env.GOOGLE_CHAT_SERVICE_ACCOUNT_JSON?.trim(),
  );
  const companyBrainConfigured = gbrainConfigured();
  const qmUrl = (
    process.env.QM_PUBLIC_URL?.trim() ||
    process.env.NEXT_PUBLIC_QM_URL?.trim() ||
    ""
  ).replace(/\/$/, "");
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const appOrigin = (appUrl || "https://hrmny-os.vercel.app").replace(
    /\/$/,
    "",
  );

  const dbPing = await pingDatabase(databaseUrl);

  const milestones: MilestoneCard[] = [
    {
      id: "M1",
      title: "Substrate",
      fee: "$1,500",
      status: "live_pending",
      summary: "Core live; Google Chat, GBrain and QM need provider acceptance",
      href: "/gate",
      demoReady: true,
    },
    {
      id: "M2",
      title: "Finance + HR",
      fee: "$1,500",
      status: xeroMode === "live" ? "done" : "live_pending",
      summary: "Invoice propose→post, HR lifecycle, Bayzat CSV",
      href: "/finance",
      demoReady: true,
    },
    {
      id: "M3",
      title: "Sales platform",
      fee: "$1,500",
      status:
        apolloMode === "live" && googleOAuthConfigured
          ? "done"
          : "live_pending",
      summary: "Apollo → CRM → draft → approve → Gmail → Won handover",
      href: "/crm",
      demoReady: true,
    },
    {
      id: "M4",
      title: "Delivery",
      fee: "$1,500",
      status: "done",
      summary: "DoR, QC@5, T-48h, task boards, Canva connect",
      href: "/delivery",
      demoReady: true,
    },
    {
      id: "M5",
      title: "Money loop",
      fee: "$1,500",
      status: "done",
      summary: "Retainers, margin (AM deny), payroll SoD",
      href: "/billing",
      demoReady: true,
    },
    {
      id: "M6",
      title: "Portal + seams",
      fee: "$1,500",
      status: "done",
      summary: "Client portal, dashboards hub, cutover notes",
      href: "/portal",
      demoReady: true,
    },
  ];

  const connections: ConnectionCard[] = [
    {
      id: "supabase",
      label: "Supabase API",
      status: supabase ? "active" : "missing",
      detail: supabase
        ? supabase.url.replace("https://", "")
        : "Set NEXT_PUBLIC_SUPABASE_URL + publishable key",
    },
    {
      id: "postgres",
      label: "Postgres",
      status: dbPing.ok ? "active" : databaseUrl ? "missing" : "missing",
      detail: dbPing.ok
        ? `Connected via pooler · ${dbPing.tables} tables · ${dbPing.roles} roles · ${dbPing.employees} employees · ${dbPing.deals} deals`
        : (dbPing.error ?? "DATABASE_URL not set or unreachable"),
    },
    {
      id: "vercel",
      label: "Vercel",
      status: appUrl ? "active" : "missing",
      detail: appUrl
        ? `${appUrl} — CRM at /crm`
        : "Vercel project not configured",
    },
    {
      id: "composio",
      label: "Composio",
      status: composioKey ? "active" : "mock",
      detail: composioKey
        ? "API key present — live OAuth/send available"
        : "Not configured; direct provider connections are used instead.",
    },
    {
      id: "google-workspace",
      label: "Google Workspace",
      status: googleOAuthConfigured ? "active" : "missing",
      detail: googleOAuthConfigured
        ? "OAuth client ready; each user connects Gmail, Calendar, Drive, and Sheets in Settings."
        : "Add the Google OAuth client, then each user connects their own Workspace account.",
    },
    {
      id: "google-chat",
      label: "Google Chat",
      status: "endpoint_ready",
      detail: googleChatConfigured
        ? "The service-account credential is present and durable asynchronous replies are built; a named-user live canary remains."
        : `Signed-event endpoint ready: ${appOrigin}/api/integrations/google-chat/events. Add the Google Chat service account and run a live canary.`,
    },
    {
      id: "qm",
      label: "QM + Fly Sprites",
      status: qmUrl ? "active" : "missing",
      detail: qmUrl
        ? `${qmUrl} — user sandboxes available`
        : "Deployment contract ready; Fly billing and quota must be unlocked before provisioning.",
    },
    {
      id: "gbrain",
      label: "GBrain company knowledge",
      status: companyBrainConfigured ? "endpoint_ready" : "missing",
      detail: companyBrainConfigured
        ? `Scoped ${GBRAIN_UPSTREAM_VERSION} bridge configured; share one published article to verify read-back.`
        : `Pinned ${GBRAIN_UPSTREAM_VERSION} bridge is built; add the dedicated MCP URL, projector token, and source ID.`,
    },
    {
      id: "asana",
      label: "Asana",
      status: "missing",
      detail: "Not connected; migration and reconciliation are still required.",
    },
    {
      id: "canva",
      label: "Canva",
      status: "missing",
      detail: "Connect when ready (optional for V1)",
    },
    {
      id: "linkedin",
      label: "LinkedIn",
      status: "missing",
      detail:
        "Connect via Composio OAuth; campaign publish is HITL when connected",
    },
    {
      id: "xero",
      label: "Xero",
      status: xeroMode === "live" ? "active" : "mock",
      detail: `Mode: ${xeroMode}`,
    },
    {
      id: "apollo",
      label: "Apollo",
      status: apolloMode === "live" ? "active" : "mock",
      detail: `Mode: ${apolloMode} — free discovery is available; paid detail lookup remains approval-gated.`,
    },
  ];

  const demoDone = milestones.filter((m) => m.demoReady).length;
  const pct = Math.round((demoDone / milestones.length) * 100);

  return {
    product: "hrmny OS",
    phase: dbPing.ok
      ? "Production wiring · Postgres live"
      : "Production wiring",
    authMode,
    database: dbPing,
    progress: {
      demoMilestonesReady: demoDone,
      total: milestones.length,
      percent: pct,
      label: `${demoDone}/${milestones.length} milestone demos runnable locally`,
    },
    milestones,
    connections,
    nextActions: [
      dbPing.ok ? "Postgres live" : "Fix DATABASE_URL",
      `Point the Google Chat app at ${appOrigin}/api/integrations/google-chat/events`,
      qmUrl
        ? "Run QM live conformance and connect its portal in HRMNY"
        : "Enable Fly billing, then publish the QM sandbox and deploy the stack",
      "Connect Google Workspace per staff user in Settings",
      "Run Sales in order: Apollo search → choose → draft → approve → send",
      `Xero mode: ${xeroMode}; Hunter is retired (${hunterMode})`,
    ],
    updatedAt: new Date().toISOString(),
  };
}

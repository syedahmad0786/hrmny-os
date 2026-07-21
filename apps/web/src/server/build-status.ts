import { pingDatabase } from "@hrmny/db";

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
  status: "active" | "missing" | "mock" | "tomorrow";
  detail: string;
};

export async function getBuildStatus() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const composioKey = process.env.COMPOSIO_API_KEY?.trim() ?? "";
  const xeroMode = process.env.XERO_MODE ?? "mock";
  const apolloMode = process.env.APOLLO_MODE ?? "mock";
  const hunterMode = process.env.HUNTER_MODE ?? "mock";
  const authMode = process.env.AUTH_MODE ?? "dev";

  const dbPing = await pingDatabase(databaseUrl);

  const milestones: MilestoneCard[] = [
    {
      id: "M1",
      title: "Substrate",
      fee: "$1,500",
      status: "done",
      summary: "Gate engine, RBAC, audit, DAM, app shell",
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
        apolloMode === "live" && hunterMode === "live" ? "done" : "live_pending",
      summary: "BUAF, quotes, HITL outreach, Won→Handover",
      href: "/sales",
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
      status: supabaseUrl && supabaseAnon ? "active" : "missing",
      detail: supabaseUrl
        ? supabaseUrl.replace("https://", "")
        : "Set NEXT_PUBLIC_SUPABASE_URL + anon key",
    },
    {
      id: "postgres",
      label: "Postgres",
      status: dbPing.ok ? "active" : databaseUrl ? "missing" : "missing",
      detail: dbPing.ok
        ? `Connected via pooler · ${dbPing.tables} tables · ${dbPing.roles} roles · ${dbPing.employees} employees · ${dbPing.deals} deals`
        : dbPing.error ?? "DATABASE_URL not set or unreachable",
    },
    {
      id: "vercel",
      label: "Vercel",
      status: "active",
      detail: "https://hrmny-os-desk-hrmnyco.vercel.app — CRM at /crm",
    },
    {
      id: "composio",
      label: "Composio",
      status: composioKey ? "active" : "mock",
      detail: composioKey
        ? "API key present — live OAuth/send available"
        : "MCP active (Gmail/Calendar/Drive/Sheets/Asana). App key optional.",
    },
    {
      id: "gmail",
      label: "Gmail",
      status: "active",
      detail: "developer@hrmny.co via Composio",
    },
    {
      id: "gcal",
      label: "Google Calendar",
      status: "active",
      detail: "Connected via Composio",
    },
    {
      id: "gdrive",
      label: "Google Drive",
      status: "active",
      detail: "Connected via Composio",
    },
    {
      id: "gsheets",
      label: "Google Sheets",
      status: "active",
      detail: "Connected via Composio",
    },
    {
      id: "asana",
      label: "Asana",
      status: "active",
      detail: "Connected — boards migrate in-house over time",
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
      status: "mock",
      detail: "No OAuth — copy-draft only (ban risk)",
    },
    {
      id: "xero",
      label: "Xero",
      status: "tomorrow",
      detail: `Mode: ${xeroMode} — credentials tomorrow`,
    },
    {
      id: "apollo",
      label: "Apollo",
      status: "tomorrow",
      detail: `Mode: ${apolloMode} — credentials tomorrow`,
    },
    {
      id: "hunter",
      label: "Hunter",
      status: "tomorrow",
      detail: `Mode: ${hunterMode} — credentials tomorrow`,
    },
  ];

  const demoDone = milestones.filter((m) => m.demoReady).length;
  const pct = Math.round((demoDone / milestones.length) * 100);

  return {
    product: "hrmny OS",
    phase: dbPing.ok ? "Production wiring · Postgres live" : "Production wiring",
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
      dbPing.ok
        ? "Postgres live — next: migrate demo store reads for deals/roles onto Drizzle"
        : "Fix DATABASE_URL (use pooler IPv4 host if direct db.* fails)",
      "Optional: Canva Composio connect",
      "LinkedIn: keep copy-draft only (no account connect)",
      "Tomorrow: Xero + Apollo + Hunter keys → flip *_MODE=live",
    ],
    updatedAt: new Date().toISOString(),
  };
}

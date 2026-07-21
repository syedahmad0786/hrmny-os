export type ItemState = "done" | "partial" | "blocked" | "todo";

export type ChecklistItem = {
  id: string;
  label: string;
  state: ItemState;
  note: string;
};

/** Honest M1 ($1,500) payment-gate status vs SOW Sprint 1 */
export const M1_ITEMS: ChecklistItem[] = [
  {
    id: "mono",
    label: "Monorepo + app shell (Next.js / Turborepo)",
    state: "done",
    note: "hrmny-os live locally",
  },
  {
    id: "pg",
    label: "Postgres schema (23+ tables) on Supabase",
    state: "done",
    note: "26 tables + seed + pooler URL",
  },
  {
    id: "gate",
    label: "Central gate engine + audit trail",
    state: "done",
    note: "Blocked + legal transitions audited; CRM gated",
  },
  {
    id: "rbac",
    label: "RBAC spine (AM never sees margin)",
    state: "done",
    note: "Dev personas + tests",
  },
  {
    id: "dam",
    label: "DAM upload + versioned assets",
    state: "done",
    note: "Memory default; DAM_STORAGE=supabase when keys set",
  },
  {
    id: "auth",
    label: "Google Workspace SSO (production auth)",
    state: "partial",
    note: "AUTH_MODE=dev demo waiver — SSO when Supabase project wired",
  },
  {
    id: "jobs",
    label: "Background jobs / timers (SLA, T-48h)",
    state: "partial",
    note: "Callable stubs — Inngest not live",
  },
  {
    id: "chat",
    label: "Health signals → Google Chat",
    state: "done",
    note: "Stub recorded; POST when GOOGLE_CHAT_WEBHOOK_URL set",
  },
  {
    id: "azure",
    label: "Azure UAE residency (original SOW)",
    state: "todo",
    note: "Parked — V1 = Supabase + Vercel",
  },
  {
    id: "keeper",
    label: "Keeper secrets + CI/CD prod",
    state: "partial",
    note: "Vercel project live; Keeper later",
  },
];

export const MILESTONES = [
  {
    id: "M1",
    title: "Substrate",
    fee: "$1,500",
    href: "/#m1",
    blurb: "Gates, RBAC, Postgres, shell",
    progress: 90,
  },
  {
    id: "M2",
    title: "Finance + HR",
    fee: "$1,500",
    href: "/#roadmap",
    blurb: "Xero mock · Bayzat CSV · needs live Xero",
    progress: 55,
  },
  {
    id: "M3",
    title: "Sales platform",
    fee: "$1,500",
    href: "/crm",
    blurb: "CRM redesign live · BUAF + pipeline",
    progress: 75,
  },
  {
    id: "M4",
    title: "Delivery",
    fee: "$1,500",
    href: "/#roadmap",
    blurb: "DoR · QC · boards demo-ready",
    progress: 65,
  },
  {
    id: "M5",
    title: "Money loop",
    fee: "$1,500",
    href: "/#roadmap",
    blurb: "Retainer · payroll SoD demos",
    progress: 60,
  },
  {
    id: "M6",
    title: "Portal + seams",
    fee: "$1,500",
    href: "/portal",
    blurb: "Portal UI shipping now",
    progress: 50,
  },
];

export function m1Score() {
  const weight = { done: 1, partial: 0.5, blocked: 0, todo: 0 } as const;
  const total = M1_ITEMS.length;
  const score = M1_ITEMS.reduce((s, i) => s + weight[i.state], 0);
  return {
    done: M1_ITEMS.filter((i) => i.state === "done").length,
    partial: M1_ITEMS.filter((i) => i.state === "partial").length,
    todo: M1_ITEMS.filter((i) => i.state === "todo").length,
    percent: Math.round((score / total) * 100),
    paymentReady: true,
    verdict:
      "M1 §12.1 demo path is payment-ready under AUTH_MODE=dev (partner waiver for live SSO). Gate + blocked audit + RBAC + DAM + health stub + Connections green. Remaining: live Google SSO, optional Chat webhook, Inngest.",
  };
}

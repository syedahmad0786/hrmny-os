import { z } from "zod";

export const WORKBOOK_TABS = [
  "leads",
  "contacts",
  "companies",
  "deals",
  "clients",
  "followups",
] as const;
export type WorkbookTab = (typeof WORKBOOK_TABS)[number];
export const TAB_LABELS: Record<WorkbookTab, string> = {
  leads: "Leads",
  contacts: "Contacts",
  companies: "Companies",
  deals: "Deals",
  clients: "Clients",
  followups: "Follow-ups",
};
export const viewConfigSchema = z.object({
  tab: z.enum(WORKBOOK_TABS),
  search: z.string().max(200).default(""),
  owner: z.string().max(50).default("all"),
  status: z.string().max(60).default("all"),
  attention: z
    .enum([
      "all",
      "unassigned",
      "overdue",
      "no_next_action",
      "unverified",
      "data_review",
      "renewals",
    ])
    .default("all"),
  showTest: z.boolean().default(false),
  sort: z.string().max(60).default("name"),
  descending: z.boolean().default(false),
  columns: z.array(z.string().max(60)).max(30).default([]),
});
export type WorkbookConfig = z.infer<typeof viewConfigSchema>;
export const defaultWorkbookConfig = (tab: WorkbookTab): WorkbookConfig =>
  viewConfigSchema.parse({ tab });
export type WorkbookRow = {
  id: string;
  kind: Exclude<WorkbookTab, "leads">;
  href: string;
  name: string;
  company: string;
  ownerId: string | null;
  owner: string;
  status: string;
  stage: string;
  source: string;
  market: string;
  sector: string;
  email: string;
  phone: string;
  title: string;
  website: string;
  linkedin: string;
  verified: string;
  value: string;
  currency: string;
  expectedClose: string;
  nextAction: string;
  due: string;
  lastInteraction: string;
  renewal: string;
  updatedAt: string;
  test: boolean;
  issues: string[];
};
export const WORKBOOK_COLUMNS = {
  name: "Name",
  company: "Company",
  owner: "Owner",
  status: "Status",
  stage: "Stage",
  source: "Source",
  market: "Market",
  sector: "Sector",
  email: "Work email",
  verified: "Email verification",
  phone: "Phone",
  title: "Role",
  website: "Website",
  linkedin: "LinkedIn profile",
  value: "Value",
  currency: "Currency",
  expectedClose: "Expected close",
  nextAction: "Next action",
  due: "Due date",
  lastInteraction: "Last interaction",
  renewal: "Renewal date",
  updatedAt: "Record updated",
} as const;
export type WorkbookColumn = keyof typeof WORKBOOK_COLUMNS;
export const DEFAULT_COLUMNS: Record<WorkbookTab, WorkbookColumn[]> = {
  leads: ["name", "company", "owner", "stage", "source", "nextAction", "due"],
  deals: [
    "name",
    "company",
    "owner",
    "stage",
    "value",
    "currency",
    "expectedClose",
    "nextAction",
    "due",
  ],
  contacts: [
    "name",
    "company",
    "title",
    "email",
    "verified",
    "owner",
    "lastInteraction",
  ],
  companies: ["name", "market", "sector", "website", "owner", "status"],
  clients: [
    "name",
    "company",
    "owner",
    "status",
    "value",
    "currency",
    "renewal",
    "nextAction",
    "due",
  ],
  followups: ["name", "company", "owner", "status", "due"],
};
export function visibleColumns(config: WorkbookConfig): WorkbookColumn[] {
  return Array.from(
    new Set([
      "name",
      ...(config.columns.length ? config.columns : DEFAULT_COLUMNS[config.tab]),
    ]),
  ).filter((key): key is WorkbookColumn => key in WORKBOOK_COLUMNS);
}
export function filterWorkbookRows(
  rows: WorkbookRow[],
  config: WorkbookConfig,
  employeeId: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const term = config.search.trim().toLowerCase();
  const soon = new Date(`${today}T00:00:00Z`);
  soon.setUTCDate(soon.getUTCDate() + 60);
  return rows
    .filter((row) => {
      if (
        config.tab === "leads"
          ? row.kind !== "deals" ||
            !["discover", "qualify"].includes(row.stage) ||
            row.status !== "Open"
          : row.kind !== config.tab
      )
        return false;
      if (!config.showTest && row.test) return false;
      if (
        term &&
        ![row.name, row.company, row.email, row.title, row.sector, row.source]
          .join(" ")
          .toLowerCase()
          .includes(term)
      )
        return false;
      if (
        config.owner !== "all" &&
        row.ownerId !== (config.owner === "me" ? employeeId : config.owner)
      )
        return false;
      if (
        config.status !== "all" &&
        row.status !== config.status &&
        row.stage !== config.status
      )
        return false;
      if (config.attention === "unassigned" && row.ownerId) return false;
      if (
        config.attention === "overdue" &&
        (!row.due ||
          row.due >= today ||
          ["done", "cancelled"].includes(row.status))
      )
        return false;
      if (
        config.attention === "no_next_action" &&
        ((row.nextAction && row.due) ||
          row.kind !== "deals" ||
          row.status !== "Open")
      )
        return false;
      if (
        config.attention === "unverified" &&
        row.verified !== "Needs verification"
      )
        return false;
      if (config.attention === "data_review" && !row.issues.length)
        return false;
      if (
        config.attention === "renewals" &&
        (!row.renewal ||
          row.renewal < today ||
          row.renewal > soon.toISOString().slice(0, 10) ||
          ["closed", "churned"].includes(row.status))
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const column =
        config.sort in WORKBOOK_COLUMNS
          ? (config.sort as WorkbookColumn)
          : "name";
      return (
        (String(a[column]).localeCompare(String(b[column]), undefined, {
          numeric: true,
        }) || a.id.localeCompare(b.id)) * (config.descending ? -1 : 1)
      );
    });
}

export function safeExternalUrl(
  raw: string | null | undefined,
): string | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function workbookHealth(
  rows: WorkbookRow[],
  today = new Date().toISOString().slice(0, 10),
) {
  const real = rows.filter((row) => !row.test);
  const active = real.filter(
    (row) => row.kind === "deals" && row.status === "Open",
  );
  return {
    open: active.length,
    unassigned: active.filter((row) => !row.ownerId).length,
    noNextAction: active.filter((row) => !row.nextAction || !row.due).length,
    overdue: real.filter(
      (row) =>
        row.kind === "followups" &&
        !["done", "cancelled"].includes(row.status) &&
        row.due &&
        row.due < today,
    ).length,
    dataReview: real.filter((row) => row.issues.length).length,
  };
}

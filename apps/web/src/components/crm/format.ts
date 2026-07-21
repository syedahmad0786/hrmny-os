import type { DealRow } from "@/server/crm/types";

export const LANE_LABELS: Record<string, string> = {
  industry_scanning: "Industry scanning",
  apollo_intent: "Apollo intent",
  relationship_led: "Relationship led",
  tejari: "Tejari",
};

export function initials(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function formatAed(value: string | number | null | undefined): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return `AED ${n.toLocaleString("en-AE", { maximumFractionDigits: 0 })}`;
}

export function formatLane(lane: string | null | undefined): string {
  if (!lane) return "—";
  return LANE_LABELS[lane] ?? lane.replace(/_/g, " ");
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

export function buafScore(deal: Pick<
  DealRow,
  "buafBudget" | "buafUrgency" | "buafAccess" | "buafFit"
>): { done: number; total: number; label: string } {
  const flags = [
    deal.buafBudget,
    deal.buafUrgency,
    deal.buafAccess,
    deal.buafFit,
  ];
  const done = flags.filter((f) => f === true).length;
  return { done, total: 4, label: `${done} / 4` };
}

export function companyStatus(args: {
  openDeals: number;
  wonDeals: number;
}): { label: string; kind: "success" | "info" | "ochre" | "warn" } {
  if (args.wonDeals > 0) return { label: "Active client", kind: "success" };
  if (args.openDeals > 0) return { label: "In pipeline", kind: "ochre" };
  return { label: "Prospect", kind: "info" };
}

export function relationshipSummary(args: {
  openDeals: number;
  totalValue: number;
}): string {
  if (args.openDeals > 0) {
    return `${args.openDeals} open deal${args.openDeals === 1 ? "" : "s"}`;
  }
  if (args.totalValue > 0) return formatAed(args.totalValue);
  return "No open deals";
}

export function tagKindForTemp(
  temp: string | null | undefined,
): "danger" | "ochre" | "info" | "warn" | undefined {
  if (temp === "hot") return "danger";
  if (temp === "warm") return "ochre";
  if (temp === "cool") return "info";
  if (temp === "cold") return "warn";
  return undefined;
}

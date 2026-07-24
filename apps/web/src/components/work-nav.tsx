"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";

const ITEMS = [
  { href: "/work", label: "Projects", features: ["work.projects"] },
  { href: "/work/my-tasks", label: "My tasks", features: ["work.my_tasks"] },
  { href: "/work/inbox", label: "Inbox", features: ["work.inbox"] },
  { href: "/work/search", label: "Search", features: ["work.search"] },
  {
    href: "/work/workflows",
    label: "Workflows",
    features: [
      "work.forms",
      "work.rules",
      "work.templates",
      "work.bundles",
      "work.approvals",
    ],
  },
  {
    href: "/work/planning",
    label: "Planning",
    features: [
      "work.goals",
      "work.portfolios",
      "work.reporting_dashboards",
      "work.workload",
      "work.capacity_planning",
      "work.budgets",
      "work.time_tracking",
      "work.views.gantt",
    ],
  },
] as const;

export function WorkNav() {
  const pathname = usePathname();
  const session = trpc.auth.session.useQuery();
  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Work sections">
      {ITEMS.filter((item) =>
        item.features.some((feature) => enabled.has(feature)),
      ).map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`rounded-full border px-3 py-1.5 text-sm ${pathname === item.href ? "border-ink bg-ink text-white" : "border-sand bg-white/70"}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

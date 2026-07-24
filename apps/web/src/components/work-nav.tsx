"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { trpc } from "@/lib/trpc";

const ITEMS = [
  { href: "/work", label: "Projects", feature: "work.projects" },
  { href: "/work/my-tasks", label: "My tasks", feature: "work.my_tasks" },
  { href: "/work/inbox", label: "Inbox", feature: "work.inbox" },
  { href: "/work/search", label: "Search", feature: "work.search" },
] as const;

export function WorkNav() {
  const pathname = usePathname();
  const session = trpc.auth.session.useQuery();
  const enabled = new Set(session.data?.enabledFeatureKeys ?? []);
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Work sections">
      {ITEMS.filter((item) => enabled.has(item.feature)).map((item) => (
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

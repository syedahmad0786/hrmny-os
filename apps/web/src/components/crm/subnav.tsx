"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/crm/hunt", label: "Find clients" },
  { href: "/crm/research", label: "Research" },
  { href: "/crm/outreach", label: "Outreach" },
  { href: "/crm", label: "Pipeline", exact: true },
  { href: "/crm/contacts", label: "Contacts" },
] as const;

function isActive(
  pathname: string,
  tab: { href: string; exact?: boolean },
): boolean {
  return tab.exact
    ? pathname === tab.href
    : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
}

export function CrmSubnav() {
  const pathname = usePathname();

  return (
    <nav className="crm-subnav" aria-label="Sales sections">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={isActive(pathname, tab) ? "active" : undefined}
        >
          {tab.label}
        </Link>
      ))}
      <Link href="/settings/connections" className="crm-subnav-connection">
        Connected tools
      </Link>
    </nav>
  );
}

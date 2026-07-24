"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const CRM_TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/crm", label: "Pipeline", exact: true },
  { href: "/clients", label: "Clients" },
  { href: "/crm/deals", label: "Deals" },
  { href: "/crm/companies", label: "Companies" },
  { href: "/crm/contacts", label: "Contacts" },
  { href: "/crm/activities", label: "Activities" },
  { href: "/crm/tasks", label: "Sales tasks" },
  { href: "/crm/outreach", label: "Outreach" },
  { href: "/crm/inbound", label: "Inbound" },
  { href: "/crm/seams", label: "Email + calendar" },
  { href: "/crm/quote", label: "Commercial" },
];

export function CrmSubnav() {
  const pathname = usePathname();

  return (
    <nav className="crm-subnav" aria-label="CRM sections">
      {CRM_TABS.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={active ? "active" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

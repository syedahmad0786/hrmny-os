"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY_TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/crm/hunt", label: "Sales Growth" },
  { href: "/crm/research", label: "Research" },
  { href: "/crm", label: "Pipeline", exact: true },
  { href: "/crm/outreach", label: "Outreach" },
  { href: "/crm/tasks", label: "Tasks" },
];

const MORE_TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/clients", label: "Clients" },
  { href: "/crm/deals", label: "Deals" },
  { href: "/crm/companies", label: "Companies" },
  { href: "/crm/contacts", label: "Contacts" },
  { href: "/crm/activities", label: "Activity" },
  { href: "/crm/inbound", label: "Inbound" },
  { href: "/crm/seams", label: "Email + calendar" },
  { href: "/crm/quote", label: "Commercial" },
  { href: "/crm/settings/sales-os", label: "Sales settings" },
];

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
  const activeMoreTab = MORE_TABS.find((tab) => isActive(pathname, tab));

  return (
    <nav className="crm-subnav" aria-label="CRM sections">
      {PRIMARY_TABS.map((tab) => {
        const active = isActive(pathname, tab);
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
      <details className="crm-subnav-more">
        <summary className={activeMoreTab ? "active" : undefined}>
          {activeMoreTab?.label ?? "More"}
        </summary>
        <div className="crm-subnav-menu">
          {MORE_TABS.map((tab) => (
            <Link
              key={tab.href}
              href={tab.href}
              className={isActive(pathname, tab) ? "active" : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type CrmTab = {
  href: string;
  label: string;
  exact?: boolean;
  match?: (pathname: string) => boolean;
  secondary?: { href: string; label: string }[];
};

/**
 * CRM information hierarchy — ≤5 top-level tabs.
 * Directory / Engage / Sales work expose secondary links for related screens.
 */
const CRM_TABS: CrmTab[] = [
  {
    href: "/crm",
    label: "Pipeline",
    exact: true,
  },
  {
    href: "/crm/companies",
    label: "Directory",
    match: (p) =>
      p.startsWith("/crm/companies") || p.startsWith("/crm/contacts"),
    secondary: [
      { href: "/crm/companies", label: "Companies" },
      { href: "/crm/contacts", label: "Contacts" },
    ],
  },
  {
    href: "/crm/outreach",
    label: "Engage",
    match: (p) =>
      p.startsWith("/crm/outreach") || p.startsWith("/crm/inbound"),
    secondary: [
      { href: "/crm/outreach", label: "Outreach" },
      { href: "/crm/inbound", label: "Inbound" },
    ],
  },
  {
    href: "/crm/tasks",
    label: "Sales work",
    match: (p) =>
      p.startsWith("/crm/tasks") ||
      p.startsWith("/crm/activities") ||
      p.startsWith("/crm/deals"),
    secondary: [
      { href: "/crm/tasks", label: "Tasks" },
      { href: "/crm/activities", label: "Activities" },
      { href: "/crm/deals", label: "Deal list" },
    ],
  },
  {
    href: "/crm/quote",
    label: "Commercial",
    match: (p) =>
      p.startsWith("/crm/quote") || p.startsWith("/crm/seams"),
    secondary: [
      { href: "/crm/quote", label: "Quotes" },
      { href: "/crm/seams", label: "Email + calendar" },
    ],
  },
];

export function CrmSubnav() {
  const pathname = usePathname();
  const activeTab =
    CRM_TABS.find((tab) =>
      tab.match
        ? tab.match(pathname)
        : tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(`${tab.href}/`),
    ) ?? null;

  return (
    <div className="crm-nav-stack">
      <nav className="crm-subnav" aria-label="CRM sections">
        {CRM_TABS.map((tab) => {
          const active = tab.match
            ? tab.match(pathname)
            : tab.exact
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
      {activeTab?.secondary ? (
        <nav className="crm-secondary-nav" aria-label={`${activeTab.label} sections`}>
          {activeTab.secondary.map((item) => {
            const active =
              pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

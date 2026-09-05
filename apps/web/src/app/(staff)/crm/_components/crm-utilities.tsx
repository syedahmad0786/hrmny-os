"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { CrmOmniSearch } from "./search-omni";

export function CrmUtilities() {
  const pathname = usePathname();
  if (
    pathname === "/crm/hunt" ||
    pathname === "/crm/dashboard" ||
    [
      "/crm/workbook",
      "/crm/leads",
      "/crm/contacts",
      "/crm/companies",
      "/crm/followups",
    ].some((route) => pathname === route || pathname.startsWith(`${route}/`)) ||
    pathname.startsWith("/crm/settings/")
  ) {
    return null;
  }
  return (
    <div className="crm-utilities" aria-label="CRM utilities">
      <CrmOmniSearch />
      <Link className="crm-btn" href="/crm/workbook?tab=deals">
        Export from workbook
      </Link>
    </div>
  );
}

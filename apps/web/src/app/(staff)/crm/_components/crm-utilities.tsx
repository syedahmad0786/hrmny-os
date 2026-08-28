"use client";

import { usePathname } from "next/navigation";
import { CsvActions } from "./csv-actions";
import { CrmOmniSearch } from "./search-omni";

export function CrmUtilities() {
  const pathname = usePathname();
  if (
    pathname === "/crm/hunt" ||
    pathname.startsWith("/crm/settings/")
  ) {
    return null;
  }
  return (
    <div className="crm-utilities" aria-label="CRM utilities">
      <CrmOmniSearch />
      <CsvActions kind="deals" />
    </div>
  );
}

import { CrmSubnav } from "@/components/crm/subnav";
import { CrmOmniSearch } from "./_components/search-omni";
import { CsvActions } from "./_components/csv-actions";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="crm-page">
      <div className="mb-[13px] flex flex-wrap items-center gap-2">
        <CrmOmniSearch />
        <CsvActions kind="deals" />
      </div>
      <CrmSubnav />
      {children}
    </div>
  );
}

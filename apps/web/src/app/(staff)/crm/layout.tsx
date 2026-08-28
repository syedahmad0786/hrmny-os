import { CrmSubnav } from "@/components/crm/subnav";
import { CrmUtilities } from "./_components/crm-utilities";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="crm-page">
      <CrmSubnav />
      <CrmUtilities />
      {children}
    </div>
  );
}

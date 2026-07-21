import { CrmSubnav } from "@/components/crm/subnav";

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="crm-page">
      <CrmSubnav />
      {children}
    </div>
  );
}

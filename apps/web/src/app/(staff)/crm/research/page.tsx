"use client";

import { CrmPageHeader } from "@/components/crm/ui";
import { ResearchConsole } from "../_components/research-console";

export default function CrmResearchPage() {
  return (
    <main data-testid="crm-research">
      <CrmPageHeader
        title="Hunt / research"
        description="Company research, three human gates, Apollo enrich. LinkedIn is copy-assist only."
      />
      <ResearchConsole />
    </main>
  );
}

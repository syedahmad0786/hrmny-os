"use client";

import { CrmPageHeader } from "@/components/crm/ui";
import { ResearchConsole } from "../_components/research-console";

export default function CrmResearchPage() {
  return (
    <main data-testid="crm-research">
      <CrmPageHeader
        title="Research a company"
        description="Turn a prospect into a useful brief before writing outreach. You decide what gets saved and sent."
      />
      <ResearchConsole />
    </main>
  );
}

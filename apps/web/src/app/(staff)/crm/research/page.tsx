"use client";

import { CrmPageHeader } from "@/components/crm/ui";
import { ResearchConsole } from "../_components/research-console";

export default function CrmResearchPage() {
  return (
    <main data-testid="crm-research">
      <CrmPageHeader
        title="Research a company"
        description="Review, Programmes, Sources and Runs stay separate. Discovery execution stays off until a later accepted release."
      />
      <ResearchConsole />
    </main>
  );
}

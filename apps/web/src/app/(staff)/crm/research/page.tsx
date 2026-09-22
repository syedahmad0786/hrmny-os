"use client";

import { CrmPageHeader } from "@/components/crm/ui";
import { ResearchConsole } from "../_components/research-console";

export default function CrmResearchPage() {
  return (
    <main data-testid="crm-research">
      <CrmPageHeader
        title="Discovery research"
        description="Review, Programmes, Sources and Runs stay bookmarkable. Collectors write Review candidates from published criteria."
      />
      <ResearchConsole />
    </main>
  );
}

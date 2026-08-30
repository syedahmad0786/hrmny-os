/**
 * Human-readable labels for Hrmny chat tool observations.
 * Maps CRM/OS tool names to active/done verbs (agent shell presentation only).
 */

export type ToolVerb = {
  active: string;
  done: string;
};

const TOOL_VERBS: Record<string, ToolVerb> = {
  "memory.search": { active: "Searching memory…", done: "Searched memory" },
  "crm.read": { active: "Reading CRM…", done: "Read CRM" },
  "crm.deals": { active: "Listing deals…", done: "Listed deals" },
  "crm.closed_loop": {
    active: "Running closed loop…",
    done: "Closed loop complete",
  },
  "crm.prospect": { active: "Prospecting…", done: "Prospected" },
  "crm.note": { active: "Writing CRM note…", done: "Wrote CRM note" },
  "delivery.read": { active: "Reading delivery…", done: "Read delivery" },
  "outreach.read": { active: "Reading outreach…", done: "Read outreach" },
  "outreach.draft": { active: "Drafting outreach…", done: "Drafted outreach" },
  "outreach.os_approve": {
    active: "Approving outreach…",
    done: "Approved outreach",
  },
  "onboarding.read": {
    active: "Reading onboarding…",
    done: "Read onboarding",
  },
  "onboarding.os_signoff": {
    active: "Signing off onboarding…",
    done: "Signed off onboarding",
  },
  "clients.os_month1_advance": {
    active: "Advancing Month-1…",
    done: "Advanced Month-1",
  },
  "finance.os_approve": {
    active: "Approving finance…",
    done: "Approved finance",
  },
  "finance.os_issue": { active: "Issuing invoice…", done: "Issued invoice" },
  "creative.os_qc": { active: "Running creative QC…", done: "Creative QC done" },
  "portal.invite": { active: "Inviting portal…", done: "Portal invite ready" },
  "creative.sendToPortal": {
    active: "Sending to portal…",
    done: "Sent to portal",
  },
  "campaigns.draft": { active: "Drafting campaign…", done: "Drafted campaign" },
  "campaigns.os_approve": {
    active: "Approving campaign…",
    done: "Approved campaign",
  },
  "campaigns.os_publish": {
    active: "Publishing campaign…",
    done: "Published campaign",
  },
  "calendar.os_ref_approve": {
    active: "Ref-approving calendar…",
    done: "Calendar ref-approved",
  },
  "briefs.draft": { active: "Drafting brief…", done: "Drafted brief" },
  "tasks.create": { active: "Creating task…", done: "Created task" },
  "n8n.health": { active: "Checking n8n…", done: "Checked n8n" },
  agent_act: { active: "Running agent tools…", done: "Agent tools finished" },
  funnel_act: { active: "Running funnel tools…", done: "Funnel tools finished" },
};

export function toolVerb(toolName: string, phase: "active" | "done"): string {
  const key = toolName.trim().toLowerCase();
  const row = TOOL_VERBS[key];
  if (row) return row[phase];
  const short = toolName.replace(/[._]/g, " ");
  return phase === "active" ? `Running ${short}…` : `Finished ${short}`;
}

export function observationLooksFailed(observation: unknown): boolean {
  if (observation == null) return false;
  const text =
    typeof observation === "string"
      ? observation
      : JSON.stringify(observation);
  return /\b(failed|error|ok":\s*false|"ok":false)\b/i.test(text);
}

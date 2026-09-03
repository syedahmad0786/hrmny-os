/** Canonical CRM pipeline stages (matches deal_stage_enum). */
export const CRM_PIPELINE_STAGES = [
  "discover",
  "qualify",
  "engage",
  "scope",
  "propose",
  "price_cost",
  "close",
  "handover_pack",
] as const;

export type CrmPipelineStage = (typeof CRM_PIPELINE_STAGES)[number];

export const CRM_PIPELINE_STAGE_LABELS: Record<CrmPipelineStage, string> = {
  discover: "New lead",
  qualify: "Check fit",
  engage: "Start conversation",
  scope: "Define needs",
  propose: "Send proposal",
  price_cost: "Agree pricing",
  close: "Win or close",
  handover_pack: "Start client onboarding",
};

export const CRM_PIPELINE_STAGE_DESCRIPTIONS: Record<CrmPipelineStage, string> =
  {
    discover: "Review the lead and decide whether to pursue.",
    qualify: "Confirm budget, urgency, decision access, and fit.",
    engage: "Start outreach and record the response.",
    scope: "Capture goals, deliverables, and timing.",
    propose: "Share the agreed scope with the client.",
    price_cost: "Confirm client price and internal cost.",
    close: "Record won, lost, or on hold.",
    handover_pack: "Create the client handover and onboarding work.",
  };

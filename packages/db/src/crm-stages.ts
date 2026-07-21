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
  discover: "Discover",
  qualify: "Qualify",
  engage: "Engage",
  scope: "Scope",
  propose: "Propose",
  price_cost: "Price / Cost",
  close: "Close",
  handover_pack: "Handover Pack",
};

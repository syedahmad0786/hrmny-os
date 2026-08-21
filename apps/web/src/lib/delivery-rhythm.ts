/** Delivery rhythm derived from client/deal contract type (client lock 14 Aug 2026). */

export type EngagementType = "retainer" | "project";

export type DeliveryRhythm = {
  engagementType: EngagementType;
  cadence: "recurring_checkpoints" | "milestone_touchpoints";
  label: string;
  description: string;
};

export function deliveryRhythmFor(
  engagementType: string | null | undefined,
): DeliveryRhythm {
  if (engagementType === "retainer") {
    return {
      engagementType: "retainer",
      cadence: "recurring_checkpoints",
      label: "Retainer · recurring checkpoints",
      description:
        "Recurring delivery checkpoints (e.g. weekly) on a retainer rhythm.",
    };
  }
  return {
    engagementType: "project",
    cadence: "milestone_touchpoints",
    label: "Project · milestone touchpoints",
    description:
      "One-time project with milestone review and delivery touchpoints.",
  };
}

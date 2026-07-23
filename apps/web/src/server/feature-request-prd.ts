import { z } from "zod";

export const FeatureRequestPrdSchema = z.object({
  problem: z.string().min(1),
  desiredOutcome: z.string().min(1),
  inScope: z.array(z.string().min(1)).min(1),
  outOfScope: z.array(z.string().min(1)),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
});

export type FeatureRequestPrd = z.infer<typeof FeatureRequestPrdSchema>;
export type FeatureRequestStatus =
  "draft" | "review" | "approved" | "rejected" | "building" | "shipped";

export function draftFeatureRequestPrd(
  title: string,
  idea: string,
): FeatureRequestPrd {
  return {
    problem: idea.trim(),
    desiredOutcome: title.trim(),
    inScope: [title.trim()],
    outOfScope: ["Anything not explicitly approved in this PRD"],
    acceptanceCriteria: [
      `A Harmony user can complete: ${title.trim()}`,
      "The change is permission-aware and auditable",
      "The approved workflow works in production",
    ],
  };
}

const transitions: Record<FeatureRequestStatus, FeatureRequestStatus[]> = {
  draft: ["review"],
  review: ["approved", "rejected"],
  approved: ["building"],
  rejected: ["draft"],
  building: ["shipped"],
  shipped: [],
};

export function canTransitionFeatureRequest(
  from: FeatureRequestStatus,
  to: FeatureRequestStatus,
): boolean {
  return transitions[from].includes(to);
}

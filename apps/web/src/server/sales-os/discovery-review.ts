import { countDiscoveryReviewQueues } from "./discovery-candidates";
import { listDiscoveryProgrammes } from "./discovery-programmes";
import { listDiscoveryRuns } from "./discovery-run-queries";

export type DiscoveryReviewSummary = {
  needsReview: number;
  needsEvidence: number;
  researchRunning: number;
  sourcesNeedingAttention: number;
  executionEnabled: false;
  candidateStoreReady: true;
  candidateStoreAccepted: false;
};

export async function summarizeDiscoveryReview(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
}): Promise<DiscoveryReviewSummary> {
  const [programmes, runs, queues] = await Promise.all([
    listDiscoveryProgrammes(input),
    listDiscoveryRuns(input),
    countDiscoveryReviewQueues(input),
  ]);
  return {
    needsReview: queues.needsReview,
    needsEvidence: queues.needsEvidence,
    researchRunning: runs.filter(
      (run) => run.status === "running" || run.status === "cancel_requested",
    ).length,
    sourcesNeedingAttention: programmes.filter(
      (programme) => programme.blockedSourceCount > 0,
    ).length,
    executionEnabled: false,
    candidateStoreReady: true,
    candidateStoreAccepted: false,
  };
}

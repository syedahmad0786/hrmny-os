import { submitDiscoveryCandidate } from "./discovery-candidates";

type ImportRow = Parameters<typeof submitDiscoveryCandidate>[0]["values"];

/**
 * Shared import route for intent CSV/manual uploads. Uses the same
 * Discovery submit/evaluate path. This is not Gate 1 `processIntentLeads`.
 */
export async function importDiscoveryIntentEvidence(input: {
  actorEmployeeId: string;
  isAdmin: boolean;
  rows: ImportRow[];
}) {
  const imported = [];
  for (const row of input.rows) {
    imported.push(
      await submitDiscoveryCandidate({
        actorEmployeeId: input.actorEmployeeId,
        isAdmin: input.isAdmin,
        values: {
          ...row,
          discoveryChannel: row.discoveryChannel ?? "intent_import",
          opportunityKind: row.opportunityKind ?? "intent",
          sourceKey: row.sourceKey ?? "intent_import",
        },
      }),
    );
  }
  return imported;
}

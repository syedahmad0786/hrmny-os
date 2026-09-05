import { discoverSalesOpportunities } from "./discovery";

/** Uses the operator's dated-source research flow and review queue. */
export function proposeDailyResearch(actorEmployeeId: string, now: Date) {
  return discoverSalesOpportunities(
    {
      requestId: `daily:${now.toISOString().slice(0, 10)}`,
      actorEmployeeId,
      roles: [],
      focus: "",
      mode: "signals",
    },
    { now },
  );
}
